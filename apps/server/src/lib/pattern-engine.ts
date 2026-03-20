import type { Candle, SRZone, PressureResult, PatternSignal, PatternName } from "./types.js";

interface PatternInput {
  candles: Candle[];            // last 3 max
  currentPrice: number;
  supportZone: SRZone | null;
  resistanceZone: SRZone | null;
  pressure: PressureResult | null;
}

// --- Pattern helpers (all pure, operating on Candle) ---

function body(c: Candle): number {
  return Math.abs(c.close - c.open);
}

function range(c: Candle): number {
  return c.high - c.low;
}

function lowerShadow(c: Candle): number {
  return Math.min(c.open, c.close) - c.low;
}

function upperShadow(c: Candle): number {
  return c.high - Math.max(c.open, c.close);
}

function isBullish(c: Candle): boolean {
  return c.close > c.open;
}

function isBearish(c: Candle): boolean {
  return c.close < c.open;
}

function isHammer(c: Candle): boolean {
  const b = body(c);
  const r = range(c);
  if (r === 0) return false;
  return lowerShadow(c) >= 2 * b && upperShadow(c) <= 0.3 * b && b >= r * 0.2;
}

function isShootingStar(c: Candle): boolean {
  const b = body(c);
  const r = range(c);
  if (r === 0) return false;
  return upperShadow(c) >= 2 * b && lowerShadow(c) <= 0.3 * b && b >= r * 0.2;
}

function isBullishEngulfing(prev: Candle, curr: Candle): boolean {
  if (!isBearish(prev) || !isBullish(curr)) return false;
  return curr.close > prev.open && curr.open < prev.close;
}

function isBearishEngulfing(prev: Candle, curr: Candle): boolean {
  if (!isBullish(prev) || !isBearish(curr)) return false;
  return curr.close < prev.open && curr.open > prev.close;
}

function isDoji(c: Candle): boolean {
  const r = range(c);
  if (r === 0) return false;
  return body(c) <= r * 0.1;
}

function isMorningStar(c3: Candle, c2: Candle, c1: Candle): boolean {
  const c3Body = body(c3);
  const c2Body = body(c2);
  const c3Midpoint = (c3.open + c3.close) / 2;
  // c3 bearish with large body, c2 small body, c1 bullish closing above c3 midpoint
  return (
    isBearish(c3) &&
    c3Body > c2Body * 2 &&
    isBullish(c1) &&
    c1.close > c3Midpoint
  );
}

function isEveningStar(c3: Candle, c2: Candle, c1: Candle): boolean {
  const c3Body = body(c3);
  const c2Body = body(c2);
  const c3Midpoint = (c3.open + c3.close) / 2;
  // c3 bullish with large body, c2 small body, c1 bearish closing below c3 midpoint
  return (
    isBullish(c3) &&
    c3Body > c2Body * 2 &&
    isBearish(c1) &&
    c1.close < c3Midpoint
  );
}

// --- Proximity gate ---

const PROXIMITY_THRESHOLD = 0.005; // 0.5%

function isNearLevel(price: number, level: number): boolean {
  return Math.abs(price - level) / price <= PROXIMITY_THRESHOLD;
}

type Context = "SUPPORT" | "RESISTANCE";

function isBullishPressure(pressure: PressureResult): boolean {
  return pressure.signal === "BUY" || pressure.signal === "STRONG_BUY";
}

function isBearishPressure(pressure: PressureResult): boolean {
  return pressure.signal === "SELL" || pressure.signal === "STRONG_SELL";
}

// --- Main detection ---

export function detectPattern(input: PatternInput): PatternSignal | null {
  const { candles, currentPrice, supportZone, resistanceZone, pressure } = input;

  if (candles.length === 0) return null;

  // 1. Proximity gate
  const nearSupport = supportZone !== null && isNearLevel(currentPrice, supportZone.level);
  const nearResistance = resistanceZone !== null && isNearLevel(currentPrice, resistanceZone.level);

  if (!nearSupport && !nearResistance) return null;

  // Pick the closer one if both qualify
  let context: Context;
  if (nearSupport && nearResistance) {
    const supportDist = Math.abs(currentPrice - supportZone!.level);
    const resistanceDist = Math.abs(currentPrice - resistanceZone!.level);
    context = supportDist <= resistanceDist ? "SUPPORT" : "RESISTANCE";
  } else {
    context = nearSupport ? "SUPPORT" : "RESISTANCE";
  }

  const hasPressure = pressure !== null && pressure.confidence >= 0.3;

  // Most recent candle is the last element
  const c1 = candles[candles.length - 1];
  const c2 = candles.length >= 2 ? candles[candles.length - 2] : null;
  const c3 = candles.length >= 3 ? candles[candles.length - 3] : null;

  // 3. Try patterns in priority order (multi-candle first)
  if (context === "SUPPORT") {
    // Morning Star (3c)
    if (c3 && c2 && hasPressure && isBullishPressure(pressure!) && isMorningStar(c3, c2, c1)) {
      return mk("MORNING_STAR", "BULLISH", 2, "Morning Star reversal at support zone");
    }
    // Bullish Engulfing (2c)
    if (c2 && hasPressure && isBullishPressure(pressure!) && isBullishEngulfing(c2, c1)) {
      return mk("BULLISH_ENGULFING", "BULLISH", 2, "Bullish engulfing at support zone");
    }
    // Hammer (1c)
    if (hasPressure && isBullishPressure(pressure!) && isHammer(c1)) {
      return mk("HAMMER", "BULLISH", 1, "Hammer at support zone");
    }
  }

  if (context === "RESISTANCE") {
    // Evening Star (3c)
    if (c3 && c2 && hasPressure && isBearishPressure(pressure!) && isEveningStar(c3, c2, c1)) {
      return mk("EVENING_STAR", "BEARISH", 2, "Evening Star reversal at resistance zone");
    }
    // Bearish Engulfing (2c)
    if (c2 && hasPressure && isBearishPressure(pressure!) && isBearishEngulfing(c2, c1)) {
      return mk("BEARISH_ENGULFING", "BEARISH", 2, "Bearish engulfing at resistance zone");
    }
    // Shooting Star (1c)
    if (hasPressure && isBearishPressure(pressure!) && isShootingStar(c1)) {
      return mk("SHOOTING_STAR", "BEARISH", 1, "Shooting star at resistance zone");
    }
  }

  // Doji: either side, requires pressure.signal === "NEUTRAL" (exempt from confidence gate)
  if (pressure !== null && pressure.signal === "NEUTRAL" && isDoji(c1)) {
    const direction = context === "SUPPORT" ? "BULLISH" : "BEARISH";
    return mk("DOJI", direction, 1, `Doji indecision at ${context.toLowerCase()} zone`);
  }

  return null;
}

function mk(
  pattern: PatternName,
  direction: "BULLISH" | "BEARISH",
  strength: 1 | 2,
  reason: string,
): PatternSignal {
  return { pattern, direction, strength, reason };
}
