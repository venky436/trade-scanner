import { eq, isNull, lte, sql, and, gte } from "drizzle-orm";
import { db } from "../db/index.js";
import { signalAccuracyLog } from "../db/schema/signal-accuracy.js";
import { marketDataService } from "./market-data.service.js";
import { getMarketPhase } from "../lib/market-phase.js";
import type { SignalResult } from "../lib/types.js";

const MAX_DAILY_SIGNALS = 100; // total per day (not concurrent)
const MIN_RISK_REWARD = 1.0; // reward must be > risk
const REALTIME_CHECK_INTERVAL_MS = 1000; // check every 1 second

// ── Active signal tracking (no replacement, no duplicates) ──
interface ActiveSignal {
  symbol: string;
  dbId: number;
  action: "BUY" | "SELL";
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  recordedAt: number;
}

// Simple map: symbol → active signal (one per stock, no duplicates)
const activeMap = new Map<string, ActiveSignal>();
// Daily cap tracking
let dailyCount = 0;
let dailyDate = "";

function getISTDate(): string {
  return new Date().toLocaleDateString("en-US", { timeZone: "Asia/Kolkata" });
}

function checkDailyReset(): void {
  const today = getISTDate();
  if (dailyDate !== today) {
    dailyCount = 0;
    dailyDate = today;
  }
}

