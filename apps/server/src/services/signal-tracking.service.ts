import { eq, isNull, and, gte, lte, sql, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { signalTracking } from "../db/schema/signal-tracking.js";
import { signalTrackingWindows } from "../db/schema/signal-tracking-windows.js";
import { marketDataService } from "./market-data.service.js";
import { getMarketPhase } from "../lib/market-phase.js";
import type { IntelligenceSnapshot } from "../lib/types.js";

const MAX_DAILY_SIGNALS = 200;
// Multi-window tracking (2026-05-10): every tracked signal is evaluated at
// THREE checkpoints in parallel — 4, 8, 12 min — to compare which window
// length captures real moves cleanest. Same trigger fires once; 3 child rows
// in signal_tracking_windows hold the per-window outcomes. Same direction
// snapshot logic at each lock — never NEUTRAL on the lock itself; any
// matching-direction movement (even 0.01%) is SUCCESS, any opposite is
// FAILED. The metric-time NEUTRAL dead-zone (±0.2%) reclassifies later.
const EVAL_INTERVAL_MS = 30_000;
const TRACKING_WINDOWS_MIN = [4, 8, 12] as const;
// The 8-min window is "canonical" — its lock also writes the same outcome
// into the parent signal_tracking row's existing outcome columns so all
// pre-existing readers (Recent Signals table, social feed, /social/[id])
// keep working unchanged. Other windows live exclusively in the child table.
const CANONICAL_WINDOW_MIN = 8;

// Social-template eligibility: confidence ≥ 0.75. Volatility filter dropped —
// surfaces more signals so /admin/social has steady content even on calm days.
const SOCIAL_MIN_CONFIDENCE = 0.75;

// Single tracking pool — the 3-bucket model (Ultra/High/Medium) was retired
// 2026-05-07. Only confidence ≥ 0.7 emits, written as "TRACKED". Historical
// rows tagged "ULTRA_HIGH"/"HIGH" are folded into the same pool at metric time
// (they were also conf ≥ 0.7); historical "MEDIUM" rows (conf 0.5–0.7) are
// excluded from the new single-pool view since they're below the new floor.
type ConfidenceBucket = "TRACKED";
type TrackingStatus = "PENDING" | "SUCCESS" | "FAILED" | "NEUTRAL";

// Bumped 100 → 250 on 2026-05-07 along with the single-pool collapse: with
// only Bounce + Rejection emitting at conf ≥ 0.7, we want a higher confidence
// floor on the sample size before declaring the pool's accuracy stable.
const MIN_SAMPLES_TRACKED = 250;
// Single-pool view folds historical "HIGH"/"ULTRA_HIGH" rows in (they were also
// conf ≥ 0.7) plus newly-written "TRACKED" rows. Excludes legacy MEDIUM (conf
// 0.5–0.7) rows since they're below the new floor.
const ABOVE_FLOOR_BUCKET_LABELS = new Set(["TRACKED", "HIGH", "ULTRA_HIGH"]);
// Outlooks emitted under the new single-pool model. Breakout/Breakdown were
// retired 2026-05-07 and re-enabled 2026-05-10 with a strict 2-gate stack
// (volume surge + Donchian-style confirmation) — see intelligence-transformer.ts.
const TRACKED_OUTLOOKS = ["BOUNCE_EXPECTED", "REJECTION_POSSIBLE", "BREAKOUT_LIKELY", "BREAKDOWN_RISK"];

// Direction maps for evaluate() + reclassifyForMetrics(). Buy-side: signal
// expects price to rise (Bounce off support, Breakout above resistance).
// Sell-side: signal expects price to fall (Rejection at resistance, Breakdown
// below support).
const BUY_SIDE_OUTLOOKS = new Set(["BREAKOUT_LIKELY", "BOUNCE_EXPECTED"]);
const SELL_SIDE_OUTLOOKS = new Set(["REJECTION_POSSIBLE", "BREAKDOWN_RISK"]);

// Metric-time NEUTRAL dead-zone. Rows where |change| < this threshold are
// considered "no real outcome" — excluded from the accuracy denominator on
// /admin/tracking and shown as a separate count. Backend still WRITES pure
// SUCCESS/FAILED for new signals; this is a metric-compute-time reclassification
// only. Must stay in sync with NEUTRAL_THRESHOLD_PERCENT in template-shared.tsx
// (the social-template display rule uses the same 0.2% band).
const NEUTRAL_METRIC_THRESHOLD_PERCENT = 0.2;

// Reclassify a row for metric purposes:
//   PENDING                                  → PENDING
//   |change| < NEUTRAL_METRIC_THRESHOLD      → NEUTRAL (excluded from accuracy)
//   matches outlook direction (else)         → SUCCESS
//   opposite direction (else)                → FAILED
//
// Backend stored status (SUCCESS / FAILED / NEUTRAL legacy) is overridden by
// the threshold rule — the actual change% is the source of truth at metric time.
// Keeps historical NEUTRAL rows + recent direction-snapshot rows consistent.
function reclassifyForMetrics(
  r: { status: string; outlook: string; changePercent: string | null },
): "SUCCESS" | "FAILED" | "PENDING" | "NEUTRAL" {
  if (r.status === "PENDING") return "PENDING";
  const change = Number(r.changePercent ?? 0);
  if (Math.abs(change) < NEUTRAL_METRIC_THRESHOLD_PERCENT) return "NEUTRAL";
  const isBullish = BUY_SIDE_OUTLOOKS.has(r.outlook);
  if (isBullish) return change > 0 ? "SUCCESS" : "FAILED";
  return change < 0 ? "SUCCESS" : "FAILED";
}

interface ActiveTrackingWindow {
  windowMinutes: number;
  childRowId: number;
  status: "PENDING" | "SUCCESS" | "FAILED";
  // Captured at lock time so the all-NEUTRAL re-eligibility check after all
  // 3 windows lock can run without a DB re-read.
  changePercentLocked: number | null;
}

interface ActiveTracking {
  symbol: string;
  parentDbId: number;
  isBuySide: boolean;
  entryPrice: number;
  recordedAt: number;
  confidenceBucket: ConfidenceBucket;
  windows: ActiveTrackingWindow[]; // 3 entries: 4 / 8 / 12 min
}

interface BucketRecord {
  status: string;
  outlook: string;
  changePercent: string | null;
  maxProfitPercent: string | null;
  maxDrawdownPercent: string | null;
}

// Single-pool stats reducer, shared by the live `getMetrics` and standalone
// `getTrackingMetricsFromDB`. Keeps the response shape (bucket + accuracy +
// movement stats + per-outlook breakdown) identical to the previous 3-bucket
// model so the frontend just renders one card instead of three.
function computeBucketStats(bucketRecords: BucketRecord[]) {
  const success = bucketRecords.filter((r) => reclassifyForMetrics(r) === "SUCCESS");
  const failed = bucketRecords.filter((r) => reclassifyForMetrics(r) === "FAILED");
  const neutral = bucketRecords.filter((r) => reclassifyForMetrics(r) === "NEUTRAL");
  const pending = bucketRecords.filter((r) => reclassifyForMetrics(r) === "PENDING");
  const evaluated = [...success, ...failed];

  const decided = success.length + failed.length;
  const accuracy = decided > 0 ? Math.round((success.length / decided) * 100) : 0;
  const winRate = decided > 0 ? success.length / decided : 0;
  const lossRate = decided > 0 ? failed.length / decided : 0;

  // Math.abs on gains: changePercent is signed, so SELL-side SUCCESS (price down → success)
  // is negative. Without abs, BUY/SELL successes cancel in the average and tank expectancy
  // even when accuracy is high.
  const gains = success.map((r) => Math.abs(Number(r.changePercent))).filter((v) => !isNaN(v));
  const losses = failed.map((r) => Math.abs(Number(r.changePercent))).filter((v) => !isNaN(v));
  const maxProfits = evaluated.map((r) => Number(r.maxProfitPercent)).filter((v) => !isNaN(v));
  const maxDrawdowns = evaluated.map((r) => Number(r.maxDrawdownPercent)).filter((v) => !isNaN(v));

  const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / gains.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
  const avgMaxProfit = maxProfits.length > 0 ? maxProfits.reduce((a, b) => a + b, 0) / maxProfits.length : 0;
  const avgMaxDrawdown = maxDrawdowns.length > 0 ? maxDrawdowns.reduce((a, b) => a + b, 0) / maxDrawdowns.length : 0;
  const expectancy = (winRate * avgGain) - (lossRate * avgLoss);
  const riskReward = avgLoss !== 0 ? Math.abs(avgGain / avgLoss) : 0;

  // Iterates over the currently-tracked outlooks. Historical rows for any
  // outlook not in TRACKED_OUTLOOKS (retired variants, future drops) are
  // excluded so the dashboard rows match what's actually being emitted.
  const byOutlook: Record<string, { total: number; wins: number; neutral: number; rate: number }> = {};
  for (const outlook of TRACKED_OUTLOOKS) {
    const outlookEvaluated = evaluated.filter((r) => r.outlook === outlook);
    const outlookWins = outlookEvaluated.filter((r) => reclassifyForMetrics(r) === "SUCCESS").length;
    const outlookNeutral = neutral.filter((r) => r.outlook === outlook).length;
    byOutlook[outlook] = {
      total: outlookEvaluated.length,
      wins: outlookWins,
      neutral: outlookNeutral,
      rate: outlookEvaluated.length > 0 ? Math.round((outlookWins / outlookEvaluated.length) * 100) : 0,
    };
  }

  return {
    bucket: "TRACKED" as const,
    total: bucketRecords.length,
    pending: pending.length,
    success: success.length,
    failed: failed.length,
    neutral: neutral.length,
    accuracy,
    avgGain: Math.round(avgGain * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    avgMaxProfit: Math.round(avgMaxProfit * 100) / 100,
    avgMaxDrawdown: Math.round(avgMaxDrawdown * 100) / 100,
    expectancy: Math.round(expectancy * 1000) / 1000,
    riskReward: Math.round(riskReward * 100) / 100,
    sampleSufficient: decided >= MIN_SAMPLES_TRACKED,
    minSampleRequired: MIN_SAMPLES_TRACKED,
    byOutlook,
  };
}

// Multi-window metrics builder. Pulls parent rows for the date, joins with
// child rows, then computes one BucketStats per window. Shared between the
// live `getMetrics` (with activeMap-aware activeCount) and the standalone
// `getTrackingMetricsFromDB` (no service required, used on weekends).
async function computeMultiWindowMetrics(dayStart: Date, dayEnd: Date) {
  const parents = await db
    .select()
    .from(signalTracking)
    .where(and(
      gte(signalTracking.signalTime, dayStart),
      lte(signalTracking.signalTime, dayEnd),
    ));

  // Same single-pool filter as before: only conf ≥ 0.7 buckets count.
  const eligibleParents = parents.filter((r) => ABOVE_FLOOR_BUCKET_LABELS.has(r.confidenceBucket));
  const parentMap = new Map(eligibleParents.map((p) => [p.id, p]));
  const parentIds = eligibleParents.map((p) => p.id);

  // Pull all child rows for these parents in one query
  const children = parentIds.length > 0
    ? await db
        .select()
        .from(signalTrackingWindows)
        .where(inArray(signalTrackingWindows.signalId, parentIds))
    : [];

  // For each window, build BucketRecord[] and run computeBucketStats
  return TRACKING_WINDOWS_MIN.map((windowMin) => {
    const windowChildren = children.filter((c) => c.windowMinutes === windowMin);
    const records = windowChildren.map((c) => {
      const parent = parentMap.get(c.signalId);
      return {
        status: c.status,
        outlook: parent?.outlook ?? "",
        changePercent: c.changePercent,
        maxProfitPercent: c.maxProfitPercent,
        maxDrawdownPercent: c.maxDrawdownPercent,
      };
    });
    return { windowMinutes: windowMin, ...computeBucketStats(records) };
  });
}

function getISTDate(): string {
  return new Date().toLocaleDateString("en-US", { timeZone: "Asia/Kolkata" });
}

function getBucket(confidence: number): ConfidenceBucket | null {
  if (confidence >= 0.7) return "TRACKED";
  return null;
}

export function createSignalTrackingService() {
  const activeMap = new Map<string, ActiveTracking>();
  const trackedToday = new Map<string, ConfidenceBucket>();
  let dailyCount = 0;
  let dailyDate = "";
  let evalTimer: ReturnType<typeof setInterval> | null = null;
  let closeTimer: ReturnType<typeof setInterval> | null = null;

  function checkDailyReset(): void {
    const today = getISTDate();
    if (dailyDate !== today) {
      dailyCount = 0;
      dailyDate = today;
      trackedToday.clear();
    }
  }

  async function loadPending(): Promise<void> {
    try {
      // Find parent rows that have any pending child window. We don't filter on
      // parent.status because the canonical (8m) lock writes back to parent —
      // parent could be SUCCESS/FAILED while 4m or 12m are still PENDING.
      const pendingChildren = await db
        .select({
          parentId: signalTrackingWindows.signalId,
          windowMinutes: signalTrackingWindows.windowMinutes,
          childRowId: signalTrackingWindows.id,
        })
        .from(signalTrackingWindows)
        .where(eq(signalTrackingWindows.status, "PENDING"));

      if (pendingChildren.length === 0) return;

      // Group pending child rows by parent
      const byParent = new Map<number, Array<{ windowMinutes: number; childRowId: number }>>();
      for (const c of pendingChildren) {
        const arr = byParent.get(c.parentId) ?? [];
        arr.push({ windowMinutes: c.windowMinutes, childRowId: c.childRowId });
        byParent.set(c.parentId, arr);
      }

      // Pull the parent metadata for those signals
      const parentIds = [...byParent.keys()];
      const parents = await db
        .select()
        .from(signalTracking)
        .where(inArray(signalTracking.id, parentIds));

      for (const p of parents) {
        if (activeMap.has(p.symbol)) continue;
        const pending = byParent.get(p.id) ?? [];
        if (pending.length === 0) continue;
        activeMap.set(p.symbol, {
          symbol: p.symbol,
          parentDbId: p.id,
          isBuySide: BUY_SIDE_OUTLOOKS.has(p.outlook),
          entryPrice: Number(p.priceAtSignal),
          recordedAt: new Date(p.signalTime).getTime(),
          confidenceBucket: p.confidenceBucket as ConfidenceBucket,
          windows: pending.map((w) => ({
            windowMinutes: w.windowMinutes,
            childRowId: w.childRowId,
            status: "PENDING",
            changePercentLocked: null,
          })),
        });
      }

      console.log(`[Tracking] Loaded ${parents.length} pending signals (${pendingChildren.length} pending windows) from DB [${activeMap.size} active]`);
    } catch (err: any) {
      console.warn("[Tracking] Failed to load pending:", err.message);
    }
  }

  async function recordSignal(
    symbol: string,
    intel: IntelligenceSnapshot,
    price: number,
  ): Promise<void> {
    const bucket = getBucket(intel.confidence);
    if (!bucket) return;

    if (intel.outlook === "NO_CLEAR_EDGE") return;

    const { phase } = getMarketPhase();
    if (phase === "OPENING" || phase === "STABILIZING") return;

    const istNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const istTotalMin = istNow.getHours() * 60 + istNow.getMinutes();
    if (istTotalMin < 9 * 60 + 30) return; // before 9:30 AM (NORMAL phase begins)
    if (istTotalMin >= 15 * 60 + 10) return; // 3:10 PM — stop before close

    if (price < 50) return;
    if (activeMap.has(symbol)) return; // still pending evaluation

    // Dedup: one signal per symbol per day (single-pool model — no bucket promotion).
    if (trackedToday.has(symbol)) return;

    checkDailyReset();
    if (dailyCount >= MAX_DAILY_SIGNALS) return;

    const isBuySide = BUY_SIDE_OUTLOOKS.has(intel.outlook);
    const now = new Date();
    const volatilityScore = intel.volatility.score;
    const socialEligible = intel.confidence >= SOCIAL_MIN_CONFIDENCE;

    try {
      const [inserted] = await db.insert(signalTracking).values({
        symbol,
        signalTime: now,
        priceAtSignal: price.toFixed(2),
        outlook: intel.outlook,
        confidence: intel.confidence.toFixed(4),
        confidenceBucket: bucket,
        zone: intel.context.zone,
        bias: intel.bias,
        volatilityScore: volatilityScore.toFixed(4),
        socialEligible,
        status: "PENDING",
      }).returning({ id: signalTracking.id });

      // Insert one child row per tracking window. Each starts PENDING and gets
      // locked independently by evaluate() when its window elapses.
      const insertedWindows = await db
        .insert(signalTrackingWindows)
        .values(TRACKING_WINDOWS_MIN.map((w) => ({
          signalId: inserted.id,
          windowMinutes: w,
        })))
        .returning({ id: signalTrackingWindows.id, windowMinutes: signalTrackingWindows.windowMinutes });

      activeMap.set(symbol, {
        symbol,
        parentDbId: inserted.id,
        isBuySide,
        entryPrice: price,
        recordedAt: Date.now(),
        confidenceBucket: bucket,
        windows: insertedWindows.map((w) => ({
          windowMinutes: w.windowMinutes,
          childRowId: w.id,
          status: "PENDING",
          changePercentLocked: null,
        })),
      });
      dailyCount++;
      trackedToday.set(symbol, bucket);

      console.log(`[Tracking] Recorded: ${symbol} ${intel.outlook} conf=${intel.confidence.toFixed(2)} bucket=${bucket} entry=₹${price.toFixed(2)} windows=${TRACKING_WINDOWS_MIN.join("/")}min [${dailyCount}/${MAX_DAILY_SIGNALS} today, ${activeMap.size} active]`);
    } catch (err: any) {
      console.warn(`[Tracking] Failed to record ${symbol}:`, err.message);
    }
  }

  async function evaluate(): Promise<void> {
    if (activeMap.size === 0) return;

    const now = Date.now();

    // Iterate symbols, then per-symbol iterate each window. Each window locks
    // independently when its own window time elapses. The 8-min canonical
    // window also writes its outcome back to the parent row's outcome columns
    // so existing readers (Recent Signals table, social feed) keep working.
    // A symbol stays in activeMap until ALL its windows have locked.
    for (const sig of [...activeMap.values()]) {
      const quote = marketDataService.getQuote(sig.symbol);
      if (!quote || quote.lastPrice <= 0) continue;

      let lockedThisTick = false;
      for (const w of sig.windows) {
        if (w.status !== "PENDING") continue;
        const windowEndMs = sig.recordedAt + w.windowMinutes * 60_000;
        if (now < windowEndMs) continue;

        const priceAfter = quote.lastPrice;
        const maxPrice = quote.high;
        const minPrice = quote.low;
        const changePercent = ((priceAfter - sig.entryPrice) / sig.entryPrice) * 100;
        const changePoints = priceAfter - sig.entryPrice;
        const maxProfitPercent = ((maxPrice - sig.entryPrice) / sig.entryPrice) * 100;
        const maxDrawdownPercent = ((minPrice - sig.entryPrice) / sig.entryPrice) * 100;

        let status: "SUCCESS" | "FAILED";
        if (sig.isBuySide) {
          status = changePercent >= 0 ? "SUCCESS" : "FAILED";
        } else {
          status = changePercent <= 0 ? "SUCCESS" : "FAILED";
        }

        try {
          // Always update the child row for this window
          await db.update(signalTrackingWindows).set({
            status,
            priceAfter: priceAfter.toFixed(2),
            changePercent: changePercent.toFixed(4),
            changePoints: changePoints.toFixed(2),
            maxPrice: maxPrice.toFixed(2),
            minPrice: minPrice.toFixed(2),
            maxProfitPercent: maxProfitPercent.toFixed(4),
            maxDrawdownPercent: maxDrawdownPercent.toFixed(4),
            evaluatedAt: new Date(),
          }).where(eq(signalTrackingWindows.id, w.childRowId));

          // 8-min canonical window also writes back to the parent row so
          // Recent Signals table, social feed, /social/[id] etc. keep showing
          // an outcome without needing to join the child table.
          if (w.windowMinutes === CANONICAL_WINDOW_MIN) {
            await db.update(signalTracking).set({
              status,
              priceAfter: priceAfter.toFixed(2),
              changePercent: changePercent.toFixed(4),
              changePoints: changePoints.toFixed(2),
              maxPrice: maxPrice.toFixed(2),
              minPrice: minPrice.toFixed(2),
              maxProfitPercent: maxProfitPercent.toFixed(4),
              maxDrawdownPercent: maxDrawdownPercent.toFixed(4),
              evaluatedAt: new Date(),
            }).where(eq(signalTracking.id, sig.parentDbId));
          }

          w.status = status;
          w.changePercentLocked = changePercent;
          lockedThisTick = true;

          const lockSec = Math.round((now - sig.recordedAt) / 1000);
          console.log(`[Tracking] ${status}@${w.windowMinutes}m: ${sig.symbol} change=${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}% lock=${lockSec}s`);
        } catch (err: any) {
          console.warn(`[Tracking] Failed to evaluate ${sig.symbol}@${w.windowMinutes}m:`, err.message);
        }
      }

      // Symbol cleanup: remove from activeMap only when all windows have
      // locked. NEUTRAL re-eligibility: free the symbol from today's dedup
      // ONLY if every window landed inside the ±0.2% dead-zone — i.e., the
      // signal had no real outcome at any horizon. Stricter than the prior
      // single-window rule, intentional.
      if (!lockedThisTick) continue;
      const allLocked = sig.windows.every((w) => w.status !== "PENDING");
      if (!allLocked) continue;

      activeMap.delete(sig.symbol);
      const allNeutral = sig.windows.every((w) =>
        w.changePercentLocked !== null &&
        Math.abs(w.changePercentLocked) < NEUTRAL_METRIC_THRESHOLD_PERCENT
      );
      if (allNeutral) {
        trackedToday.delete(sig.symbol);
        console.log(`[Tracking] All-NEUTRAL re-eligible: ${sig.symbol} [${activeMap.size} active]`);
      } else {
        console.log(`[Tracking] All locked: ${sig.symbol} [${activeMap.size} active]`);
      }
    }
  }

  async function evaluateMarketClose(): Promise<void> {
    const { phase } = getMarketPhase();
    if (phase !== "CLOSED" || activeMap.size === 0) return;

    console.log(`[Tracking] Market closed — force-locking ${activeMap.size} remaining signals' open windows`);

    for (const sig of [...activeMap.values()]) {
      const quote = marketDataService.getQuote(sig.symbol);
      const priceAfter = quote?.lastPrice ?? sig.entryPrice;
      const maxPrice = quote?.high ?? priceAfter;
      const minPrice = quote?.low ?? priceAfter;

      const changePercent = ((priceAfter - sig.entryPrice) / sig.entryPrice) * 100;
      const changePoints = priceAfter - sig.entryPrice;
      const maxProfitPercent = ((maxPrice - sig.entryPrice) / sig.entryPrice) * 100;
      const maxDrawdownPercent = ((minPrice - sig.entryPrice) / sig.entryPrice) * 100;

      // Force-resolve any PENDING window at market close — same direction
      // logic as evaluate(), never NEUTRAL on the lock itself.
      let status: "SUCCESS" | "FAILED";
      if (sig.isBuySide) {
        status = changePercent >= 0 ? "SUCCESS" : "FAILED";
      } else {
        status = changePercent <= 0 ? "SUCCESS" : "FAILED";
      }

      try {
        for (const w of sig.windows) {
          if (w.status !== "PENDING") continue;
          await db.update(signalTrackingWindows).set({
            status,
            priceAfter: priceAfter.toFixed(2),
            changePercent: changePercent.toFixed(4),
            changePoints: changePoints.toFixed(2),
            maxPrice: maxPrice.toFixed(2),
            minPrice: minPrice.toFixed(2),
            maxProfitPercent: maxProfitPercent.toFixed(4),
            maxDrawdownPercent: maxDrawdownPercent.toFixed(4),
            evaluatedAt: new Date(),
          }).where(eq(signalTrackingWindows.id, w.childRowId));

          if (w.windowMinutes === CANONICAL_WINDOW_MIN) {
            await db.update(signalTracking).set({
              status,
              priceAfter: priceAfter.toFixed(2),
              changePercent: changePercent.toFixed(4),
              changePoints: changePoints.toFixed(2),
              maxPrice: maxPrice.toFixed(2),
              minPrice: minPrice.toFixed(2),
              maxProfitPercent: maxProfitPercent.toFixed(4),
              maxDrawdownPercent: maxDrawdownPercent.toFixed(4),
              evaluatedAt: new Date(),
            }).where(eq(signalTracking.id, sig.parentDbId));
          }

          w.status = status;
          w.changePercentLocked = changePercent;
        }
        activeMap.delete(sig.symbol);
      } catch (err: any) {
        console.warn(`[Tracking] Market close eval failed for ${sig.symbol}:`, err.message);
      }
    }
  }

  async function getMetrics(date?: Date) {
    const targetDate = date ?? new Date();
    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    try {
      const result = await computeMultiWindowMetrics(dayStart, dayEnd);
      return {
        date: dayStart.toISOString().split("T")[0],
        buckets: result,
        activeCount: activeMap.size,
      };
    } catch (err: any) {
      console.warn("[Tracking] Metrics error:", err.message);
      return null;
    }
  }

  async function getRecentSignals(limit = 200, date?: Date) {
    try {
      const targetDate = date ?? new Date();
      const dayStart = new Date(targetDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(targetDate);
      dayEnd.setHours(23, 59, 59, 999);

      const rows = await db
        .select()
        .from(signalTracking)
        .where(and(
          gte(signalTracking.signalTime, dayStart),
          lte(signalTracking.signalTime, dayEnd),
        ))
        .orderBy(sql`${signalTracking.signalTime} DESC`)
        .limit(limit);

      return rows.map(r => ({
        ...r,
        groupId: `${r.symbol}-${new Date(r.signalTime).toISOString().slice(0, 10)}`,
      }));
    } catch {
      return [];
    }
  }

  // Social-template feed: rows where socialEligible = true on the given day.
  // Used by /admin/social to list signals that qualify for screenshot templates.
  async function getSocialFeed(date?: Date) {
    try {
      const targetDate = date ?? new Date();
      const dayStart = new Date(targetDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(targetDate);
      dayEnd.setHours(23, 59, 59, 999);

      // Single-pool /social: only the two emitted outlooks. Historical
      // Breakout / Breakdown rows are filtered out so the public-facing feed
      // matches the new model even for past dates.
      const rows = await db
        .select()
        .from(signalTracking)
        .where(and(
          eq(signalTracking.socialEligible, true),
          inArray(signalTracking.outlook, TRACKED_OUTLOOKS),
          gte(signalTracking.signalTime, dayStart),
          lte(signalTracking.signalTime, dayEnd),
        ))
        .orderBy(sql`${signalTracking.signalTime} DESC`);

      return rows;
    } catch (err: any) {
      console.warn("[Tracking] getSocialFeed error:", err.message);
      return [];
    }
  }

  // Single signal lookup for the template renderer page.
  async function getSocialSignal(id: number) {
    try {
      const [row] = await db
        .select()
        .from(signalTracking)
        .where(eq(signalTracking.id, id))
        .limit(1);
      return row ?? null;
    } catch (err: any) {
      console.warn("[Tracking] getSocialSignal error:", err.message);
      return null;
    }
  }

  return {
    recordSignal,

    async start() {
      await loadPending();
      evalTimer = setInterval(evaluate, EVAL_INTERVAL_MS);
      evalTimer.unref();
      closeTimer = setInterval(evaluateMarketClose, 5 * 60_000);
      closeTimer.unref();
      console.log(`[Tracking] Started — direction snapshots at minutes ${TRACKING_WINDOWS_MIN.join("/")} (canonical=${CANONICAL_WINDOW_MIN}m, ${EVAL_INTERVAL_MS / 1000}s poll)`);
    },

    stop() {
      if (evalTimer) { clearInterval(evalTimer); evalTimer = null; }
      if (closeTimer) { clearInterval(closeTimer); closeTimer = null; }
      console.log("[Tracking] Stopped");
    },

    getMetrics,
    getRecentSignals,
    getSocialFeed,
    getSocialSignal,
  };
}

export type SignalTrackingService = ReturnType<typeof createSignalTrackingService>;

// Standalone DB queries — work without a running service (for weekends/market closed)
export async function getTrackingMetricsFromDB(date?: Date) {
  const targetDate = date ?? new Date();
  const dayStart = new Date(targetDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(targetDate);
  dayEnd.setHours(23, 59, 59, 999);

  try {
    const result = await computeMultiWindowMetrics(dayStart, dayEnd);
    return { date: dayStart.toISOString().split("T")[0], buckets: result, activeCount: 0 };
  } catch (err: any) {
    console.warn("[Tracking] Standalone metrics error:", err.message);
    return null;
  }
}

export async function getTrackingSignalsFromDB(limit = 200, date?: Date) {
  try {
    const targetDate = date ?? new Date();
    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    const rows = await db
      .select()
      .from(signalTracking)
      .where(and(
        gte(signalTracking.signalTime, dayStart),
        lte(signalTracking.signalTime, dayEnd),
      ))
      .orderBy(sql`${signalTracking.signalTime} DESC`)
      .limit(limit);

    return rows.map(r => ({
      ...r,
      groupId: `${r.symbol}-${new Date(r.signalTime).toISOString().slice(0, 10)}`,
    }));
  } catch {
    return [];
  }
}
