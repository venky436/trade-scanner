// DAY LEVELS — the support / resistance lines the tool trades for ONE day.
//
// Computed ONCE per stock after the open (09:15 IST) and FROZEN for the whole
// day: no recalculation, no re-labelling (user decision, 2026-11-10).
//
//   1. Previous 10 daily candles (today excluded). Each day gives its HIGH and
//      LOW (weight 1) and CLOSE (weight 0.6), times a recency factor
//      exp(−daysAgo / 5) → yesterday 1.00, 2 days ago 0.82, 3 days 0.67 …
//   2. Only prices within ±5 % of today's OPEN.
//   3. Prices close together are grouped: a group may span at most
//      GROUP_WIDTH = max(GROUP_ATR × daily ATR, GROUP_MIN_PCT × open) from its
//      lowest price (no chaining — the old levels.service rule, 0.5 ATR with
//      a running average, merged 3–4 % of price into one "level").
//      Group price = weighted average, group STRENGTH = total weight.
//   4. A group counts only if its prices come from at least 2 DIFFERENT days
//      (a day's low + close alone is one touch, not two).
//   5. Below the open: the 3 strongest groups → supports. Above: the 3
//      strongest → resistances (was 2; 3 per side added good calls in the
//      1-year replay, 2026-11-10). Named by distance from the open:
//      S1 = nearest support … S3 = farthest; R1 = nearest resistance … R3.
//      Each line is a small zone (± max(0.15 × daily ATR, 0.2 % of the open)).
//
// During the day the tool watches ALL of these lines (evaluateDayLevels):
//   BOUNCE    BUY   a support was tested (low of the last 2 candles reached the
//                   zone) and the last candle CLOSED back above it, green
//   BREAKDOWN SELL  the last candle is the FIRST close below a support
//   REJECTION SELL  a resistance was tested and the last candle CLOSED back
//                   below it, red
//   BREAKOUT  BUY   the last candle is the FIRST close above a resistance
// A line that has been closed through is BROKEN — no more calls on it (and it
// is never re-labelled). Once every line on one side is broken (price passed
// all of them), the stock is DONE for the day: no more calls on it.
// Momentum / pressure / volume / confidence are checked by the transformer.

import type { Candle } from "./types.js";

export type DayLevelName = "S1" | "S2" | "S3" | "R1" | "R2" | "R3";
export type DayLevelKind = "SUPPORT" | "RESISTANCE";

export interface DayLevel {
  name: DayLevelName;
  kind: DayLevelKind;
  level: number;
  min: number; // zone bottom
  max: number; // zone top
  strength: number; // total recency weight of the grouped prices
  days: number; // how many different days touched it
}

export interface DayLevels {
  date: string; // IST trading day (YYYY-MM-DD) these lines are for
  open: number; // today's open the lines were placed around
  prevClose: number; // previous day's close (for the gap)
  avgDailyVolume: number; // average daily volume of the previous 10 days
  levels: DayLevel[]; // up to 3 supports + 3 resistances
}

export type DayLevelSetup = "BOUNCE" | "BREAKDOWN" | "REJECTION" | "BREAKOUT";

export interface DayLevelEvent {
  setup: DayLevelSetup;
  side: "BUY" | "SELL";
  level: DayLevel;
}

export interface DayLevelsState {
  broken: DayLevelName[]; // lines already closed through
  done: boolean; // price passed every line on one side → no more calls today
  event: DayLevelEvent | null; // what the LAST closed candle did, if anything
}

const LOOKBACK_DAYS = 10;
const RANGE_PCT = 0.05;
const MIN_DAYS = 2;
const PER_SIDE = 3;
export const GROUP_ATR = 0.25;
export const GROUP_MIN_PCT = 0.003;

const IST_MS = 330 * 60_000;
export function istDate(ms: number): string {
  return new Date(ms + IST_MS).toISOString().slice(0, 10);
}

/**
 * The frozen lines for `date`. `dailyBefore` must be daily candles strictly
 * BEFORE that day (oldest first); `open` is that day's opening price.
 */
