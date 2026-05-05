import { eq, isNull, and, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { signalTracking } from "../db/schema/signal-tracking.js";
import { marketDataService } from "./market-data.service.js";
import { getMarketPhase } from "../lib/market-phase.js";
import type { IntelligenceSnapshot } from "../lib/types.js";

const MAX_DAILY_SIGNALS = 200;
// First-touch eval: poll every 5s within the 10-min window. The moment price
// crosses TP or SL we lock the verdict — matches what a real trader would see.
// Old behavior was a single snapshot at minute 10, which mis-classified ~50% of
// trades that hit target then mean-reverted. See plan
// glimmering-meandering-star.md for data + rationale.
const EVAL_INTERVAL_MS = 5_000;
const EVAL_WINDOW_MS = 10 * 60_000;
const TP_PERCENT = 0.5; // take-profit %, applied per outlook direction
const SL_PERCENT = 0.3; // stop-loss %, applied per outlook direction

// Social-template eligibility: confidence ≥ 0.75. Volatility filter dropped —
// surfaces more signals so /admin/social has steady content even on calm days.
const SOCIAL_MIN_CONFIDENCE = 0.75;

type ConfidenceBucket = "ULTRA_HIGH" | "HIGH" | "MEDIUM";
type TrackingStatus = "PENDING" | "SUCCESS" | "FAILED" | "NEUTRAL";

const MIN_SAMPLES: Record<ConfidenceBucket, number> = {
  ULTRA_HIGH: 20,
  HIGH: 50,
  MEDIUM: 100,
};

const BUY_SIDE_OUTLOOKS = new Set(["BREAKOUT_LIKELY", "BOUNCE_EXPECTED"]);

interface ActiveTracking {
  symbol: string;
  dbId: number;
  isBuySide: boolean;
  entryPrice: number;
  recordedAt: number;
  confidenceBucket: ConfidenceBucket;
}

function getISTDate(): string {
  return new Date().toLocaleDateString("en-US", { timeZone: "Asia/Kolkata" });
}

function getBucket(confidence: number): ConfidenceBucket | null {
  if (confidence >= 0.9) return "ULTRA_HIGH";
  if (confidence >= 0.7) return "HIGH";
  if (confidence >= 0.5) return "MEDIUM";
  return null;
}

const BUCKET_RANK: Record<ConfidenceBucket, number> = {
  MEDIUM: 1,
  HIGH: 2,
  ULTRA_HIGH: 3,
};

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
      const pending = await db
        .select()
        .from(signalTracking)
        .where(eq(signalTracking.status, "PENDING"));

      for (const r of pending) {
        if (activeMap.has(r.symbol)) continue;
        activeMap.set(r.symbol, {
          symbol: r.symbol,
          dbId: r.id,
          isBuySide: BUY_SIDE_OUTLOOKS.has(r.outlook),
          entryPrice: Number(r.priceAtSignal),
          recordedAt: new Date(r.signalTime).getTime(),
          confidenceBucket: r.confidenceBucket as ConfidenceBucket,
        });
      }

      if (pending.length > 0) {
        console.log(`[Tracking] Loaded ${pending.length} pending signals from DB [${activeMap.size} active]`);
      }
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

    // Dedup: only allow if bucket is higher than previously tracked today
    const previousBucket = trackedToday.get(symbol);
    if (previousBucket && BUCKET_RANK[bucket] <= BUCKET_RANK[previousBucket]) return;

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

      activeMap.set(symbol, {
        symbol,
        dbId: inserted.id,
        isBuySide,
        entryPrice: price,
        recordedAt: Date.now(),
        confidenceBucket: bucket,
      });
      dailyCount++;
      trackedToday.set(symbol, bucket);

      console.log(`[Tracking] Recorded: ${symbol} ${intel.outlook} conf=${intel.confidence.toFixed(2)} bucket=${bucket} entry=₹${price.toFixed(2)} [${dailyCount}/${MAX_DAILY_SIGNALS} today, ${activeMap.size} active]`);
    } catch (err: any) {
      console.warn(`[Tracking] Failed to record ${symbol}:`, err.message);
    }
  }

  async function evaluate(): Promise<void> {
    if (activeMap.size === 0) return;

    const now = Date.now();
    const toLock: Array<{
      sig: ActiveTracking;
      status: TrackingStatus;
      quote: { lastPrice: number; high: number; low: number };
    }> = [];

    // First-touch race: every poll, check each PENDING signal against TP/SL.
    // If neither crossed and 10-min window elapsed → NEUTRAL. Otherwise leave PENDING.
    for (const sig of activeMap.values()) {
      const quote = marketDataService.getQuote(sig.symbol);
      if (!quote || quote.lastPrice <= 0) continue;

      const changePercent = ((quote.lastPrice - sig.entryPrice) / sig.entryPrice) * 100;

      let status: TrackingStatus | null = null;
      if (sig.isBuySide) {
        if (changePercent >= TP_PERCENT) status = "SUCCESS";
        else if (changePercent <= -SL_PERCENT) status = "FAILED";
      } else {
        if (changePercent <= -TP_PERCENT) status = "SUCCESS";
        else if (changePercent >= SL_PERCENT) status = "FAILED";
      }

      if (status === null && now >= sig.recordedAt + EVAL_WINDOW_MS) {
        status = "NEUTRAL";
      }

      if (status !== null) {
        toLock.push({ sig, status, quote });
      }
    }

    if (toLock.length === 0) return;

    for (const { sig, status, quote } of toLock) {
      const priceAfter = quote.lastPrice;
      const maxPrice = quote.high;
      const minPrice = quote.low;

      const changePercent = ((priceAfter - sig.entryPrice) / sig.entryPrice) * 100;
      const changePoints = priceAfter - sig.entryPrice;
      const maxProfitPercent = ((maxPrice - sig.entryPrice) / sig.entryPrice) * 100;
      const maxDrawdownPercent = ((minPrice - sig.entryPrice) / sig.entryPrice) * 100;

      try {
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
        }).where(eq(signalTracking.id, sig.dbId));

        activeMap.delete(sig.symbol);

        // NEUTRAL outcomes free the stock for re-tracking same day. Same-bucket guard:
        // only clear if THIS signal still owns the dedup slot — protects an active
        // upgrade (e.g. MEDIUM tracked → HIGH tracked → MEDIUM evaluates NEUTRAL).
        if (status === "NEUTRAL" && trackedToday.get(sig.symbol) === sig.confidenceBucket) {
          trackedToday.delete(sig.symbol);
        }

        const lockSec = Math.round((now - sig.recordedAt) / 1000);
        console.log(`[Tracking] ${status}: ${sig.symbol} change=${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}% lock=${lockSec}s [${activeMap.size} active]`);
      } catch (err: any) {
        console.warn(`[Tracking] Failed to evaluate ${sig.symbol}:`, err.message);
      }
    }
  }

  async function evaluateMarketClose(): Promise<void> {
    const { phase } = getMarketPhase();
    if (phase !== "CLOSED" || activeMap.size === 0) return;

    console.log(`[Tracking] Market closed — evaluating ${activeMap.size} remaining signals`);

    for (const sig of [...activeMap.values()]) {
      const quote = marketDataService.getQuote(sig.symbol);
      const priceAfter = quote?.lastPrice ?? sig.entryPrice;
      const maxPrice = quote?.high ?? priceAfter;
      const minPrice = quote?.low ?? priceAfter;

      const changePercent = ((priceAfter - sig.entryPrice) / sig.entryPrice) * 100;
      const changePoints = priceAfter - sig.entryPrice;
      const maxProfitPercent = ((maxPrice - sig.entryPrice) / sig.entryPrice) * 100;
      const maxDrawdownPercent = ((minPrice - sig.entryPrice) / sig.entryPrice) * 100;

      let status: TrackingStatus;
      if (sig.isBuySide) {
        status = changePercent >= TP_PERCENT ? "SUCCESS" : changePercent <= -SL_PERCENT ? "FAILED" : "NEUTRAL";
      } else {
        status = changePercent <= -TP_PERCENT ? "SUCCESS" : changePercent >= SL_PERCENT ? "FAILED" : "NEUTRAL";
      }

      try {
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
        }).where(eq(signalTracking.id, sig.dbId));
        activeMap.delete(sig.symbol);
        if (status === "NEUTRAL" && trackedToday.get(sig.symbol) === sig.confidenceBucket) {
          trackedToday.delete(sig.symbol);
        }
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
      const records = await db
        .select()
        .from(signalTracking)
        .where(and(
          gte(signalTracking.signalTime, dayStart),
          lte(signalTracking.signalTime, dayEnd),
        ));

      const buckets: ConfidenceBucket[] = ["ULTRA_HIGH", "HIGH", "MEDIUM"];
      const result: Record<string, any>[] = [];

      for (const bucket of buckets) {
        const bucketRecords = records.filter((r) => r.confidenceBucket === bucket);
        const evaluated = bucketRecords.filter((r) => r.status !== "PENDING");
        const success = evaluated.filter((r) => r.status === "SUCCESS");
        const failed = evaluated.filter((r) => r.status === "FAILED");
        const neutral = evaluated.filter((r) => r.status === "NEUTRAL");
        const pending = bucketRecords.filter((r) => r.status === "PENDING");

        const decided = success.length + failed.length;
        // Accuracy includes NEUTRAL in the denominator: a signal that didn't move
        // is a miss from the trader's perspective, even if it didn't fail outright.
        // winRate/lossRate stay W/(W+L) since they're inputs to expectancy/R:R.
        const totalEvaluated = decided + neutral.length;
        const accuracy = totalEvaluated > 0 ? Math.round((success.length / totalEvaluated) * 100) : 0;
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

        const outlooks = ["BREAKOUT_LIKELY", "BOUNCE_EXPECTED", "REJECTION_POSSIBLE", "BREAKDOWN_RISK"];
        const byOutlook: Record<string, { total: number; wins: number; neutral: number; rate: number }> = {};
        for (const outlook of outlooks) {
          const outlookEvaluated = evaluated.filter((r) => r.outlook === outlook);
          const outlookWins = outlookEvaluated.filter((r) => r.status === "SUCCESS").length;
          const outlookNeutral = outlookEvaluated.filter((r) => r.status === "NEUTRAL").length;
          byOutlook[outlook] = {
            total: outlookEvaluated.length,
            wins: outlookWins,
            neutral: outlookNeutral,
            rate: outlookEvaluated.length > 0 ? Math.round((outlookWins / outlookEvaluated.length) * 100) : 0,
          };
        }

        result.push({
          bucket,
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
          sampleSufficient: decided >= MIN_SAMPLES[bucket],
          minSampleRequired: MIN_SAMPLES[bucket],
          byOutlook,
        });
      }

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

      const rows = await db
        .select()
        .from(signalTracking)
        .where(and(
          eq(signalTracking.socialEligible, true),
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
      console.log(`[Tracking] Started — first-touch eval (TP +${TP_PERCENT}% / SL -${SL_PERCENT}%, ${EVAL_INTERVAL_MS / 1000}s poll, ${EVAL_WINDOW_MS / 60_000}-min window)`);
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
    const records = await db
      .select()
      .from(signalTracking)
      .where(and(
        gte(signalTracking.signalTime, dayStart),
        lte(signalTracking.signalTime, dayEnd),
      ));

    type ConfBucket = "ULTRA_HIGH" | "HIGH" | "MEDIUM";
    const minSamples: Record<ConfBucket, number> = { ULTRA_HIGH: 20, HIGH: 50, MEDIUM: 100 };
    const buckets: ConfBucket[] = ["ULTRA_HIGH", "HIGH", "MEDIUM"];
    const result: Record<string, any>[] = [];

    for (const bucket of buckets) {
      const bucketRecords = records.filter((r) => r.confidenceBucket === bucket);
      const evaluated = bucketRecords.filter((r) => r.status !== "PENDING");
      const success = evaluated.filter((r) => r.status === "SUCCESS");
      const failed = evaluated.filter((r) => r.status === "FAILED");
      const neutral = evaluated.filter((r) => r.status === "NEUTRAL");
      const pending = bucketRecords.filter((r) => r.status === "PENDING");

      const decided = success.length + failed.length;
      // See note on the equivalent block in getMetrics.
      const totalEvaluated = decided + neutral.length;
      const accuracy = totalEvaluated > 0 ? Math.round((success.length / totalEvaluated) * 100) : 0;
      const winRate = decided > 0 ? success.length / decided : 0;
      const lossRate = decided > 0 ? failed.length / decided : 0;

      // See note on the equivalent block in getMetrics — magnitude only, never signed.
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

      const outlooks = ["BREAKOUT_LIKELY", "BOUNCE_EXPECTED", "REJECTION_POSSIBLE", "BREAKDOWN_RISK"];
      const byOutlook: Record<string, { total: number; wins: number; neutral: number; rate: number }> = {};
      for (const outlook of outlooks) {
        const outlookEvaluated = evaluated.filter((r) => r.outlook === outlook);
        const outlookWins = outlookEvaluated.filter((r) => r.status === "SUCCESS").length;
        const outlookNeutral = outlookEvaluated.filter((r) => r.status === "NEUTRAL").length;
        byOutlook[outlook] = {
          total: outlookEvaluated.length,
          wins: outlookWins,
          neutral: outlookNeutral,
          rate: outlookEvaluated.length > 0 ? Math.round((outlookWins / outlookEvaluated.length) * 100) : 0,
        };
      }

      result.push({
        bucket,
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
        sampleSufficient: decided >= minSamples[bucket],
        minSampleRequired: minSamples[bucket],
        byOutlook,
      });
    }

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
