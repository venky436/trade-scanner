import { eq, isNull, lte, sql, and, gte } from "drizzle-orm";
import { db } from "../db/index.js";
import { signalAccuracyLog } from "../db/schema/signal-accuracy.js";
import { marketDataService } from "./market-data.service.js";
import { getMarketPhase } from "../lib/market-phase.js";
import type { SignalResult } from "../lib/types.js";

const MAX_ACTIVE_SIGNALS = 25;
const MAX_PER_STOCK = 2; // diversity: max 2 signals per stock
const MIN_RISK_REWARD = 1.0; // minimum RR ratio to accept
const EVALUATION_WINDOW_MS = 20 * 60 * 1000; // 20 minutes
const EVAL_CRON_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ── Priority Queue: track active signals with scores for eviction ──
interface ActiveSignal {
  symbol: string;
  score: number;
  dbId?: number; // DB row id for deletion if evicted
  recordedAt: number;
}

// Active signals sorted by score (lowest first for easy eviction)
const activeSignals: ActiveSignal[] = [];
// Quick lookup: how many active signals per stock
const stockCount = new Map<string, number>();

function getLowestSignal(): ActiveSignal | null {
  if (activeSignals.length === 0) return null;
  let lowest = activeSignals[0];
  for (let i = 1; i < activeSignals.length; i++) {
    if (activeSignals[i].score < lowest.score) lowest = activeSignals[i];
  }
  return lowest;
}

function removeSignalBySymbol(symbol: string): void {
  const idx = activeSignals.findIndex((s) => s.symbol === symbol);
  if (idx !== -1) {
    activeSignals.splice(idx, 1);
    const count = stockCount.get(symbol) ?? 0;
    if (count <= 1) stockCount.delete(symbol);
    else stockCount.set(symbol, count - 1);
  }
}

function removeLowestSignal(): ActiveSignal | null {
  const lowest = getLowestSignal();
  if (!lowest) return null;
  const idx = activeSignals.indexOf(lowest);
  if (idx !== -1) {
    activeSignals.splice(idx, 1);
    const count = stockCount.get(lowest.symbol) ?? 0;
    if (count <= 1) stockCount.delete(lowest.symbol);
    else stockCount.set(lowest.symbol, count - 1);
  }
  return lowest;
}

function addSignal(entry: ActiveSignal): void {
  activeSignals.push(entry);
  stockCount.set(entry.symbol, (stockCount.get(entry.symbol) ?? 0) + 1);
}

