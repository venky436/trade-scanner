// COPIED from ~/Desktop/trading-scanner-v2 (the backtest lab) — keep both in sync.
// Trade one setup on one stock's 5-min candles — conservative rules:
//  • ENTRY: limit order at setup.entry, from candle `activeFrom`, while the candle opens
//    no later than lastEntryMin. Long fills when low ≤ entry, at min(entry, open)
//    (a gap down through the limit fills at the open). If a candle OPENS beyond the
//    stop before the fill, the setup is cancelled.
//  • FILL CANDLE: if it also reaches the stop → stopped out (we can't know the order
//    inside the candle, so assume the worst). The target is not checked on the fill candle.
//  • LATER CANDLES: open beyond stop → exit at open; open beyond target → exit at open;
//    stop and target both inside one candle → STOP (worst case).
//  • EOD: exit at the close of the candle that opens at exitMin (15:10 → out at 15:15).
//  • Slippage `slipPct` is charged on stop, gap and EOD exits (market orders), not on
//    limit entries or limit targets.
// Shorts are handled by mirroring prices, so both sides use the exact same logic.

import type { Candle, Setup, SimResult, ExitReason, Dir } from "./types.js";
import { istMin, hm } from "./time.js";

export interface SimConfig {
  lastEntryMin: number;
  exitMin: number;
  targetR: number | null; // null = no target, hold to EOD
  slipPct: number;
}

export const SIM_DEFAULTS: SimConfig = { lastEntryMin: hm(13, 55), exitMin: hm(15, 10), targetR: 2, slipPct: 0.0002 };

interface P {
  o: number;
  h: number;
  l: number;
  c: number;
}
const mirror = (x: Candle, dir: Dir): P => (dir === 1 ? { o: x.o, h: x.h, l: x.l, c: x.c } : { o: -x.o, h: -x.l, l: -x.h, c: -x.c });

/** Find the fill, then manage the trade. null = never filled (or cancelled). */
export function simulate(c: Candle[], dayEnd: number, s: Setup, cfg: SimConfig = SIM_DEFAULTS): SimResult | null {
  const d = s.dir;
  const entry = d === 1 ? s.entry : -s.entry;
  const stop = d === 1 ? s.stop : -s.stop;
  if (!(entry > stop)) return null;
  for (let j = s.activeFrom; j < dayEnd; j++) {
    if (istMin(c[j]!.t) > cfg.lastEntryMin) return null;
    const x = mirror(c[j]!, d);
    if (x.o <= stop) return null; // opened through the stop before we got in
    if (x.l <= entry) {
      const fill = Math.min(entry, x.o);
      return manage(c, dayEnd, j, d === 1 ? fill : -fill, d, fill - stop, cfg);
    }
  }
  return null;
}

/**
 * Manage an open trade from its fill candle. `fill` is the real price,
 * `risk` the per-share distance to the stop. Also used by the random baseline.
 */
export function manage(c: Candle[], dayEnd: number, fillIdx: number, fillReal: number, d: Dir, risk: number, cfg: SimConfig): SimResult {
  const fill = d === 1 ? fillReal : -fillReal;
  const stop = fill - risk;
  const target = cfg.targetR == null ? Infinity : fill + cfg.targetR * risk;
  const slip = (pB: number) => {
    const real = d === 1 ? pB : -pB;
    return d === 1 ? real * (1 - cfg.slipPct) : real * (1 + cfg.slipPct);
  };
  const done = (idx: number, priceB: number, reason: ExitReason, slipped: boolean): SimResult => ({
    dir: d,
    fillIdx,
    fill: fillReal,
    stop: d === 1 ? stop : -stop,
    riskPerShare: risk,
    exitIdx: idx,
    exit: slipped ? slip(priceB) : d === 1 ? priceB : -priceB,
    reason,
  });

  const f = mirror(c[fillIdx]!, d);
  if (f.l <= stop) return done(fillIdx, stop, "STOP", true);
  if (istMin(c[fillIdx]!.t) >= cfg.exitMin) return done(fillIdx, f.c, "EOD", true);
  for (let k = fillIdx + 1; k < dayEnd; k++) {
    const x = mirror(c[k]!, d);
    if (x.o <= stop) return done(k, x.o, "STOP_GAP", true);
    if (x.o >= target) return done(k, x.o, "TARGET_GAP", false);
    if (x.l <= stop) return done(k, stop, "STOP", true);
    if (x.h >= target) return done(k, target, "TARGET", false);
    if (istMin(c[k]!.t) >= cfg.exitMin) return done(k, x.c, "EOD", true);
  }
  const last = dayEnd - 1;
  return done(last, mirror(c[last]!, d).c, "EOD", true);
}
