// MARKET STRUCTURE — higher highs / higher lows on today's 5-min candles.
//
// Display-only (home-screen "Trend Structure" section). It does NOT feed any
// engine, confidence score, call rule or the auto-trader.
//
// 1. SWINGS (fractal rule, CONFIRMED only):
//    swing HIGH at candle i: high[i] > every high of the `width` candles before
//                            AND ≥ every high of the `width` candles after
//    swing LOW  at candle i: low[i]  < every low  of the `width` candles before
//                            AND ≤ every low  of the `width` candles after
//    → a swing is only known `width` candles later (default 2 = 10 min delay).
// 2. CLEAN-UP so highs and lows ALTERNATE and tiny wiggles don't count:
//    - two highs in a row → keep the higher (two lows → keep the lower)
//    - a swing that is closer to the previous (opposite) swing than
//      max(minMoveAtr × ATR, minMovePct × price) is noise → dropped
//      (the % floor stops quiet afternoons — tiny 5-min candles — from
//      turning small wiggles into "swings")
//    - a candle that is BOTH a swing high and a swing low (one big candle
//      making a new high and a new low) is ambiguous — inside a 5-min candle
//      we can't tell which came first — so it is not used
// 3. LABELS vs the previous swing of the same type:
//    HH (higher high) / LH (lower high) / HL (higher low) / LL (lower low)
// 4. TREND from the latest high label and latest low label:
//    HH + HL → UP      LH + LL → DOWN      anything else → SIDEWAYS
//    BROKEN: an UP trend whose last close is below the latest swing low (or a
//    DOWN trend closing above the latest swing high) → reported as SIDEWAYS
//    with broken = true.
// 5. STEPS = how many of the latest labels in a row agree with the trend
//    (e.g. HL, HH, HL, HH → 4). Used to rank the clearest trends.

import type { Candle } from "./types.js";
import { computeATR } from "./atr.js";

export type SwingType = "HIGH" | "LOW";
export type SwingLabel = "HH" | "LH" | "HL" | "LL";
export type StructureTrend = "UP" | "DOWN" | "SIDEWAYS";

export interface Swing {
  type: SwingType;
  price: number;
  time: number; // candle open time (epoch seconds)
  index: number; // index in the candle array
  label?: SwingLabel; // set from the 2nd swing of each type onwards
}

export interface MarketStructure {
  trend: StructureTrend;
  broken: boolean; // a trend that the last close just broke
  steps: number; // consecutive labels agreeing with the trend (0 when SIDEWAYS)
  swings: Swing[]; // confirmed, alternating, noise-filtered
  lastHigh: Swing | null;
  lastLow: Swing | null;
  atr: number | null;
}

export interface StructureOptions {
  width?: number; // candles each side (default 2)
  minMoveAtr?: number; // min distance between opposite swings in ATR (default 1.5)
  minMovePct?: number; // …and at least this fraction of price (default 0.004 = 0.4 %)
}

const EMPTY: MarketStructure = { trend: "SIDEWAYS", broken: false, steps: 0, swings: [], lastHigh: null, lastLow: null, atr: null };

/** Raw fractal swings (confirmed: needs `width` candles on both sides). */
export function rawSwings(cs: Candle[], width = 2): Swing[] {
  const out: Swing[] = [];
  for (let i = width; i < cs.length - width; i++) {
    const c = cs[i]!;
    let isHigh = true, isLow = true;
    for (let j = 1; j <= width; j++) {
      const b = cs[i - j]!, a = cs[i + j]!;
      if (!(c.high > b.high && c.high >= a.high)) isHigh = false;
      if (!(c.low < b.low && c.low <= a.low)) isLow = false;
    }
    if (isHigh && isLow) continue; // ambiguous outside candle — don't guess the order
    if (isHigh) out.push({ type: "HIGH", price: c.high, time: c.time, index: i });
    if (isLow) out.push({ type: "LOW", price: c.low, time: c.time, index: i });
  }
  return out;
}

/** Alternate highs/lows and drop swings smaller than minMove from the previous opposite swing. */
export function cleanSwings(raw: Swing[], minMove: number): Swing[] {
  const out: Swing[] = [];
  for (const s of raw) {
    const last = out[out.length - 1];
    if (!last) { out.push({ ...s }); continue; }
    if (last.type === s.type) {
      // same type twice → keep the more extreme one
      if ((s.type === "HIGH" && s.price > last.price) || (s.type === "LOW" && s.price < last.price)) out[out.length - 1] = { ...s };
      continue;
    }
    // opposite type: must be a real move away from the last swing
    if (Math.abs(s.price - last.price) < minMove) continue;
    out.push({ ...s });
  }
  return out;
}

/** Label each swing vs the previous swing of the same type. */
export function labelSwings(swings: Swing[]): Swing[] {
  let prevHigh: Swing | null = null, prevLow: Swing | null = null;
  return swings.map((s) => {
    const x = { ...s };
    if (s.type === "HIGH") { if (prevHigh) x.label = s.price > prevHigh.price ? "HH" : "LH"; prevHigh = s; }
    else { if (prevLow) x.label = s.price > prevLow.price ? "HL" : "LL"; prevLow = s; }
    return x;
  });
}

