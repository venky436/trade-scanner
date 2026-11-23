// OPENING MOVERS — BUY / SELL from the FIRST 5-min candle only (09:15).
// Standalone: uses no engine (no momentum, pressure, confidence, lines).
// Display only — feeds no call, score or auto-trade.
//
//   BUY   candle 1 (09:15) closed ABOVE yesterday's close
//         candle 1 volume ≥ 2 × normal
//   SELL  candle 1 closed BELOW yesterday's close, same volume rule
//
// "Normal" volume = the average volume of the same 09:15 candle on the
// stock's last 10 trading days — same time of day, so the busy open is
// compared with other busy opens.

export interface OpeningCandle {
  time: number; // epoch seconds, candle open
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export const OPENING_VOLUME_MULT = 2;
export const BASELINE_DAYS = 10;
const FIRST_MIN = 9 * 60 + 15; // 09:15 candle
const IST_MS = 330 * 60_000;

export function istDateOf(sec: number): string {
  return new Date(sec * 1000 + IST_MS).toISOString().slice(0, 10);
}
function istMinuteOf(sec: number): number {
  const d = new Date(sec * 1000 + IST_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The day's 09:15 candle, or null if it isn't there. */
export function firstCandle(candles: OpeningCandle[], date: string): OpeningCandle | null {
  return candles.find((c) => istDateOf(c.time) === date && istMinuteOf(c.time) === FIRST_MIN) ?? null;
}

/**
 * From 5-min candles of the days BEFORE `date`: yesterday's close (last
 * candle of the previous trading day — a fallback; the official close comes
 * from Zerodha's quote) and the normal volume of the 09:15 candle.
 */
export function openingBaseline(candles: OpeningCandle[], date: string): { prevClose: number; normalVolume: number; days: number } | null {
  const byDay = new Map<string, OpeningCandle[]>();
  for (const c of candles) {
    const d = istDateOf(c.time);
    if (d >= date) continue;
    const list = byDay.get(d);
    if (list) list.push(c);
    else byDay.set(d, [c]);
  }
  const days = [...byDay.keys()].sort();
  if (days.length === 0) return null;
  const last = byDay.get(days.at(-1)!)!.sort((a, b) => a.time - b.time);
  const vols: number[] = [];
  for (const d of days.slice(-BASELINE_DAYS)) {
    const c1 = firstCandle(byDay.get(d)!, d);
    if (c1) vols.push(c1.volume);
  }
  if (vols.length === 0) return null;
  return { prevClose: last.at(-1)!.close, normalVolume: vols.reduce((s, v) => s + v, 0) / vols.length, days: vols.length };
}

export interface OpeningSignal {
  side: "BUY" | "SELL";
  movePct: number; // candle 1 close vs yesterday's close, %
  volumeX: number; // candle 1 volume ÷ normal
}

export function openingSignal(prevClose: number, normalVolume: number, c1: OpeningCandle): OpeningSignal | null {
  if (!(prevClose > 0) || !(normalVolume > 0)) return null;
  const volumeX = c1.volume / normalVolume;
  if (volumeX < OPENING_VOLUME_MULT) return null;
  const side = c1.close > prevClose ? "BUY" : c1.close < prevClose ? "SELL" : null;
  if (!side) return null;
  return { side, movePct: round2(((c1.close - prevClose) / prevClose) * 100), volumeX: round2(volumeX) };
}
