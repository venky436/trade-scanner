// Candle-based approximation of the live pressure engine.
//
// The real pressure engine (`services/pressure.service.ts`) is tick-based: for every
// Kite tick it classifies the volume delta as buyer (price up) or seller (price down),
// accumulates within a 1-min window, and produces a score per closed candle.
//
// On-demand (untracked) stocks have no live tick stream, so we approximate:
// for each historical minute candle, assume the entire candle volume was buyers if
// close > open (green), or sellers if close < open (red). Then feed the same scoring
// formula the live engine uses so untracked stocks have a comparable pressure reading.

import type {
  Candle,
  PressureResult,
  PressureSignal,
  PressureTrend,
} from "./types.js";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

interface CandleScore {
  score: number;
  delta: number;
}

// Per-candle score, matching the live engine's `closeCandle` formula:
//   combined = deltaStrength*0.5 + momentum*0.3 + volumeStrength*0.2*sign(deltaStrength)
//
// Differences from the live engine:
// - deltaStrength: we don't have tick-level direction, so we assume green candles are
//   100% buyer volume (delta = +volume) and red candles are 100% seller volume
//   (delta = -volume). That makes deltaStrength ≈ ±1 per candle.
// - volumeStrength: live engine uses a running average across the day's ticks. Here
//   we compute it relative to the mean volume of the window we were passed. If there's
//   only 1 candle, we skip the volume strength term (leave it at 0).
function scoreCandle(c: Candle, avgVolume: number): CandleScore {
  if (c.open <= 0) return { score: 0, delta: 0 };

  let delta = 0;
  let deltaStrength = 0;
  if (c.close > c.open) {
    delta = c.volume;
    deltaStrength = 1;
  } else if (c.close < c.open) {
    delta = -c.volume;
    deltaStrength = -1;
  }

  const priceDiff = (c.close - c.open) / c.open;
  const momentum = clamp(priceDiff / 0.003, -1, 1);

  const volumeStrength =
    avgVolume > 0 ? clamp(c.volume / avgVolume, 0, 1) : 0;

  const combined =
    deltaStrength * 0.5 +
    momentum * 0.3 +
    volumeStrength * 0.2 * Math.sign(deltaStrength);

  return { score: clamp(combined, -1, 1), delta };
}

/**
 * Approximate pressure from recent historical candles (1-min preferred, 5-min works).
 *
 * Takes the last 3 candles from the input (padding on the right matches the live
 * engine's "most recent has most weight" behaviour). Returns null if fewer than 3
 * candles are provided or none have meaningful volume.
 */
export function pressureFromCandles(candles: Candle[]): PressureResult | null {
  if (candles.length < 3) return null;

  const window = candles.slice(-3);

  // Average volume across the window for the volumeStrength normalization.
  // Using window average (not 20-day avg) keeps this self-contained.
  const totalVolume = window.reduce((sum, c) => sum + (c.volume ?? 0), 0);
  const avgVolume = totalVolume / window.length;

  if (totalVolume === 0) return null;

  const scored = window.map((c) => scoreCandle(c, avgVolume));
  const scores = scored.map((s) => s.score);

  // Same weighted rolling average as the live engine: older < newer.
  let value = scores[0] * 0.2 + scores[1] * 0.3 + scores[2] * 0.5;

  // Consistency boost when all 3 candles agree on direction.
  const allPositive = scores.every((s) => s > 0);
  const allNegative = scores.every((s) => s < 0);
  if (allPositive || allNegative) value *= 1.15;

  value = clamp(value, -1, 1);

  // Dead zone — same as live engine.
  if (Math.abs(value) < 0.3) value = 0;

  let signal: PressureSignal;
  if (value > 0.6) signal = "STRONG_BUY";
  else if (value > 0.3) signal = "BUY";
  else if (value < -0.6) signal = "STRONG_SELL";
  else if (value < -0.3) signal = "SELL";
  else signal = "NEUTRAL";

  let trend: PressureTrend;
  if (allPositive) trend = "rising";
  else if (allNegative) trend = "falling";
  else trend = "mixed";

  return {
    value,
    signal,
    trend,
    confidence: Math.abs(value),
  };
}