export function createSignalAccuracyService() {
  let evalTimer: ReturnType<typeof setInterval> | null = null;

  // ── Record a high-confidence signal (priority-based) ──
  async function recordSignal(
    symbol: string,
    signal: SignalResult,
    price: number,
  ): Promise<void> {
    // Skip if no signal type
    if (!signal.type) return;

    // Skip during OPENING/STABILIZING — signals are unreliable
    const { phase } = getMarketPhase();
    if (phase === "OPENING" || phase === "STABILIZING") return;

    const score = signal.score ?? 0;

    // Diversity: max 2 signals per stock
    if ((stockCount.get(symbol) ?? 0) >= MAX_PER_STOCK) return;

    const isBuy = signal.action === "BUY";
    const targetPrice = isBuy ? price * 1.016 : price * 0.984;
    const stopLoss = isBuy ? price * 0.989 : price * 1.011;

    // Risk-reward filter: reward must be >= risk
    const risk = Math.abs(price - stopLoss);
    const reward = Math.abs(targetPrice - price);
    if (risk > 0 && reward / risk < MIN_RISK_REWARD) return;

    // Priority queue: if full, evict lowest score if new signal is better
    if (activeSignals.length >= MAX_ACTIVE_SIGNALS) {
      const lowest = getLowestSignal();
      if (!lowest || score <= lowest.score) return; // new signal not better → discard

      // Evict lowest
      removeLowestSignal();
      console.log(`[Accuracy] Evicted: ${lowest.symbol} (score ${lowest.score}) → replaced by ${symbol} (score ${score})`);
    }

    const now = new Date();
    const evaluationTime = new Date(now.getTime() + EVALUATION_WINDOW_MS);

    try {
      const [inserted] = await db.insert(signalAccuracyLog).values({
        symbol,
        signalType: signal.type,
        action: signal.action,
        signalScore: score,
        entryPrice: price.toFixed(2),
        entryTime: now,
        targetPrice: targetPrice.toFixed(2),
        stopLoss: stopLoss.toFixed(2),
        evaluationTime,
      }).returning({ id: signalAccuracyLog.id });

      addSignal({ symbol, score, dbId: inserted?.id, recordedAt: Date.now() });
      console.log(`[Accuracy] Recorded: ${symbol} ${signal.action} ${signal.type} score=${score} entry=₹${price.toFixed(2)} target=₹${targetPrice.toFixed(2)} SL=₹${stopLoss.toFixed(2)} [${activeSignals.length}/${MAX_ACTIVE_SIGNALS} active]`);
    } catch (err: any) {
      console.warn(`[Accuracy] Failed to record ${symbol}:`, err.message);
    }
  }

  // ── Evaluate pending signals ──
  async function evaluatePending(): Promise<void> {
    try {
      const pending = await db
        .select()
        .from(signalAccuracyLog)
        .where(
          and(
            isNull(signalAccuracyLog.result),
            lte(signalAccuracyLog.evaluationTime, new Date()),
          )
        )
        .limit(25);

      if (pending.length === 0) return;

      console.log(`[Accuracy] Evaluating ${pending.length} pending signals...`);

      for (const record of pending) {
        const quote = marketDataService.getQuote(record.symbol);
        const currentPrice = quote?.lastPrice ?? 0;
        const high = quote?.high ?? 0;
        const low = quote?.low ?? 0;

        const entryPrice = Number(record.entryPrice);
        const targetPrice = Number(record.targetPrice);
        const stopLoss = Number(record.stopLoss);
        const isBuy = record.action === "BUY";

        // Use day's high/low as proxy for max/min in evaluation window
        const maxPrice = Math.max(high, currentPrice);
        const minPrice = low > 0 ? Math.min(low, currentPrice) : currentPrice;
        const finalPrice = currentPrice > 0 ? currentPrice : entryPrice;

        // First-hit logic
        let targetHit = false;
        let stopHit = false;

        if (isBuy) {
          targetHit = maxPrice >= targetPrice;
          stopHit = minPrice <= stopLoss;
        } else {
          targetHit = minPrice <= targetPrice;
          stopHit = maxPrice >= stopLoss;
        }

        let result: "SUCCESS" | "FAILED" | "NEUTRAL";
        if (targetHit && !stopHit) {
          result = "SUCCESS";
        } else if (stopHit && !targetHit) {
          result = "FAILED";
        } else if (targetHit && stopHit) {
          // Both hit — use final price to decide
          const pnl = isBuy ? finalPrice - entryPrice : entryPrice - finalPrice;
          result = pnl > 0 ? "SUCCESS" : "FAILED";
        } else {
          result = "NEUTRAL";
        }

        const pnlPercent = isBuy
          ? ((finalPrice - entryPrice) / entryPrice) * 100
          : ((entryPrice - finalPrice) / entryPrice) * 100;

        await db
          .update(signalAccuracyLog)
          .set({
            maxPrice: maxPrice.toFixed(2),
            minPrice: minPrice.toFixed(2),
            finalPrice: finalPrice.toFixed(2),
            targetHitTime: targetHit ? new Date() : null,
            stopHitTime: stopHit ? new Date() : null,
            result,
          })
          .where(eq(signalAccuracyLog.id, record.id));

        removeSignalBySymbol(record.symbol);
        console.log(`[Accuracy] Evaluated: ${record.symbol} ${record.action} → ${result} (${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(2)}%) [${activeSignals.length}/${MAX_ACTIVE_SIGNALS} active]`);
      }
    } catch (err: any) {
      console.warn("[Accuracy] Evaluation error:", err.message);
    }
  }

  // ── Metrics ──
  async function getMetrics(date?: Date) {
    const targetDate = date ?? new Date();
    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    try {
      const records = await db
        .select()
        .from(signalAccuracyLog)
        .where(
          and(
            gte(signalAccuracyLog.entryTime, dayStart),
            lte(signalAccuracyLog.entryTime, dayEnd),
          )
        );

      const total = records.length;
      const evaluated = records.filter((r) => r.result !== null);
      const success = evaluated.filter((r) => r.result === "SUCCESS").length;
      const failed = evaluated.filter((r) => r.result === "FAILED").length;
      const neutral = evaluated.filter((r) => r.result === "NEUTRAL").length;
      const pending = records.filter((r) => r.result === null).length;

      const accuracy = evaluated.length > 0 ? Math.round((success / evaluated.length) * 100) : 0;

      // Win rate by type
      const types = ["BREAKOUT", "BREAKDOWN", "BOUNCE", "REJECTION"];
      const winRateByType: Record<string, { total: number; wins: number; rate: number }> = {};
      for (const type of types) {
        const typeRecords = evaluated.filter((r) => r.signalType === type);
        const typeWins = typeRecords.filter((r) => r.result === "SUCCESS").length;
        winRateByType[type] = {
          total: typeRecords.length,
          wins: typeWins,
          rate: typeRecords.length > 0 ? Math.round((typeWins / typeRecords.length) * 100) : 0,
        };
      }

      // Avg gain/loss
      const gains: number[] = [];
      const losses: number[] = [];
      for (const r of evaluated) {
        const entry = Number(r.entryPrice);
        const final = Number(r.finalPrice);
        if (!entry || !final) continue;
        const pnl = r.action === "BUY"
          ? ((final - entry) / entry) * 100
          : ((entry - final) / entry) * 100;
        if (r.result === "SUCCESS") gains.push(pnl);
        if (r.result === "FAILED") losses.push(pnl);
      }

      const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / gains.length : 0;
      const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
      const riskReward = avgLoss !== 0 ? Math.abs(avgGain / avgLoss) : 0;

      return {
        date: dayStart.toISOString().split("T")[0],
        total,
        pending,
        success,
        failed,
        neutral,
        accuracy,
        winRateByType,
        avgGain: Math.round(avgGain * 100) / 100,
        avgLoss: Math.round(avgLoss * 100) / 100,
        riskReward: Math.round(riskReward * 100) / 100,
      };
    } catch (err: any) {
      console.warn("[Accuracy] Metrics error:", err.message);
      return null;
    }
  }

  // ── Recent signals ──
  async function getRecentSignals(limit = 50) {
    try {
      return await db
        .select()
        .from(signalAccuracyLog)
        .orderBy(sql`${signalAccuracyLog.entryTime} DESC`)
        .limit(limit);
    } catch {
      return [];
    }
  }

  return {
    recordSignal,

    start() {
      evalTimer = setInterval(evaluatePending, EVAL_CRON_INTERVAL_MS);
      evalTimer.unref();
      console.log("[Accuracy] Evaluation cron started (every 5 min)");
    },

    stop() {
      if (evalTimer) { clearInterval(evalTimer); evalTimer = null; }
      console.log("[Accuracy] Evaluation cron stopped");
    },

    getMetrics,
    getRecentSignals,
  };
}

export type SignalAccuracyService = ReturnType<typeof createSignalAccuracyService>;