// ── Trend STAGE for the watch list (display only) ──────────────────────────
//   CONFIRMED  3+ agreeing swings in a row and price moved ≥ 1 % since the
//              first of them
//   EARLY      a trend just forming, price moved ≥ 0.5 %:
//              - 2 agreeing swings (the first HH + HL, or LH + LL), or
//              - the latest swing low is a HIGHER LOW (formed after the latest
//                swing high) and price is now ABOVE that swing high — the
//                higher high is happening right now, before it can be
//                confirmed as a swing (mirror for a downtrend)
//   null       nothing clear
export type TrendStage = "CONFIRMED" | "EARLY";
export const CONFIRMED_MIN_STEPS = 3;
export const CONFIRMED_MIN_MOVE_PCT = 1;
export const EARLY_MIN_MOVE_PCT = 0.5;
export interface TrendRead {
  trend: "UP" | "DOWN";
  stage: TrendStage;
  steps: number; // agreeing confirmed swings (1 = the forming case)
  start: Swing; // first swing of the trend
  movePct: number; // % moved since `start`, in the trend's direction
}
/** `price` = the LIVE price (the structure itself is built from closed candles). */
export function trendStage(m: MarketStructure, price: number): TrendRead | null {
  if (!(price > 0) || m.broken) return null;
  let trend: "UP" | "DOWN" | null = null, steps = 0, start: Swing | undefined;
  if (m.trend !== "SIDEWAYS" && m.steps >= 2) {
    trend = m.trend; steps = m.steps; start = m.swings[m.swings.length - m.steps];
  } else if (m.lastHigh && m.lastLow) {
    if (m.lastLow.label === "HL" && m.lastLow.index > m.lastHigh.index && price > m.lastHigh.price) { trend = "UP"; steps = 1; start = m.lastLow; }
    else if (m.lastHigh.label === "LH" && m.lastHigh.index > m.lastLow.index && price < m.lastLow.price) { trend = "DOWN"; steps = 1; start = m.lastHigh; }
  }
  if (!trend || !start) return null;
  // the LIVE price can break the structure before the 5-min candle closes
  if (trend === "UP" && m.lastLow && price < m.lastLow.price) return null;
  if (trend === "DOWN" && m.lastHigh && price > m.lastHigh.price) return null;
  const movePct = ((price - start.price) / start.price) * 100 * (trend === "UP" ? 1 : -1);
  if (steps >= CONFIRMED_MIN_STEPS && movePct >= CONFIRMED_MIN_MOVE_PCT) return { trend, stage: "CONFIRMED", steps, start, movePct };
  if (movePct >= EARLY_MIN_MOVE_PCT) return { trend, stage: "EARLY", steps, start, movePct };
  return null;
}

/** Market structure of a candle series (oldest first). */
export function marketStructure(cs: Candle[], opts: StructureOptions = {}): MarketStructure {
  const width = opts.width ?? 2;
  if (cs.length < 2 * width + 3) return EMPTY;
  const atr = computeATR(cs, 14);
  if (!atr || !(atr > 0)) return EMPTY;
  const price = cs[cs.length - 1]!.close;
  // defaults chosen on real NSE charts (6 & 9 Nov 2026) with the user: smaller swings were noise
  const minMove = Math.max((opts.minMoveAtr ?? 1.5) * atr, (opts.minMovePct ?? 0.004) * price);
  const swings = labelSwings(cleanSwings(rawSwings(cs, width), minMove));
  const highs = swings.filter((s) => s.type === "HIGH"), lows = swings.filter((s) => s.type === "LOW");
  const lastHigh = highs.at(-1) ?? null, lastLow = lows.at(-1) ?? null;
  if (!lastHigh?.label || !lastLow?.label) return { ...EMPTY, swings, lastHigh, lastLow, atr };

  let trend: StructureTrend = "SIDEWAYS";
  if (lastHigh.label === "HH" && lastLow.label === "HL") trend = "UP";
  else if (lastHigh.label === "LH" && lastLow.label === "LL") trend = "DOWN";

  const close = cs[cs.length - 1]!.close;
  let broken = false;
  if (trend === "UP" && close < lastLow.price) broken = true;
  if (trend === "DOWN" && close > lastHigh.price) broken = true;
  if (broken) return { trend: "SIDEWAYS", broken: true, steps: 0, swings, lastHigh, lastLow, atr };

  let steps = 0;
  if (trend !== "SIDEWAYS") {
    const ok = trend === "UP" ? new Set<SwingLabel>(["HH", "HL"]) : new Set<SwingLabel>(["LH", "LL"]);
    for (let i = swings.length - 1; i >= 0; i--) { const l = swings[i]!.label; if (!l || !ok.has(l)) break; steps++; }
  }
  return { trend, broken: false, steps, swings, lastHigh, lastLow, atr };
}
