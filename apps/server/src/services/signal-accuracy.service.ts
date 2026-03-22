import { eq, isNull, lte, sql, and, gte } from "drizzle-orm";
import { db } from "../db/index.js";
import { signalAccuracyLog } from "../db/schema/signal-accuracy.js";
import { marketDataService } from "./market-data.service.js";
import { getMarketPhase } from "../lib/market-phase.js";
import type { SignalResult } from "../lib/types.js";

const MAX_ACTIVE_SIGNALS = 25;
const EVALUATION_WINDOW_MS = 20 * 60 * 1000; // 20 minutes
const EVAL_CRON_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Track active (unevaluated) signals to avoid duplicates
const activeSymbols = new Set<string>();

export function createSignalAccuracyService() {
  let evalTimer: ReturnType<typeof setInterval> | null = null;

  // ── Record a high-confidence signal ──
  async function recordSignal(
    symbol: string,
    signal: SignalResult,
    price: number,
  ): Promise<void> {
    // Skip if already tracking this symbol
    if (activeSymbols.has(symbol)) return;

    // Skip if no signal type
    if (!signal.type) return;

    // Skip during OPENING/STABILIZING — signals are unreliable
    const { phase } = getMarketPhase();
    if (phase === "OPENING" || phase === "STABILIZING") return;

    // Skip if too many active signals
    if (activeSymbols.size >= MAX_ACTIVE_SIGNALS) return;

    const now = new Date();
    const isBuy = signal.action === "BUY";

    const targetPrice = isBuy ? price * 1.016 : price * 0.984;
    const stopLoss = isBuy ? price * 0.989 : price * 1.011;
    const evaluationTime = new Date(now.getTime() + EVALUATION_WINDOW_MS);

    try {
      await db.insert(signalAccuracyLog).values({
        symbol,
        signalType: signal.type,
        action: signal.action,
        signalScore: signal.score ?? 0,
        entryPrice: price.toFixed(2),
        entryTime: now,
        targetPrice: targetPrice.toFixed(2),
        stopLoss: stopLoss.toFixed(2),
        evaluationTime,
      });

      activeSymbols.add(symbol);
      console.log(`[Accuracy] Recorded: ${symbol} ${signal.action} ${signal.type} score=${signal.score} entry=₹${price.toFixed(2)} target=₹${targetPrice.toFixed(2)} SL=₹${stopLoss.toFixed(2)}`);
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

        activeSymbols.delete(record.symbol);
        console.log(`[Accuracy] Evaluated: ${record.symbol} ${record.action} → ${result} (${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(2)}%)`);
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
