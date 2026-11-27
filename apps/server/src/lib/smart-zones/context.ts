// COPIED from ~/Desktop/trading-scanner-v2 (the backtest lab) — keep both in sync.
// MARKET CONTEXT for a pattern (FVG or Order Block): was there a CLEAR move before it?
// No fixed candle counts — the move is found on the chart itself (any length up to
// LOOK candles, same day only).
//
// For a BULLISH pattern (it pushes price UP), starting at candle `start`, completed at `confirm`:
//
//  REVERSAL (clear FALL → bottom → turn up → bullish pattern) = BUY after a fall
//    bottom L  = the lowest low from up to LOOK candles before `start` through start+1
//                (the bottom is at or just before the pattern begins)
//    top H     = the highest high in the LOOK candles before L (where the fall began)
//    the fall H → L must be CLEAR (see clearLeg), and price must not go below L
//    again before `confirm`. The turn must still be EARLY: at `confirm`, price has
//    won back no more than maxRecovery (60%) of the fall.
//
//  TREND (clear RISE still running → bullish pattern continues it) = BUY in a rise
//    leg low L0 = the lowest low in the LOOK candles up to `start`
//    leg high   = the highest high from L0 to `start`
//    the rise L0 → high must be CLEAR, and at `start` price has not pulled back
//    more than maxPullback (50%) of it — the trend is intact when the gap forms.
//
// A CLEAR leg (clearLeg): size ≥ minMovePct of price AND ≥ minMoveAtr × ATR,
// at least minBars candles long, efficiency ≥ minEfficiency (net close-to-close
// move ÷ total close-to-close travel — a clean one-way move, not chop), and no
// bounce inside it bigger than maxInnerRetrace of the move.
//
// FRESH: the pattern must start soon after the move — the candles between the move's end
// and the pattern's first candle are at most maxPauseRatio (2) × the move's own length.
// A 6-candle fall can be followed by its FVG up to 12 candles later; an old move cannot.
//
// Bearish patterns use the exact mirror (prices flipped), so SELL after a clear
// rise (reversal) and SELL inside a clear fall (trend) follow the same code.

import type { Candle } from "./types.js";

export interface ContextConfig {
  look: number;
  minMovePct: number;
  minMoveAtr: number;
  minBars: number;
  minEfficiency: number;
  maxInnerRetrace: number;
  maxRecovery: number;
  maxPullback: number;
  maxPauseRatio: number; // candles from the end of the move to the pattern ≤ this × the move's length
}

export const CONTEXT_DEFAULTS: ContextConfig = {
  look: 40,
  minMovePct: 0.01,
  minMoveAtr: 2.5,
  minBars: 3,
  minEfficiency: 0.4,
  maxInnerRetrace: 0.5,
  maxRecovery: 0.6,
  maxPullback: 0.5,
  maxPauseRatio: 2,
};

export interface Context {
  kind: "REVERSAL" | "TREND";
  legStart: number; // index where the prior move began (fall top / rise low)
  legEnd: number; // index where it ended (fall bottom / rise high)
  legFrom: number; // real price at legStart
  legTo: number; // real price at legEnd
  movePct: number;
  efficiency: number;
}

/** Candles in "bull space": for a bearish pattern prices are mirrored (x → -x, high ↔ low). */
function view(c: Candle[], dir: 1 | -1) {
  return {
    H: (i: number) => (dir === 1 ? c[i]!.h : -c[i]!.l),
    L: (i: number) => (dir === 1 ? c[i]!.l : -c[i]!.h),
    C: (i: number) => (dir === 1 ? c[i]!.c : -c[i]!.c),
    back: (x: number) => (dir === 1 ? x : -x),
  };
}

