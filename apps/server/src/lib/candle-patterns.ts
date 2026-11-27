// CANDLESTICK PATTERNS on 5-min candles — DISPLAY ONLY (a note on cards / stock page when a reversal
// pattern forms at a support / resistance line). Feeds no engine, score or call. Strict, textbook definitions
// (Nison / Bulkowski style), judged on the LAST CLOSED candle `c` and the 1–2 before it.
//
// Size context (from the stock's own recent candles, so tiny/noisy candles never count):
//   ATR    = 14-candle average true range        avgBody = average |close−open| of the 10 candles before the pattern
//   avgVol = average volume of the 20 candles before the last candle
// Geometry: body = |C−O|, range = H−L, upper = H−max(O,C), lower = min(O,C)−L.
//
// Trend context (a reversal needs something to reverse):
//   bullish: PRIOR DECLINE — the close just before the pattern is below the close 3 candles earlier,
//            AND the pattern's low is the LOWEST low of the last 6 candles
//   bearish: PRIOR RISE — mirror, pattern's high is the HIGHEST high of the last 6 candles
import type { Candle } from "./types.js";
export type Bull = "HAMMER" | "INVERTED_HAMMER" | "DRAGONFLY_DOJI" | "BULLISH_ENGULFING" | "PIERCING_LINE" | "TWEEZER_BOTTOM" | "MORNING_STAR" | "TWO_STRONG_GREEN";
export type Bear = "SHOOTING_STAR" | "HANGING_MAN" | "GRAVESTONE_DOJI" | "BEARISH_ENGULFING" | "DARK_CLOUD_COVER" | "TWEEZER_TOP" | "EVENING_STAR" | "TWO_STRONG_RED";

const body = (x: Candle) => Math.abs(x.close - x.open);
const range = (x: Candle) => x.high - x.low;
const upper = (x: Candle) => x.high - Math.max(x.open, x.close);
const lower = (x: Candle) => Math.min(x.open, x.close) - x.low;
const green = (x: Candle) => x.close > x.open;
const red = (x: Candle) => x.close < x.open;
const mid = (x: Candle) => (x.open + x.close) / 2;

export interface Ctx { atr: number; avgBody: number; avgVol: number }
/** Minimum candles to judge a pattern: ATR(14) needs 15, plus the pattern and the "prior move" check. */
export const MIN_CANDLES = 17;
/** needs ≥ MIN_CANDLES; body/volume averages use up to 10 / 20 earlier candles (fewer early in the day) */
export function context(cs: Candle[], patternLen: number): Ctx | null {
  const n = cs.length; if (n < MIN_CANDLES) return null;
  let tr = 0; for (let i = n - 14; i < n; i++) { const a = cs[i]!, b = cs[i - 1]!; tr += Math.max(a.high - a.low, Math.abs(a.high - b.close), Math.abs(a.low - b.close)); }
  const before = cs.slice(Math.max(0, n - patternLen - 10), n - patternLen), vols = cs.slice(Math.max(0, n - 21), n - 1);
  return { atr: tr / 14, avgBody: before.reduce((s, x) => s + body(x), 0) / before.length, avgVol: vols.reduce((s, x) => s + x.volume, 0) / vols.length };
}
/** a candle big enough to mean something: range ≥ 0.6 × ATR AND ≥ 0.2 % of price
 *  (the % floor stops quiet midday candles — tiny ATR — from forming "patterns") */
const real = (x: Candle, k: Ctx) => range(x) >= 0.6 * k.atr && range(x) >= 0.002 * x.close;
/** a proper body (not a doji-like candle): body ≥ 30 % of its range */
const bodied = (x: Candle) => range(x) > 0 && body(x) >= 0.3 * range(x);
/** a long candle: real, body ≥ 60 % of range and ≥ 1.2 × the average body */
const long = (x: Candle, k: Ctx) => real(x, k) && body(x) >= 0.6 * range(x) && body(x) >= 1.2 * k.avgBody;
/** prior decline before a pattern of length L ending at the last candle, and the pattern holds the lowest low of the last 6 */
function priorDecline(cs: Candle[], L: number, atLow = true): boolean {
  const n = cs.length, before = cs[n - L - 1]!, earlier = cs[n - L - 4]!;
  const patLow = Math.min(...cs.slice(n - L).map((x) => x.low));
  return before.close < earlier.close && (!atLow || patLow <= Math.min(...cs.slice(n - 6).map((x) => x.low)));
}
function priorRise(cs: Candle[], L: number, atHigh = true): boolean {
  const n = cs.length, before = cs[n - L - 1]!, earlier = cs[n - L - 4]!;
  const patHigh = Math.max(...cs.slice(n - L).map((x) => x.high));
  return before.close > earlier.close && (!atHigh || patHigh >= Math.max(...cs.slice(n - 6).map((x) => x.high)));
}
/** small-wick strong candle with volume: body ≥ 60 % of range, body ≥ average body, volume ≥ 1.5 × average */
const strong = (x: Candle, k: Ctx) => range(x) > 0 && body(x) >= 0.6 * range(x) && body(x) >= k.avgBody && x.volume >= 1.5 * k.avgVol;

// ── single-candle shapes (strict) ──
/** HAMMER shape: lower wick ≥ 2 × body, upper wick ≤ 10 % of range, a real body (> 5 % of range) in the top third */
const hammerShape = (x: Candle) => range(x) > 0 && body(x) > 0.05 * range(x) && lower(x) >= 2 * body(x) && upper(x) <= 0.1 * range(x) && Math.min(x.open, x.close) >= x.low + (2 / 3) * range(x);
/** STAR shape (inverted hammer / shooting star): upper wick ≥ 2 × body, lower wick ≤ 10 % of range, real body in the bottom third */
const starShape = (x: Candle) => range(x) > 0 && body(x) > 0.05 * range(x) && upper(x) >= 2 * body(x) && lower(x) <= 0.1 * range(x) && Math.max(x.open, x.close) <= x.low + (1 / 3) * range(x);
/** DOJI: body ≤ 5 % of range */
const doji = (x: Candle) => range(x) > 0 && body(x) <= 0.05 * range(x);

