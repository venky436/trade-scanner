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

export function getMomentum(candles: Candle[], isIndex = false): MomentumResult | null {
  if (candles.length < 3) return null;

  const len = candles.length;
  const c3 = candles[len - 3];
  const c2 = candles[len - 2];
  const c1 = candles[len - 1];

  const r3 = (c3.close - c3.open) / c3.open;
  const r2 = (c2.close - c2.open) / c2.open;
  const r1 = (c1.close - c1.open) / c1.open;

  // Velocity: unchanged 3-candle weighted average
  const momentum = r3 * 0.2 + r2 * 0.3 + r1 * 0.5;
  const divisor = isIndex ? INDEX_MOMENTUM_DIVISOR : STOCK_MOMENTUM_DIVISOR;
  const value = clamp(momentum / divisor, -1, 1);
  const signal = getSignal(value);

  // Acceleration: sliding window if 4+ candles, fallback to r1-r2
  let accelerationRaw: number;
  if (candles.length >= 4) {
    const c4 = candles[len - 4];
    const r4 = (c4.close - c4.open) / c4.open;
    const vNow = r3 * 0.2 + r2 * 0.3 + r1 * 0.5;
    const vPrev = r4 * 0.2 + r3 * 0.3 + r2 * 0.5;
    accelerationRaw = vNow - vPrev;
  } else {
    accelerationRaw = r1 - r2;
  }

  const acceleration = getAcceleration(accelerationRaw);

  // Quality: value adjusted by momentum + acceleration combo
  const qualityMultiplier = getQualityMultiplier(signal, acceleration);
  const quality = value * qualityMultiplier;

  return { value, signal, acceleration, accelerationRaw, quality };
}
