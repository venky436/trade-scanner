import type { Candle } from "./types.js";

/**
 * Session VWAP for each candle of ONE day: out[k] is the VWAP after candle
 * dayStart+k closed (typical price (h+l+c)/3 × volume, reset each day).
 */
export function sessionVwap(c: Candle[], dayStart: number, dayEnd: number): number[] {
  const out: number[] = [];
  let pv = 0;
  let vol = 0;
  for (let i = dayStart; i < dayEnd; i++) {
    const x = c[i]!;
    const tp = (x.h + x.l + x.c) / 3;
    pv += tp * x.v;
    vol += x.v;
    out.push(vol > 0 ? pv / vol : tp);
  }
  return out;
}
