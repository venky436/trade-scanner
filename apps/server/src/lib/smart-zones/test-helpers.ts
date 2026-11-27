import type { Candle } from "./types.js";

/** Epoch seconds for an IST wall-clock time on 2026-11-20. */
export const at = (hhmm: string, date = "2026-11-20") => Math.floor(new Date(`${date}T${hhmm}:00+05:30`).getTime() / 1000);

/** Build a day of 5-min candles from 09:15, one per [o, h, l, c, v]. */
export function day(rows: [number, number, number, number, number][], date = "2026-11-20"): Candle[] {
  const t0 = at("09:15", date);
  return rows.map(([o, h, l, c, v], i) => ({ t: t0 + i * 300, o, h, l, c, v }));
}

/** n quiet candles around `p` (range 0.4, volume 1000) — a calm baseline. */
export function flat(n: number, p = 100, v = 1000): [number, number, number, number, number][] {
  return Array.from({ length: n }, () => [p, p + 0.2, p - 0.2, p, v] as [number, number, number, number, number]);
}

export const constAtr = (n: number, a: number) => new Array(n).fill(a);
