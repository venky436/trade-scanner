// COPIED from ~/Desktop/trading-scanner-v2 (the backtest lab) — keep both in sync.
// The user's trade rule for smart setups (confirmed 2026-11-22):
//   ENTRY  at the CLOSE of the candle that completes the pattern
//          (FVG: candle 3 · Order Block: the break candle)
//   STOP   at the far end of the pattern's FIRST candle, wick included
//          (FVG: candle 1 · Order Block: the block candle)
//          BUY → that candle's LOW · SELL → that candle's HIGH
//   EXIT   stop hit, or the market close (close of the 15:20 candle = 15:25,
//          or the day's last candle when Zerodha's data ends earlier, e.g. 15:15)
// No target. A stop touched inside a candle exits at the stop; a candle that OPENS
// beyond the stop exits at that open. Slippage on every exit (market order).

import type { Candle, Dir } from "./types.js";
import { istMin, hm } from "./time.js";

export interface CloseEntryTrade {
  dir: Dir;
  entryIdx: number;
  entry: number;
  stop: number;
  exitIdx: number;
  exit: number;
  reason: "STOP" | "STOP_GAP" | "CLOSE";
}

export function closeEntryTrade(c: Candle[], dayEnd: number, dir: Dir, patternEnd: number, firstCandle: number, slipPct = 0.0002, exitMin = hm(15, 20)): CloseEntryTrade | null {
  const entry = c[patternEnd]!.c;
  const stop = dir === 1 ? c[firstCandle]!.l : c[firstCandle]!.h;
  if (dir === 1 ? !(stop < entry) : !(stop > entry)) return null;
  const out = (k: number, p: number, reason: CloseEntryTrade["reason"]): CloseEntryTrade => ({
    dir, entryIdx: patternEnd, entry, stop, exitIdx: k, exit: dir === 1 ? p * (1 - slipPct) : p * (1 + slipPct), reason,
  });
  for (let k = patternEnd + 1; k < dayEnd; k++) {
    const x = c[k]!;
    if (dir === 1 ? x.o <= stop : x.o >= stop) return out(k, x.o, "STOP_GAP");
    if (dir === 1 ? x.l <= stop : x.h >= stop) return out(k, stop, "STOP");
    if (istMin(x.t) >= exitMin) return out(k, x.c, "CLOSE");
  }
  return out(dayEnd - 1, c[dayEnd - 1]!.c, "CLOSE");
}