export function computeDayLevels(
  dailyBefore: Candle[],
  open: number,
  date: string,
  opts: { groupAtr?: number; groupMinPct?: number; perSide?: number } = {},
): DayLevels {
  const recent = dailyBefore.slice(-LOOKBACK_DAYS);
  const prevClose = recent.length ? recent[recent.length - 1]!.close : 0;
  const avgDailyVolume = recent.length ? recent.reduce((s, c) => s + (c.volume ?? 0), 0) / recent.length : 0;
  const empty: DayLevels = { date, open, prevClose, avgDailyVolume, levels: [] };
  if (!(open > 0) || recent.length < 2) return empty;

  // 1. weighted candidates, each tagged with the day it came from
  const cands: { price: number; weight: number; day: number }[] = [];
  for (let i = 0; i < recent.length; i++) {
    const c = recent[i]!;
    const rec = Math.exp(-(recent.length - 1 - i) / 5);
    cands.push({ price: c.high, weight: rec, day: i }, { price: c.low, weight: rec, day: i }, { price: c.close, weight: 0.6 * rec, day: i });
  }
  // 2. ±5 % of the open
  const near = cands.filter((c) => c.price > 0 && Math.abs(c.price - open) / open <= RANGE_PCT).sort((a, b) => a.price - b.price);
  if (near.length === 0) return empty;

  // daily ATR (simple mean of true ranges) — same as levels.service
  let atr = 0;
  for (let i = 0; i < recent.length; i++) {
    const c = recent[i]!;
    atr += i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - recent[i - 1]!.close), Math.abs(c.low - recent[i - 1]!.close));
  }
  atr /= recent.length;
  const width = Math.max(atr * (opts.groupAtr ?? GROUP_ATR), open * (opts.groupMinPct ?? GROUP_MIN_PCT));

  // 3. group neighbouring prices
  const groups: { level: number; weight: number; days: Set<number>; min: number; max: number }[] = [];
  for (const c of near) {
    const g = groups[groups.length - 1];
    if (g && c.price - g.min <= width) {
      const w = g.weight + c.weight;
      g.level = (g.level * g.weight + c.price * c.weight) / w;
      g.weight = w;
      g.days.add(c.day);
      g.min = Math.min(g.min, c.price);
      g.max = Math.max(g.max, c.price);
    } else {
      groups.push({ level: c.price, weight: c.weight, days: new Set([c.day]), min: c.price, max: c.price });
    }
  }

  // 4. at least 2 different days, still within ±5 %
  const valid = groups.filter((g) => g.days.size >= MIN_DAYS && Math.abs(g.level - open) / open <= RANGE_PCT);
  const cap = Math.max(atr * 0.15, open * 0.002);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const toLevel = (g: (typeof valid)[number], kind: DayLevelKind, name: DayLevelName): DayLevel => ({
    name,
    kind,
    level: r2(g.level),
    min: r2(Math.max(g.min, g.level - cap)),
    max: r2(Math.min(g.max, g.level + cap)),
    strength: r2(g.weight),
    days: g.days.size,
  });

  // 5. two strongest per side, then named by distance from the open
  const perSide = opts.perSide ?? PER_SIDE;
  const pick = (side: typeof valid) => [...side].sort((a, b) => b.weight - a.weight).slice(0, perSide).sort((a, b) => Math.abs(a.level - open) - Math.abs(b.level - open));
  const supports = pick(valid.filter((g) => g.level < open)).map((g, i) => toLevel(g, "SUPPORT", (["S1", "S2", "S3"] as const)[i]!));
  const resistances = pick(valid.filter((g) => g.level > open)).map((g, i) => toLevel(g, "RESISTANCE", (["R1", "R2", "R3"] as const)[i]!));
  return { date, open, prevClose, avgDailyVolume, levels: [...supports, ...resistances] };
}

/**
 * Replays today's CLOSED 5-min candles (oldest first) against the frozen
 * lines: which lines are broken, whether the stock is done for the day, and
 * what the LAST candle did. Stateless — the same candles always give the same
 * answer, so a server restart cannot change it.
 */