/** Bullish reversal patterns at the last candle (all that match) */
export function bullish(cs: Candle[]): Bull[] {
  const out: Bull[] = []; if (cs.length < MIN_CANDLES) return out;
  const c = cs.at(-1)!, p = cs.at(-2)!, pp = cs.at(-3)!;
  const k1 = context(cs, 1)!, k2 = context(cs, 2)!, k3 = context(cs, 3)!;
  if (k1.atr <= 0) return out;
  const tol = 0.02 * k1.atr;
  // 1-candle
  if (priorDecline(cs, 1) && real(c, k1)) {
    if (hammerShape(c)) out.push("HAMMER");
    if (starShape(c)) out.push("INVERTED_HAMMER");
    if (doji(c) && lower(c) >= 0.7 * range(c) && upper(c) <= 0.05 * range(c)) out.push("DRAGONFLY_DOJI");
  }
  // 2-candle
  if (priorDecline(cs, 2) && red(p) && green(c)) {
    if (real(p, k2) && real(c, k2) && body(p) >= 0.5 * k2.avgBody && body(c) >= 1.2 * body(p) && c.open <= p.close + tol && c.close > p.open) out.push("BULLISH_ENGULFING");
    if (long(p, k2) && real(c, k2) && c.open <= p.close + tol && c.close > mid(p) && c.close < p.open) out.push("PIERCING_LINE");
    if (real(p, k2) && real(c, k2) && bodied(p) && bodied(c) && body(p) >= 0.5 * k2.avgBody && Math.abs(p.low - c.low) <= 0.05 * k2.atr) out.push("TWEEZER_BOTTOM");
  }
  // two strong candles START the move after the low, so only "after a decline" (not "at the lowest low")
  if (priorDecline(cs, 2, false) && green(p) && green(c) && real(p, k2) && real(c, k2) && strong(p, k2) && strong(c, k2)) out.push("TWO_STRONG_GREEN");
  // 3-candle
  if (priorDecline(cs, 3) && red(pp) && long(pp, k3) && body(p) <= 0.3 * body(pp) && Math.max(p.open, p.close) <= pp.close + tol && green(c) && real(c, k3) && body(c) >= k3.avgBody && c.close > mid(pp)) out.push("MORNING_STAR");
  return out;
}
/** Bearish reversal patterns at the last candle (for REJECTION at resistance) */
export function bearish(cs: Candle[]): Bear[] {
  const out: Bear[] = []; if (cs.length < MIN_CANDLES) return out;
  const c = cs.at(-1)!, p = cs.at(-2)!, pp = cs.at(-3)!;
  const k1 = context(cs, 1)!, k2 = context(cs, 2)!, k3 = context(cs, 3)!;
  if (k1.atr <= 0) return out;
  const tol = 0.02 * k1.atr;
  if (priorRise(cs, 1) && real(c, k1)) {
    if (starShape(c)) out.push("SHOOTING_STAR");
    if (hammerShape(c)) out.push("HANGING_MAN");
    if (doji(c) && upper(c) >= 0.7 * range(c) && lower(c) <= 0.05 * range(c)) out.push("GRAVESTONE_DOJI");
  }
  if (priorRise(cs, 2) && green(p) && red(c)) {
    if (real(p, k2) && real(c, k2) && body(p) >= 0.5 * k2.avgBody && body(c) >= 1.2 * body(p) && c.open >= p.close - tol && c.close < p.open) out.push("BEARISH_ENGULFING");
    if (long(p, k2) && real(c, k2) && c.open >= p.close - tol && c.close < mid(p) && c.close > p.open) out.push("DARK_CLOUD_COVER");
    if (real(p, k2) && real(c, k2) && bodied(p) && bodied(c) && body(p) >= 0.5 * k2.avgBody && Math.abs(p.high - c.high) <= 0.05 * k2.atr) out.push("TWEEZER_TOP");
  }
  if (priorRise(cs, 2, false) && red(p) && red(c) && real(p, k2) && real(c, k2) && strong(p, k2) && strong(c, k2)) out.push("TWO_STRONG_RED");
  if (priorRise(cs, 3) && green(pp) && long(pp, k3) && body(p) <= 0.3 * body(pp) && Math.min(p.open, p.close) >= pp.close - tol && red(c) && real(c, k3) && body(c) >= k3.avgBody && c.close < mid(pp)) out.push("EVENING_STAR");
  return out;
}
/** MARUBOZU: full-body candle — body ≥ 90 % of range, body ≥ 1.5 × average body, range ≥ 1 × ATR, volume ≥ 1.5 × average */
export function marubozu(cs: Candle[], dir: "BULL" | "BEAR"): boolean {
  const k = context(cs, 1); if (!k) return false;
  const c = cs.at(-1)!;
  return (dir === "BULL" ? green(c) : red(c)) && body(c) >= 0.9 * range(c) && body(c) >= 1.5 * k.avgBody && range(c) >= k.atr && c.volume >= 1.5 * k.avgVol;
}
/** two strong same-colour candles with volume (the "or 2 such candles" case for breakout / breakdown) */
export function twoStrong(cs: Candle[], dir: "BULL" | "BEAR"): boolean {
  const k = context(cs, 2); if (!k) return false;
  const c = cs.at(-1)!, p = cs.at(-2)!, col = dir === "BULL" ? green : red;
  return col(p) && col(c) && strong(p, k) && strong(c, k);
}
