import { eq, gte, isNull, and, or, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { aiCalls } from "../db/schema/ai-calls.js";
import { aiCallOutcomes } from "../db/schema/ai-call-outcomes.js";
import { marketDataService } from "./market-data.service.js";
import { computeATR } from "../lib/atr.js";
import { getAiModeEnabled } from "../lib/runtime-config.js";

// Background outcome evaluator for AI calls. Mirrors signal-tracking's
// 30-second poll pattern but scores at 15m / 30m / 60m windows.
//
// Outcome semantics:
//   PENDING       — window not yet elapsed
//   SUCCESS       — verdict was BUY/SELL and price moved ≥ 0.2% in the
//                    expected direction
//   FAILED        — verdict was BUY/SELL and price moved ≥ 0.2% against
//   NEUTRAL       — directional verdict but |change| < 0.2% dead-zone
//   WAIT_OK       — verdict was WAIT and price stayed within ±1 ATR
//   WAIT_MISSED   — verdict was WAIT but price moved ≥ 1 ATR either way
//
// Why WAIT scored separately: a WAIT that avoids a stop is a good decision.
// Without WAIT_OK / WAIT_MISSED we'd be punishing the system for prudence.

const EVAL_INTERVAL_MS = 30_000;
const NEUTRAL_THRESHOLD_PERCENT = 0.2;       // matches signal-tracking dead-zone
const WAIT_QUALITY_ATR_MULTIPLE = 1.0;       // WAIT_OK if |change| within 1 × ATR

const WINDOW_DEFS = [
  { minutes: 15, column: "outcome_15m" as const },
  { minutes: 30, column: "outcome_30m" as const },
  { minutes: 60, column: "outcome_60m" as const },
];

type OutcomeStatus = "PENDING" | "SUCCESS" | "FAILED" | "NEUTRAL" | "WAIT_OK" | "WAIT_MISSED";

interface ActiveCall {
  id: number;
  symbol: string;
  computedAt: number;
  verdict: "BUY" | "SELL" | "WAIT";
  entryPrice: number;
  /** ATR at call time — needed for WAIT-quality scoring. May be 0 if unknown. */
  atrAtCallTime: number;
}

export interface AiOutcomeServiceDeps {
  /** Optional — for richer max-favorable/adverse tracking later. Not required for v1. */
  getRecentCandles?: (symbol: string, n: number) => Array<{ high: number; low: number; close: number }>;
}

export interface AiOutcomeService {
  start(): void;
  stop(): void;
}

function classifyOutcome(
  verdict: "BUY" | "SELL" | "WAIT",
  changePercent: number,
  atrPercent: number,
): OutcomeStatus {
  // WAIT path
  if (verdict === "WAIT") {
    const tolerance = Math.max(NEUTRAL_THRESHOLD_PERCENT, atrPercent * WAIT_QUALITY_ATR_MULTIPLE);
    return Math.abs(changePercent) <= tolerance ? "WAIT_OK" : "WAIT_MISSED";
  }
  // Directional
  if (Math.abs(changePercent) < NEUTRAL_THRESHOLD_PERCENT) return "NEUTRAL";
  if (verdict === "BUY") return changePercent > 0 ? "SUCCESS" : "FAILED";
  return changePercent < 0 ? "SUCCESS" : "FAILED";
}

export function createAiOutcomeService(_deps: AiOutcomeServiceDeps = {}): AiOutcomeService {
  let evalTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Find ai_calls rows that still have at least one un-filled outcome
   * window AND whose oldest unevaluated window has elapsed. Returns the
   * minimal data needed to evaluate.
   */
  async function findActive(): Promise<ActiveCall[]> {
    // ai_calls computed ≤ 90 min ago that don't yet have all 3 outcomes
    const cutoff = new Date(Date.now() - 90 * 60_000);
    const recent = await db
      .select({
        id: aiCalls.id,
        symbol: aiCalls.symbol,
        computedAt: aiCalls.computedAt,
        verdict: aiCalls.verdict,
        entry: aiCalls.entry,
        metricsSnapshot: aiCalls.metricsSnapshot,
      })
      .from(aiCalls)
      .where(gte(aiCalls.computedAt, cutoff));

    if (recent.length === 0) return [];

    // Pull existing outcome rows for those calls
    const callIds = recent.map((r) => r.id);
    const outcomes = await db
      .select()
      .from(aiCallOutcomes)
      .where(inArray(aiCallOutcomes.aiCallId, callIds));
    const outcomeMap = new Map(outcomes.map((o) => [o.aiCallId, o]));

    const active: ActiveCall[] = [];
    for (const r of recent) {
      const existing = outcomeMap.get(r.id);
      const allFilled =
        existing &&
        existing.outcome15m !== null &&
        existing.outcome30m !== null &&
        existing.outcome60m !== null;
      if (allFilled) continue;

      // Reference price for entry. Prefer the AI's `entry` field when set
      // (BUY/SELL). For WAIT we fall back to the snapshot price embedded
      // in metrics_snapshot.
      let entryPrice = r.entry != null ? Number(r.entry) : 0;
      if (entryPrice <= 0) {
        const snap = (r.metricsSnapshot as { intelligence?: { price?: number } } | null);
        entryPrice = snap?.intelligence?.price ?? 0;
      }
      if (entryPrice <= 0) continue;

      // ATR at call time (for WAIT-quality scoring). Read from snapshot.
      const snap = (r.metricsSnapshot as { atr?: number } | null);
      const atrAtCallTime = snap?.atr ?? 0;

      active.push({
        id: r.id,
        symbol: r.symbol,
        computedAt: new Date(r.computedAt).getTime(),
        verdict: r.verdict as "BUY" | "SELL" | "WAIT",
        entryPrice,
        atrAtCallTime,
      });
    }
    return active;
  }

  async function evaluateOne(call: ActiveCall): Promise<void> {
    const quote = marketDataService.getQuote(call.symbol);
    if (!quote || quote.lastPrice <= 0) return;

    const now = Date.now();
    const ageMs = now - call.computedAt;
    const priceAfter = quote.lastPrice;
    const changePercent = ((priceAfter - call.entryPrice) / call.entryPrice) * 100;
    const atrPercent = call.atrAtCallTime > 0
      ? (call.atrAtCallTime / call.entryPrice) * 100
      : NEUTRAL_THRESHOLD_PERCENT;

    // Existing outcome row (if any) — needed to know which windows are still null
    const existing = await db
      .select()
      .from(aiCallOutcomes)
      .where(eq(aiCallOutcomes.aiCallId, call.id))
      .limit(1);
    const row = existing[0] ?? null;

    // Decide which windows to write
    const updates: Record<string, OutcomeStatus | number | boolean | null> = {};
    let didFill = false;
    for (const w of WINDOW_DEFS) {
      if (ageMs < w.minutes * 60_000) continue;             // window not yet elapsed
      const currentVal = row?.[w.column as keyof typeof row];
      if (currentVal !== null && currentVal !== undefined) continue; // already filled
      updates[w.column] = classifyOutcome(call.verdict, changePercent, atrPercent);
      didFill = true;
    }
    if (!didFill) return;

    // Always update favorable/adverse on the latest evaluation we do
    const maxFav = quote.high > 0 ? ((quote.high - call.entryPrice) / call.entryPrice) * 100 : null;
    const maxAdv = quote.low > 0 ? ((quote.low - call.entryPrice) / call.entryPrice) * 100 : null;
    if (maxFav != null) updates.max_favorable_pct = call.verdict === "SELL" ? -maxFav : maxFav;
    if (maxAdv != null) updates.max_adverse_pct = call.verdict === "SELL" ? -maxAdv : maxAdv;

    // Target/stop hit detection (only meaningful for BUY/SELL)
    if (call.verdict !== "WAIT") {
      const callMeta = await db
        .select({ stopLoss: aiCalls.stopLoss, target: aiCalls.target })
        .from(aiCalls)
        .where(eq(aiCalls.id, call.id))
        .limit(1);
      const sl = callMeta[0]?.stopLoss != null ? Number(callMeta[0].stopLoss) : null;
      const tgt = callMeta[0]?.target != null ? Number(callMeta[0].target) : null;
      if (call.verdict === "BUY") {
        if (sl != null && quote.low <= sl) updates.stop_hit = true;
        if (tgt != null && quote.high >= tgt) updates.target_hit = true;
      } else {
        if (sl != null && quote.high >= sl) updates.stop_hit = true;
        if (tgt != null && quote.low <= tgt) updates.target_hit = true;
      }
    }

    try {
      if (row) {
        await db
          .update(aiCallOutcomes)
          .set({
            outcome15m: updates.outcome_15m as string | undefined ?? row.outcome15m,
            outcome30m: updates.outcome_30m as string | undefined ?? row.outcome30m,
            outcome60m: updates.outcome_60m as string | undefined ?? row.outcome60m,
            maxFavorablePct: updates.max_favorable_pct != null ? String(updates.max_favorable_pct) : row.maxFavorablePct,
            maxAdversePct: updates.max_adverse_pct != null ? String(updates.max_adverse_pct) : row.maxAdversePct,
            targetHit: (updates.target_hit as boolean | undefined) ?? row.targetHit,
            stopHit: (updates.stop_hit as boolean | undefined) ?? row.stopHit,
            evaluatedAt: new Date(),
          })
          .where(eq(aiCallOutcomes.aiCallId, call.id));
      } else {
        await db.insert(aiCallOutcomes).values({
          aiCallId: call.id,
          outcome15m: (updates.outcome_15m as string | undefined) ?? null,
          outcome30m: (updates.outcome_30m as string | undefined) ?? null,
          outcome60m: (updates.outcome_60m as string | undefined) ?? null,
          maxFavorablePct: updates.max_favorable_pct != null ? String(updates.max_favorable_pct) : null,
          maxAdversePct: updates.max_adverse_pct != null ? String(updates.max_adverse_pct) : null,
          targetHit: (updates.target_hit as boolean | undefined) ?? null,
          stopHit: (updates.stop_hit as boolean | undefined) ?? null,
        });
      }
    } catch (err) {
      console.warn(`[AI Outcome] ${call.symbol}#${call.id} persist failed:`, (err as Error).message);
    }
  }

  async function tick(): Promise<void> {
    try {
      const active = await findActive();
      if (active.length === 0) return;
      await Promise.allSettled(active.map((c) => evaluateOne(c)));
    } catch (err) {
      console.warn("[AI Outcome] tick failed:", (err as Error).message);
    }
  }

  function start(): void {
    if (evalTimer) return;
    if (!getAiModeEnabled()) return;
    console.log(`[AI Outcome] Evaluator started — 15m/30m/60m windows, ${EVAL_INTERVAL_MS / 1000}s poll`);
    evalTimer = setInterval(() => { void tick(); }, EVAL_INTERVAL_MS);
  }

  function stop(): void {
    if (evalTimer) {
      clearInterval(evalTimer);
      evalTimer = null;
      console.log("[AI Outcome] Evaluator stopped");
    }
  }

  return { start, stop };
}
