// Trade setups — the ranked list shown on the Trade screen AND used by the
// auto-trader. One function, so what you see is exactly what auto trades.
//
//   ready = near support/resistance + directional outlook (bounce, breakout,
//           rejection, breakdown) + a trade plan
//           + inside the CALL WINDOW (09:30–14:00 IST)
//           + the confirmation candle traded ≥ 1.2× the average volume
//           → highest confidence first
//   watch = near support/resistance, building but not ready yet (includes
//           setups held back by the window / volume rule)
//
// Why the window + volume rule (replay, 154 stocks × 15 days, 2026-11-09):
// calls before 09:30 lost heavily (opening noise, esp. SELL); the volume
// rule kept fewer calls with a better average. Indices are never traded.
//
// DAY LEVELS + STOCKS IN PLAY (2026-11-10, when deps.getDayLevels is given):
//   the call is about today's frozen S1–S3 / R1–R3 lines (lib/day-levels.ts),
//   and READY also needs the stock to be "in play" today: gap ≥ 0.7 % at the
//   open OR first-15-min volume ≥ 2× normal. A stock whose lines are not
//   computed yet gives no call.
import { marketDataService } from "../services/market-data.service.js";
import { toIntelligence } from "./intelligence-transformer.js";
import { DIRECTIONAL_OUTLOOKS } from "./section-selector.js";
import { isIndexSymbol } from "./index-symbols.js";
import { stockInPlay, IN_PLAY_GAP_PCT, IN_PLAY_VOLUME_MULT, type DayLevels } from "./day-levels.js";
import type { Candle, IntelligenceSnapshot, MomentumResult, PressureResult, SupportResistanceResult } from "./types.js";

export interface SetupDeps {
  getCachedLevels: () => Record<string, SupportResistanceResult>;
  getPressure: (symbol: string) => PressureResult | null;
  getMomentum: (symbol: string) => MomentumResult | null;
  getRecentCandles: (symbol: string, n: number) => Candle[];
  getAllSymbols: () => string[];
  /** Today's frozen lines (null = not computed yet). Omit → old single-S/R rules. */
  getDayLevels?: (symbol: string) => DayLevels | null;
  /** Today's closed 5-min candles, oldest first (needed with getDayLevels). */
  getSessionCandles?: (symbol: string) => Candle[];
}

/** New calls only inside this IST window (minutes since midnight). */
export const CALL_WINDOW_START = 9 * 60 + 30; // 09:30
export const CALL_WINDOW_END = 14 * 60; // 14:00
export const CALL_WINDOW_LABEL = "09:30–14:00";
/** Confirmation candle volume must be ≥ this × the average of the candles before it. */
export const CALL_VOLUME_MULT = 1.2;
const VOLUME_AVG_LOOKBACK = 20;

/** Minutes since midnight IST for a timestamp. */
export function istMinutes(nowMs: number): number {
  const d = new Date(nowMs + 330 * 60_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
export function inCallWindow(nowMs: number): boolean {
  const m = istMinutes(nowMs);
  return m >= CALL_WINDOW_START && m < CALL_WINDOW_END;
}
/**
 * The last CLOSED candle (the one that confirmed the setup) traded at least
 * 1.2× the average volume of up to 20 candles before it. Needs ≥ 2 earlier
 * candles for a baseline — otherwise false (no volume proof yet).
 */
export function passesCallVolume(candles: Candle[]): boolean {
  if (candles.length < 3) return false;
  const last = candles[candles.length - 1]!;
  const prior = candles.slice(-(VOLUME_AVG_LOOKBACK + 1), -1);
  const avg = prior.reduce((s, c) => s + c.volume, 0) / prior.length;
  return avg > 0 && last.volume >= CALL_VOLUME_MULT * avg;
}

export interface TradeSetups {
  ready: IntelligenceSnapshot[];
  watch: IntelligenceSnapshot[];
  poolSize: number;
  timestamp: number;
  rules: { window: string; inWindow: boolean; volumeMult: number; dayLevels?: boolean; inPlay?: string };
}

export function buildTradeSetups(deps: SetupDeps, limit = 10, nowMs = Date.now()): TradeSetups {
  const levels = deps.getCachedLevels();
  const pool: IntelligenceSnapshot[] = [];
  const volumeOk = new Set<string>();
  const useDayLevels = typeof deps.getDayLevels === "function";
  const inPlayOk = new Set<string>();
  const inWindow = inCallWindow(nowMs);
  for (const sym of deps.getAllSymbols()) {
    if (isIndexSymbol(sym)) continue;
    const quote = marketDataService.getQuote(sym);
    if (!quote || quote.lastPrice <= 0) continue;
    const recentCandles = deps.getRecentCandles(sym, 24);
    if (passesCallVolume(recentCandles)) volumeOk.add(sym);
    const dayLevels = useDayLevels ? (deps.getDayLevels!(sym) ?? null) : undefined;
    const sessionCandles = useDayLevels ? (deps.getSessionCandles?.(sym) ?? recentCandles) : undefined;
    if (dayLevels && sessionCandles && stockInPlay(dayLevels, sessionCandles).inPlay) inPlayOk.add(sym);
    pool.push(
      toIntelligence({
        symbol: sym,
        price: quote.lastPrice,
        open: quote.open,
        high: quote.high,
        low: quote.low,
        close: quote.close,
        timestamp: quote.timestamp,
        pressure: deps.getPressure(sym),
        momentum: deps.getMomentum(sym),
        sr: levels[sym] ?? null,
        recentCandles,
        ...(useDayLevels ? { dayLevels, sessionCandles } : {}),
      }),
    );
  }
  const nearZone = pool.filter((s) => s.context.zone === "NEAR_SUPPORT" || s.context.zone === "NEAR_RESISTANCE");
  const byConfidence = (a: IntelligenceSnapshot, b: IntelligenceSnapshot) => b.confidence - a.confidence;
  const ready = inWindow
    ? nearZone
        .filter((s) => DIRECTIONAL_OUTLOOKS.has(s.outlook) && s.tradePlan && volumeOk.has(s.symbol) && (!useDayLevels || inPlayOk.has(s.symbol)))
        .sort(byConfidence)
        .slice(0, limit)
    : [];
  const readySet = new Set(ready.map((s) => s.symbol));
  const watch = nearZone
    .filter((s) => !readySet.has(s.symbol) && s.confidence >= 0.5)
    .sort(byConfidence)
    .slice(0, 10);
  return {
    ready,
    watch,
    poolSize: pool.length,
    timestamp: nowMs,
    rules: {
      window: CALL_WINDOW_LABEL,
      inWindow,
      volumeMult: CALL_VOLUME_MULT,
      ...(useDayLevels ? { dayLevels: true, inPlay: `gap ≥ ${IN_PLAY_GAP_PCT}% or first-15-min volume ≥ ${IN_PLAY_VOLUME_MULT}× normal` } : {}),
    },
  };
}
