import type { Candle, MomentumSignal, MomentumAcceleration, MomentumResult } from "./types";

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function getSignal(value: number): MomentumSignal {
  if (value > 0.6) return "STRONG_UP";
  if (value > 0.3) return "UP";
  if (value < -0.6) return "STRONG_DOWN";
  if (value < -0.3) return "DOWN";
  return "FLAT";
}

function getAcceleration(raw: number): MomentumAcceleration {
  if (raw > 0.002) return "INCREASING";
  if (raw < -0.002) return "DECREASING";
  return "STABLE";
}

function getQualityMultiplier(signal: MomentumSignal, acceleration: MomentumAcceleration): number {
  if (signal === "UP" && acceleration === "INCREASING") return 1.10;
  if (signal === "UP" && acceleration === "DECREASING") return 0.90;
  if (signal === "STRONG_UP" && acceleration === "INCREASING") return 1.10;
  if (signal === "STRONG_UP" && acceleration === "DECREASING") return 0.90;
  if (signal === "DOWN" && acceleration === "DECREASING") return 1.10;
  if (signal === "DOWN" && acceleration === "INCREASING") return 0.90;
  if (signal === "STRONG_DOWN" && acceleration === "DECREASING") return 1.10;
  if (signal === "STRONG_DOWN" && acceleration === "INCREASING") return 0.90;
  if (signal === "FLAT" && acceleration === "INCREASING") return 1.05;
  if (signal === "FLAT" && acceleration === "DECREASING") return 1.05;
  return 1.0;
}

// Stocks normally move 0.3–1% per 5-min candle, so dividing by 0.003 (0.3%)
// puts a meaningful move at value ≈ 0.5–1.0. Indices move 0.05–0.2% per
// 5-min candle, so the same divisor compresses everything into FLAT range.
// Index divisor is 3× more sensitive, so a 0.1% NIFTY move reads UP, a
// 0.2% move reads STRONG_UP.
const STOCK_MOMENTUM_DIVISOR = 0.003;
const INDEX_MOMENTUM_DIVISOR = 0.001;

/**
 * Momentum from the LAST 2 closed 5-min candles (changed 2026-11-09, was 3):
 *   r = (close − open) / open for each candle
 *   velocity = r_previous × 0.3 + r_newest × 0.7      (newest candle dominates)
 *   value    = clamp(velocity / divisor, −1, 1)       (divisor unchanged)
 *   acceleration = r_newest − r_previous             (speeding up / easing)
 * Same weights as the pressure engine, so both read the same 10 minutes.
 */
export function getMomentum(candles: Candle[], isIndex = false): MomentumResult | null {
  if (candles.length < 2) return null;

  const len = candles.length;
  const prev = candles[len - 2];
  const last = candles[len - 1];

  const rPrev = (prev.close - prev.open) / prev.open;
  const rLast = (last.close - last.open) / last.open;

  // Velocity: 2-candle weighted average (newest 70 %)
  const momentum = rPrev * 0.3 + rLast * 0.7;
  const divisor = isIndex ? INDEX_MOMENTUM_DIVISOR : STOCK_MOMENTUM_DIVISOR;
  const value = clamp(momentum / divisor, -1, 1);
  const signal = getSignal(value);

  // Acceleration: is the newest candle stronger or weaker than the one before?
  const accelerationRaw = rLast - rPrev;
  const acceleration = getAcceleration(accelerationRaw);

  // Quality: value adjusted by momentum + acceleration combo
  const qualityMultiplier = getQualityMultiplier(signal, acceleration);
  const quality = value * qualityMultiplier;

  return { value, signal, acceleration, accelerationRaw, quality };
}
