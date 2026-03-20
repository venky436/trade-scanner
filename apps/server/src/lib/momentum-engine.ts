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

function getAcceleration(r1: number, r2: number): MomentumAcceleration {
  const acc = r1 - r2;
  if (acc > 0.001) return "INCREASING";
  if (acc < -0.001) return "DECREASING";
  return "STABLE";
}

export function getMomentum(candles: Candle[]): MomentumResult | null {
  if (candles.length < 3) return null;

  const len = candles.length;
  const c3 = candles[len - 3];
  const c2 = candles[len - 2];
  const c1 = candles[len - 1];

  const r3 = (c3.close - c3.open) / c3.open;
  const r2 = (c2.close - c2.open) / c2.open;
  const r1 = (c1.close - c1.open) / c1.open;

  const momentum = r3 * 0.2 + r2 * 0.3 + r1 * 0.5;
  const value = clamp(momentum / 0.003, -1, 1);
  const signal = getSignal(value);
  const acceleration = getAcceleration(r1, r2);

  return { value, signal, acceleration };
}
