// COPIED from ~/Desktop/trading-scanner-v2 (the backtest lab) — keep both in sync.
// FAIR VALUE GAP (FVG) — strict 3-candle detection on 5-min candles.
//
// BULLISH FVG (c1, c2, c3 = three consecutive candles of the SAME day):
//   1. Gap:          c3.low  > c1.high            (the zone c1.high … c3.low was never traded on both sides)
//   2. Displacement: c2 is a GREEN candle, body ≥ dispAtr × ATR (ATR measured before the move)
//   3. Strong close: c2 body ≥ minBodyFrac of its own range (no long-wick fake moves)
//   4. Volume:       c2 volume ≥ volMult × average of the 20 candles before c2
//   5. Size:         gap ≥ 0.25% of price AND ≥ 0.5 × ATR — small gaps are NOT counted as FVGs
//   6. Hold:         c3 closes ABOVE c1.high (the gap is still open when the pattern completes)
//   7. Trend:        (optional, default on) c3 closes above the session VWAP
//   8. Time:         c1 not the 09:15 auction candle → c3 opens 09:30–13:55 IST (complete by 14:00)
// BEARISH FVG: exact mirror (c3.high < c1.low, red c2, c3 closes below c1.low, below VWAP).
//
// TRADE (from the zone):
//   entry = limit at the gap midpoint ("consequent encroachment"), only on a LATER candle
//   stop  = below the lowest low of c1/c2 (bull) — beyond the whole move that created the gap
//   Only the first return into the gap is traded.

import type { Candle, Setup } from "./types.js";
import { avgVolBefore } from "./indicators.js";
import { istMin, hm } from "./time.js";

export interface FvgConfig {
  dispAtr: number; // c2 body ≥ this × ATR
  minBodyFrac: number; // c2 body ÷ c2 range
  volMult: number; // c2 volume ÷ average of the 20 candles before it
  minGapPct: number; // gap ÷ price
  minGapAtr: number; // gap ÷ ATR
  vwapFilter: boolean;
  firstC3Min: number; // c3 open time, minutes since midnight
  lastC3Min: number;
}

export const FVG_DEFAULTS: FvgConfig = {
  dispAtr: 1.0,
  minBodyFrac: 0.6,
  volMult: 1.5,
  minGapPct: 0.0025,
  minGapAtr: 0.5,
  vwapFilter: true,
  firstC3Min: hm(9, 30),
  lastC3Min: hm(13, 55),
};

/**
 * Find FVG setups in ONE day: candles c[dayStart..dayEnd-1].
 * `atrArr` is ATR over the whole continuous series; `vwap[k]` is the session
 * VWAP after candle dayStart+k (see lib/vwap.ts).
 */
export function findFvgSetups(c: Candle[], atrArr: number[], vwap: number[], dayStart: number, dayEnd: number, cfg: FvgConfig = FVG_DEFAULTS): Setup[] {
  const out: Setup[] = [];
  for (let i = dayStart + 2; i < dayEnd; i++) {
    const m = istMin(c[i]!.t);
    if (m < cfg.firstC3Min || m > cfg.lastC3Min) continue;
    const c1 = c[i - 2]!, c2 = c[i - 1]!, c3 = c[i]!;
    const a = atrArr[i - 2]!;
    if (!(a > 0)) continue;
    const body = Math.abs(c2.c - c2.o);
    const range = c2.h - c2.l;
    if (body < cfg.dispAtr * a || range <= 0 || body / range < cfg.minBodyFrac) continue;
    const avgV = avgVolBefore(c, i - 1, 20);
    if (!(avgV > 0) || c2.v < cfg.volMult * avgV) continue;
    const vw = vwap[i - dayStart]!;

    // bullish
    if (c2.c > c2.o && c3.l > c1.h && c3.c > c1.h) {
      const gap = c3.l - c1.h;
      if (gap >= cfg.minGapPct * c2.c && gap >= cfg.minGapAtr * a && (!cfg.vwapFilter || c3.c > vw)) {
        out.push({ strategy: "FVG", dir: 1, formedIdx: i, activeFrom: i + 1, zoneBottom: c1.h, zoneTop: c3.l, entry: (c1.h + c3.l) / 2, stop: Math.min(c1.l, c2.l) });
      }
    }
    // bearish
    if (c2.c < c2.o && c3.h < c1.l && c3.c < c1.l) {
      const gap = c1.l - c3.h;
      if (gap >= cfg.minGapPct * c2.c && gap >= cfg.minGapAtr * a && (!cfg.vwapFilter || c3.c < vw)) {
        out.push({ strategy: "FVG", dir: -1, formedIdx: i, activeFrom: i + 1, zoneBottom: c3.h, zoneTop: c1.l, entry: (c3.h + c1.l) / 2, stop: Math.max(c1.h, c2.h) });
      }
    }
  }
  return out;
}

/** True if candles a..b (inclusive, same day) contain a bullish (dir 1) / bearish (-1) 3-candle gap. Used by Order Block. */
export function hasImbalance(c: Candle[], a: number, b: number, dir: 1 | -1): boolean {
  for (let i = a + 2; i <= b; i++) {
    if (dir === 1 && c[i]!.l > c[i - 2]!.h) return true;
    if (dir === -1 && c[i]!.h < c[i - 2]!.l) return true;
  }
  return false;
}