/** Quality of a RISE (in bull space) from candle lo (its low) to candle hi (its high). null = not clear. */
export function clearLeg(c: Candle[], lo: number, hi: number, atrAt: number, dir: 1 | -1, cfg: ContextConfig): { size: number; eff: number } | null {
  const v = view(c, dir);
  if (hi - lo < cfg.minBars) return null;
  const size = v.H(hi) - v.L(lo);
  const price = Math.abs(c[hi]!.c);
  if (!(size > 0) || size < cfg.minMovePct * price || size < cfg.minMoveAtr * atrAt) return null;
  let travel = 0;
  for (let k = lo + 1; k <= hi; k++) travel += Math.abs(v.C(k) - v.C(k - 1));
  const net = v.C(hi) - v.C(lo);
  const eff = travel > 0 ? net / travel : 0;
  if (eff < cfg.minEfficiency) return null;
  let peak = v.H(lo);
  for (let k = lo; k <= hi; k++) {
    peak = Math.max(peak, v.H(k));
    if ((peak - v.L(k)) / size > cfg.maxInnerRetrace) return null; // a big bounce inside the move
  }
  return { size, eff };
}

/**
 * Context of a pattern pushing in `dir` (1 = up / BUY, -1 = down / SELL) that starts at
 * `start` and completes at `confirm`, on the day c[dayStart..]. null = no clear move before it.
 */
export function patternContext(c: Candle[], atrArr: number[], dayStart: number, start: number, confirm: number, dir: 1 | -1, cfg: ContextConfig = CONTEXT_DEFAULTS): Context | null {
  return reversal(c, atrArr, dayStart, start, confirm, dir, cfg) ?? trend(c, atrArr, dayStart, start, dir, cfg);
}

function reversal(c: Candle[], atrArr: number[], dayStart: number, start: number, confirm: number, dir: 1 | -1, cfg: ContextConfig): Context | null {
  // a BUY reversal needs a prior FALL: in bull space that is a fall, i.e. a rise in mirrored space (-dir)
  const v = view(c, dir);
  const from = Math.max(dayStart, start - cfg.look);
  const to = Math.min(start + 1, confirm - 1);
  let L = from;
  for (let k = from; k <= to; k++) if (v.L(k) < v.L(L)) L = k;
  for (let k = L + 1; k <= confirm; k++) if (v.L(k) < v.L(L)) return null; // new low after the bottom → turn failed
  let H = Math.max(dayStart, L - cfg.look);
  for (let k = H; k <= L; k++) if (v.H(k) >= v.H(H)) H = k; // latest highest high before the bottom
  if (H >= L) return null;
  if (start - L > cfg.maxPauseRatio * (L - H)) return null; // the turn came too long after the bottom
  // the fall H → L is a clear leg in the OPPOSITE direction
  const q = clearLeg(c, H, L, atrArr[L]!, (-dir) as 1 | -1, cfg);
  if (!q) return null;
  const fall = v.H(H) - v.L(L);
  if ((v.C(confirm) - v.L(L)) / fall > cfg.maxRecovery) return null; // turn already too far along
  return { kind: "REVERSAL", legStart: H, legEnd: L, legFrom: v.back(v.H(H)), legTo: v.back(v.L(L)), movePct: fall / Math.abs(c[L]!.c), efficiency: q.eff };
}

function trend(c: Candle[], atrArr: number[], dayStart: number, start: number, dir: 1 | -1, cfg: ContextConfig): Context | null {
  const v = view(c, dir);
  const from = Math.max(dayStart, start - cfg.look);
  let L0 = from;
  for (let k = from; k <= start; k++) if (v.L(k) <= v.L(L0)) L0 = k; // latest lowest low = where the rise began
  let Hi = L0;
  for (let k = L0; k <= start; k++) if (v.H(k) >= v.H(Hi)) Hi = k;
  if (Hi <= L0) return null;
  // where the move really ended: the FIRST candle that reached the extreme area (within ¼ ATR)
  // — a flat drift afterwards that only nudges the extreme is waiting, not more trend
  let end = L0;
  while (end < Hi && v.H(end) < v.H(Hi) - 0.25 * atrArr[Hi]!) end++;
  if (start - end > cfg.maxPauseRatio * (end - L0)) return null; // the move is old news
  const q = clearLeg(c, L0, Hi, atrArr[Hi]!, dir, cfg);
  if (!q) return null;
  const size = v.H(Hi) - v.L(L0);
  if ((v.H(Hi) - v.L(start)) / size > cfg.maxPullback) return null; // deep pullback — trend not intact
  return { kind: "TREND", legStart: L0, legEnd: Hi, legFrom: v.back(v.L(L0)), legTo: v.back(v.H(Hi)), movePct: size / Math.abs(c[Hi]!.c), efficiency: q.eff };
}
