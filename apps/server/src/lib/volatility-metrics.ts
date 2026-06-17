import type { Candle } from "./types.js";

// Pure-function helpers for the Volatile Stocks screen + Day Movers screen.
// No state, no side effects, no service imports. Easy to unit-test, cheap to
// call. Same style as atr.ts.
//
// The Volatile screen filters on (computeAtrPct, computeRvol). The Day Movers
// screen filters on (computeDayMovePct). Both screens use computeDayRangePosition
// and the candle-direction / per-candle volume multiplier helpers to render
// the card body.

/** Direction of a single candle's body. */
export type CandleDirection = "up" | "down" | "flat";

/**
 * ATR expressed as a percentage of the current price. Normalises across price
 * ranges so a ₹150 stock and a ₹2500 stock can be compared on the same scale.
 * Returns null if ATR is null or price is non-positive.
 */
export function computeAtrPct(atr: number | null, price: number): number | null {
  if (atr === null || !Number.isFinite(atr) || atr < 0) return null;
  if (!Number.isFinite(price) || price <= 0) return null;
  return (atr / price) * 100;
}

/**
 * Relative Volume from in-session candles: the most recent closed candle's
 * volume vs the mean of the prior ≤20 candles. Returns null when there isn't
 * enough history to form a meaningful baseline.
 *
 * Single source of truth — also used by ai-call.service.ts (was duplicated
 * there; now imported from here).
 */
export function computeRvol(candles: Candle[]): number | null {
  if (candles.length < 6) return null;
  const recent = candles[candles.length - 1];
  if (recent.volume <= 0) return null;
  const sample = candles.slice(-Math.min(20, candles.length - 1), -1);
  if (sample.length === 0) return null;
  const avg = sample.reduce((s, c) => s + c.volume, 0) / sample.length;
  if (avg <= 0) return null;
  return recent.volume / avg;
}

/**
 * Per-candle volume multiplier: this candle's volume divided by the mean of
 * the OTHER candles in the supplied window. Used to render the "1.8× avg"
 * label next to each of the last 3 candles on the card.
 *
 * Returns null when the window doesn't contain at least one other candle with
 * positive volume.
 */
export function computeCandleVolMultiplier(
  candle: Candle,
  windowCandles: Candle[],
): number | null {
  if (!candle || candle.volume <= 0) return null;
  const others = windowCandles.filter((c) => c !== candle && c.volume > 0);
  if (others.length === 0) return null;
  const avg = others.reduce((s, c) => s + c.volume, 0) / others.length;
  if (avg <= 0) return null;
  return candle.volume / avg;
}

/**
 * Direction of a single candle's body. "flat" when close === open.
 */
export function computeCandleDirection(candle: Candle): CandleDirection {
  if (candle.close > candle.open) return "up";
  if (candle.close < candle.open) return "down";
  return "flat";
}

/**
 * Where in today's range the current price sits, as a 0..1 fraction.
 *   0 → price is at the day low
 *   1 → price is at the day high
 *   0.5 → midpoint
 * Returns null when the range is degenerate (no movement yet, or high <= low).
 */
export function computeDayRangePosition(
  price: number,
  dayHigh: number,
  dayLow: number,
): number | null {
  if (!Number.isFinite(price) || !Number.isFinite(dayHigh) || !Number.isFinite(dayLow)) {
    return null;
  }
  const range = dayHigh - dayLow;
  if (range <= 0) return null;
  const pos = (price - dayLow) / range;
  // Clamp — a late tick can momentarily print outside the cached H/L.
  if (pos < 0) return 0;
  if (pos > 1) return 1;
  return pos;
}

/**
 * Day move from open as a signed percentage. Used by the Day Movers screen.
 *   +28 → price 28% above open
 *   -14 → price 14% below open
 * Returns null when open is non-positive (no opening tick yet).
 */
export function computeDayMovePct(price: number, dayOpen: number): number | null {
  if (!Number.isFinite(price) || !Number.isFinite(dayOpen) || dayOpen <= 0) return null;
  return ((price - dayOpen) / dayOpen) * 100;
}

/**
 * Distance from price to the nearest level (support or resistance) as
 * absolute rupees + percentage of price. Caller passes whichever level is
 * relevant. Returns null when the level is missing or price is non-positive.
 */
export function computeDistanceToLevel(
  price: number,
  level: number | null | undefined,
): { abs: number; pct: number } | null {
  if (level == null || !Number.isFinite(level)) return null;
  if (!Number.isFinite(price) || price <= 0) return null;
  const abs = Math.abs(price - level);
  const pct = (abs / price) * 100;
  return { abs, pct };
}

/**
 * Return the last N closed candles, newest first. The candle tracker stores
 * them oldest-first; this is a convenience for UI rendering.
 */
export function getLastNCandlesNewestFirst(candles: Candle[], n: number): Candle[] {
  if (n <= 0 || candles.length === 0) return [];
  const tail = candles.slice(-n);
  return [...tail].reverse();
}