export function createSignalAccuracyService() {
  let realtimeTimer: ReturnType<typeof setInterval> | null = null;

  // ── Record signal (first-come, no replacement, no duplicates) ──
  async function recordSignal(
    symbol: string,
    signal: SignalResult,
    price: number,
  ): Promise<void> {
    // Skip if no signal type
    if (!signal.type) return;

    // Skip during OPENING/STABILIZING
    const { phase } = getMarketPhase();
    if (phase === "OPENING" || phase === "STABILIZING") return;

    // No duplicates: if already tracking this stock → skip
    if (activeMap.has(symbol)) return;

    // Daily cap: max 100 signals per day total (not concurrent)
    checkDailyReset();
    if (dailyCount >= MAX_DAILY_SIGNALS) return;

    const score = signal.score ?? 0;
    const isBuy = signal.action === "BUY";
    const targetPrice = isBuy ? price * 1.010 : price * 0.990;  // +1.0% / -1.0%
    const stopLoss = isBuy ? price * 0.993 : price * 1.007;     // -0.7% / +0.7%

    // Risk-reward filter: reward must be >= risk
    const risk = Math.abs(price - stopLoss);
    const reward = Math.abs(targetPrice - price);
    if (risk > 0 && reward / risk < MIN_RISK_REWARD) return;

    const now = new Date();
    // No time limit — signal stays active until target or SL is hit
    const evaluationTime = new Date(now.getTime() + 24 * 60 * 60 * 1000); // far future (end of day fallback)

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

      activeMap.set(symbol, {
        symbol,
        dbId: inserted.id,
        action: signal.action as "BUY" | "SELL",
        entryPrice: price,
        targetPrice,
        stopLoss,
        recordedAt: Date.now(),
      });
      dailyCount++;

      console.log(`[Accuracy] Recorded: ${symbol} ${signal.action} ${signal.type} score=${score} entry=₹${price.toFixed(2)} target=₹${targetPrice.toFixed(2)} SL=₹${stopLoss.toFixed(2)} [${dailyCount}/${MAX_DAILY_SIGNALS} today, ${activeMap.size} active]`);
    } catch (err: any) {
      console.warn(`[Accuracy] Failed to record ${symbol}:`, err.message);
    }
  }

  // ── Real-time evaluation: check live price against target/SL every second ──
  async function evaluateRealTime(): Promise<void> {
    if (activeMap.size === 0) return;

    const toClose: { symbol: string; result: "SUCCESS" | "FAILED"; price: number }[] = [];

    for (const [symbol, sig] of activeMap) {
      const quote = marketDataService.getQuote(symbol);
      if (!quote || quote.lastPrice <= 0) continue;

      const price = quote.lastPrice;

      if (sig.action === "BUY") {
        if (price >= sig.targetPrice) {
          toClose.push({ symbol, result: "SUCCESS", price });
        } else if (price <= sig.stopLoss) {
          toClose.push({ symbol, result: "FAILED", price });
        }
      } else {
        // SELL
        if (price <= sig.targetPrice) {
          toClose.push({ symbol, result: "SUCCESS", price });
        } else if (price >= sig.stopLoss) {
          toClose.push({ symbol, result: "FAILED", price });
        }
      }
    }

    // Close signals that hit target or SL
    for (const { symbol, result, price } of toClose) {
      const sig = activeMap.get(symbol);
      if (!sig) continue;

      const pnlPercent = sig.action === "BUY"
        ? ((price - sig.entryPrice) / sig.entryPrice) * 100
        : ((sig.entryPrice - price) / sig.entryPrice) * 100;

      try {
        await db.update(signalAccuracyLog).set({
          finalPrice: price.toFixed(2),
          maxPrice: price.toFixed(2),
          minPrice: price.toFixed(2),
          targetHitTime: result === "SUCCESS" ? new Date() : null,
          stopHitTime: result === "FAILED" ? new Date() : null,
          result,
        }).where(eq(signalAccuracyLog.id, sig.dbId));

        activeMap.delete(symbol);
        console.log(`[Accuracy] ${result}: ${symbol} ${sig.action} at ₹${price.toFixed(2)} (${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(2)}%) [${activeMap.size} active]`);
      } catch (err: any) {
        console.warn(`[Accuracy] Failed to close ${symbol}:`, err.message);
      }
    }
  }

  // ── Market close cleanup: close all remaining signals as NEUTRAL at end of day ──
  async function evaluateMarketClose(): Promise<void> {
    // Only run after market close (3:30 PM IST = 15:30)
    const { phase } = getMarketPhase();
    if (phase !== "CLOSED" || activeMap.size === 0) return;

    console.log(`[Accuracy] Market closed — closing ${activeMap.size} remaining signals as NEUTRAL`);

    for (const [symbol, sig] of [...activeMap]) {
      const quote = marketDataService.getQuote(symbol);
      const finalPrice = quote?.lastPrice ?? sig.entryPrice;
      const pnlPercent = sig.action === "BUY"
        ? ((finalPrice - sig.entryPrice) / sig.entryPrice) * 100
        : ((sig.entryPrice - finalPrice) / sig.entryPrice) * 100;

      try {
        await db.update(signalAccuracyLog).set({
          finalPrice: finalPrice.toFixed(2),
          maxPrice: (quote?.high ?? finalPrice).toFixed(2),
          minPrice: (quote?.low ?? finalPrice).toFixed(2),
          result: "NEUTRAL",
        }).where(eq(signalAccuracyLog.id, sig.dbId));

        activeMap.delete(symbol);
        console.log(`[Accuracy] NEUTRAL (market close): ${symbol} ${sig.action} at ₹${finalPrice.toFixed(2)} (${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(2)}%)`);
      } catch (err: any) {
        console.warn(`[Accuracy] Failed to close ${symbol}:`, err.message);
      }
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
    evaluateRealTime,

    start() {
      // Real-time: check target/SL every 1 second
      realtimeTimer = setInterval(evaluateRealTime, REALTIME_CHECK_INTERVAL_MS);
      realtimeTimer.unref();
      // Market close cleanup: check every 5 min, closes remaining signals after 3:30 PM
      const marketCloseTimer = setInterval(evaluateMarketClose, 5 * 60 * 1000);
      marketCloseTimer.unref();
      console.log("[Accuracy] Started — real-time eval (1s), no time limit, market close cleanup");
    },

    stop() {
      if (realtimeTimer) { clearInterval(realtimeTimer); realtimeTimer = null; }
      console.log("[Accuracy] Stopped");
    },

    getMetrics,
    getRecentSignals,
  };
}

export type SignalAccuracyService = ReturnType<typeof createSignalAccuracyService>;
