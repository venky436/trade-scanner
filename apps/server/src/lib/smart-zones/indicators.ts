import type { Candle } from "./types.js";

/**
 * Wilder ATR on a continuous candle series. out[i] uses candles 0..i.
 * The first `n` values are the simple average of the true ranges so far.
 */
export function atr(c: Candle[], n = 14): number[] {
  const out: number[] = new Array(c.length).fill(0);
  let prev = 0;
  let sum = 0;
  for (let i = 0; i < c.length; i++) {
    const tr = i === 0 ? c[i]!.h - c[i]!.l : Math.max(c[i]!.h - c[i]!.l, Math.abs(c[i]!.h - c[i - 1]!.c), Math.abs(c[i]!.l - c[i - 1]!.c));
    if (i < n) {
      sum += tr;
      prev = sum / (i + 1);
    } else {
      prev = (prev * (n - 1) + tr) / n;
    }
    out[i] = prev;
  }
  return out;
}

/** Average volume of the `n` candles BEFORE index i (i itself excluded). 0 if none. */
export function avgVolBefore(c: Candle[], i: number, n = 20): number {
  const from = Math.max(0, i - n);
  if (from >= i) return 0;
  let s = 0;
  for (let k = from; k < i; k++) s += c[k]!.v;
  return s / (i - from);
}