export function evaluateDayLevels(day: DayLevels, session: Candle[]): DayLevelsState {
  const broken = new Set<DayLevelName>();
  const sides: Record<DayLevelKind, DayLevel[]> = {
    SUPPORT: day.levels.filter((l) => l.kind === "SUPPORT"),
    RESISTANCE: day.levels.filter((l) => l.kind === "RESISTANCE"),
  };
  const sideDone = (k: DayLevelKind) => sides[k].length > 0 && sides[k].every((l) => broken.has(l.name));
  let done = false;
  let event: DayLevelEvent | null = null;

  for (let i = 0; i < session.length; i++) {
    if (done) break; // passed all lines on a side earlier → nothing more today
    const c = session[i]!;
    const prev = i > 0 ? session[i - 1]! : null;
    const isLast = i === session.length - 1;
    const found: DayLevelEvent[] = [];
    for (const l of day.levels) {
      if (broken.has(l.name)) continue;
      if (l.kind === "RESISTANCE") {
        if (c.close > l.max) {
          broken.add(l.name);
          if (isLast) found.push({ setup: "BREAKOUT", side: "BUY", level: l });
        } else if (isLast && Math.max(c.high, prev?.high ?? -Infinity) >= l.min && c.close < l.min && c.close < c.open) {
          found.push({ setup: "REJECTION", side: "SELL", level: l });
        }
      } else {
        if (c.close < l.min) {
          broken.add(l.name);
          if (isLast) found.push({ setup: "BREAKDOWN", side: "SELL", level: l });
        } else if (isLast && Math.min(c.low, prev?.low ?? Infinity) <= l.max && c.close > l.max && c.close > c.open) {
          found.push({ setup: "BOUNCE", side: "BUY", level: l });
        }
      }
    }
    // the line nearest to where the candle closed is the one it acted on
    if (found.length) event = found.sort((a, b) => Math.abs(c.close - a.level.level) - Math.abs(c.close - b.level.level))[0]!;
    if (sideDone("SUPPORT") || sideDone("RESISTANCE")) done = true;
  }
  return { broken: [...broken], done, event };
}

// ── Stocks in play ──────────────────────────────────────────────────────────
// New calls only for stocks with unusual activity today (user, 2026-11-10):
//   gap at the open ≥ 0.7 % from yesterday's close (was 1 %; 0.7–1 % gaps
//   were still profitable in the 1-year replay, 2026-11-10), OR
//   first 15 minutes (09:15–09:30 = the first 3 five-min candles) traded
//   ≥ 2 × their normal volume.
// "Normal" first-15-min volume = FIRST15_SHARE × the stock's average daily
// volume; FIRST15_SHARE = 0.08 is the median share of a day's volume traded
// in the first 15 min (154 stocks × 67 days, Aug–Nov 2026).
export const IN_PLAY_GAP_PCT = 0.7;
export const IN_PLAY_VOLUME_MULT = 2;
export const FIRST15_SHARE = 0.08;

export interface InPlay {
  inPlay: boolean;
  gapPct: number; // signed, open vs previous close
  first15VolumeX: number | null; // first-15-min volume ÷ normal (null until 09:30)
}

/** `session` = today's closed 5-min candles, oldest first (first one = 09:15). */
export function stockInPlay(day: DayLevels, session: Candle[]): InPlay {
  const gapPct = day.prevClose > 0 ? ((day.open - day.prevClose) / day.prevClose) * 100 : 0;
  const normal = FIRST15_SHARE * day.avgDailyVolume;
  const first15VolumeX = session.length >= 3 && normal > 0 ? session.slice(0, 3).reduce((s, c) => s + (c.volume ?? 0), 0) / normal : null;
  const inPlay = Math.abs(gapPct) >= IN_PLAY_GAP_PCT || (first15VolumeX != null && first15VolumeX >= IN_PLAY_VOLUME_MULT);
  return { inPlay, gapPct: Math.round(gapPct * 100) / 100, first15VolumeX: first15VolumeX == null ? null : Math.round(first15VolumeX * 100) / 100 };
}
