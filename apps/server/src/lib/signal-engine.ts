import type { PressureResult, MomentumResult, PatternSignal, SignalResult, SignalConfidence, Candle } from "./types.js";

interface SignalInput {
  price: number;
  sr: {
    supportZone: { level: number; distancePercent: number } | null;
    resistanceZone: { level: number; distancePercent: number } | null;
  };
  pressure: PressureResult | null;
  momentum: MomentumResult | null;
  pattern: PatternSignal | null;
  recentCandles?: Candle[];
}

const NEAR_THRESHOLD = 1; // 1% distance
const CONFIRMATION_BUFFER = 0.002; // 0.2% — price must cross level by this much to confirm

function patternConfidence(
  action: "BUY" | "SELL",
  pattern: PatternSignal | null,
): SignalConfidence {
  if (!pattern) return "MEDIUM";
  const confirming =
    (action === "BUY" && pattern.direction === "BULLISH") ||
    (action === "SELL" && pattern.direction === "BEARISH");
  return confirming ? "HIGH" : "LOW";
}

export function getSignal(input: SignalInput): SignalResult {
  const { price, pressure, momentum, pattern, sr } = input;
  const reasons: string[] = [];

  // Gate 1: pressure is mandatory
  if (!pressure) {
    return { action: "WAIT", confidence: "LOW", reasons: ["No pressure data"] };
  }

  const nearSupport = sr.supportZone !== null && sr.supportZone.distancePercent <= NEAR_THRESHOLD;
  const nearResistance = sr.resistanceZone !== null && sr.resistanceZone.distancePercent <= NEAR_THRESHOLD;

  // Gate 2: must be near at least one level
  if (!nearSupport && !nearResistance) {
    return { action: "WAIT", confidence: "LOW", reasons: ["Not near any S/R level"] };
  }

  // Helper: pressure/momentum classifications
  const isBuyPressure = pressure.signal === "BUY" || pressure.signal === "STRONG_BUY";
  const isSellPressure = pressure.signal === "SELL" || pressure.signal === "STRONG_SELL";
  const isUpMomentum = momentum?.signal === "UP" || momentum?.signal === "STRONG_UP";
  const isDownMomentum = momentum?.signal === "DOWN" || momentum?.signal === "STRONG_DOWN";
  const isMomentumWeakening = isUpMomentum && momentum?.acceleration === "DECREASING";

  // ══════════════════════════════════════════════
  // AT RESISTANCE — wait for confirmation
  // ══════════════════════════════════════════════
  if (nearResistance && sr.resistanceZone) {
    const resistanceLevel = sr.resistanceZone.level;
    const buffer = resistanceLevel * CONFIRMATION_BUFFER;

    // CONFIRMED BREAKOUT: price has crossed ABOVE resistance + buffer
    const isAccelerating = momentum?.acceleration === "INCREASING";
    const isHighQuality = momentum?.quality !== undefined ? momentum.quality > 0.5 : true;
    if (
      price > resistanceLevel + buffer &&
      isBuyPressure &&
      isUpMomentum &&
      isAccelerating &&
      isHighQuality
    ) {
      reasons.push(`Breakout confirmed — price ₹${price.toFixed(2)} above resistance ₹${resistanceLevel.toFixed(2)}`);
      reasons.push(`${pressure.signal} pressure`);
      reasons.push(`${momentum!.signal} momentum (${momentum!.acceleration}, quality: ${momentum!.quality.toFixed(2)})`);
      if (pattern) reasons.push(`${pattern.pattern} pattern detected`);
      return {
        action: "BUY",
        type: "BREAKOUT",
        confidence: patternConfidence("BUY", pattern),
        reasons,
      };
    }

    // CONFIRMED REJECTION: candle-confirmed reversal at resistance
    const rejCandles = input.recentCandles ?? [];
    if (rejCandles.length >= 2 && momentum && pressure.confidence >= 0.5) {
      const lastCandle = rejCandles[rejCandles.length - 1];
      const prevCandle = rejCandles[rejCandles.length - 2];
      const candleBody = Math.abs(lastCandle.close - lastCandle.open);
      const candleRange = lastCandle.high - lastCandle.low;
      const upperWick = lastCandle.high - Math.max(lastCandle.open, lastCandle.close);

      // 1. Candle must close below resistance
      const closedBelow = lastCandle.close < resistanceLevel;

      // 2. Rejection structure: upper wick present + close in lower 40% of range
      const hasRejectionStructure = candleRange > 0
        && upperWick > candleBody * 0.7
        && (lastCandle.close - lastCandle.low) / candleRange < 0.4;

      // 3. Momentum reversal: previous candle bullish, current candle MUST be bearish (strict)
      const prevBullish = prevCandle.close > prevCandle.open;
      const currBearish = lastCandle.close < lastCandle.open;
      const momentumReversing = prevBullish && currBearish;

      // 4. Acceleration filter: must be decelerating
      const isDecelerating = momentum.accelerationRaw < -0.001;

      // 5. Micro trend filter: block if last 3 candles show sustained uptrend
      let sustainedUptrend = false;
      if (rejCandles.length >= 3) {
        const c3 = rejCandles[rejCandles.length - 3];
        const c2 = rejCandles[rejCandles.length - 2];
        const c1 = rejCandles[rejCandles.length - 1];
        sustainedUptrend = c3.close > c3.open && c2.close > c2.open && c1.close > c1.open;
      }

      // 6. Quality filter: momentum quality must be significant
      const hasQuality = Math.abs(momentum.quality) > 0.6;

      if (
        closedBelow &&
        hasRejectionStructure &&
        momentumReversing &&
        isDecelerating &&
        isSellPressure &&
        !sustainedUptrend &&
        hasQuality
      ) {
        reasons.push(`Rejection confirmed — candle closed ₹${lastCandle.close.toFixed(2)} below resistance ₹${resistanceLevel.toFixed(2)}`);
        reasons.push(`Rejection structure (upper wick > body, close in lower 40%)`);
        reasons.push(`${pressure.signal} pressure (confidence: ${(pressure.confidence * 100).toFixed(0)}%)`);
        reasons.push(`${momentum.signal} momentum (${momentum.acceleration}, accel: ${momentum.accelerationRaw.toFixed(4)})`);
        if (pattern) reasons.push(`${pattern.pattern} pattern detected`);
        return {
          action: "SELL",
          type: "REJECTION",
          confidence: patternConfidence("SELL", pattern),
          reasons,
        };
      }
    }

    // NOT CONFIRMED — WAIT at resistance
    reasons.push(`Near resistance at ₹${resistanceLevel.toFixed(2)} (${sr.resistanceZone.distancePercent.toFixed(2)}%) — waiting for breakout or rejection`);
    return { action: "WAIT", confidence: "LOW", reasons };
  }

  // ══════════════════════════════════════════════
  // AT SUPPORT — wait for confirmation
  // ══════════════════════════════════════════════
  if (nearSupport && sr.supportZone) {
    const supportLevel = sr.supportZone.level;
    const buffer = supportLevel * CONFIRMATION_BUFFER;

    // CONFIRMED BREAKDOWN: price has dropped BELOW support - buffer
    const isBreakdownAccelerating = momentum?.acceleration === "DECREASING";
    const isBreakdownHighQuality = momentum?.quality !== undefined ? Math.abs(momentum.quality) > 0.5 : true;
    if (
      price < supportLevel - buffer &&
      pressure.signal === "STRONG_SELL" &&
      momentum?.signal === "STRONG_DOWN" &&
      isBreakdownAccelerating &&
      isBreakdownHighQuality
    ) {
      reasons.push(`Breakdown confirmed — price ₹${price.toFixed(2)} below support ₹${supportLevel.toFixed(2)}`);
      reasons.push("STRONG_SELL pressure");
      reasons.push(`STRONG_DOWN momentum (${momentum!.acceleration}, quality: ${momentum!.quality.toFixed(2)})`);
      if (pattern) reasons.push(`${pattern.pattern} pattern detected`);
      return {
        action: "SELL",
        type: "BREAKDOWN",
        confidence: patternConfidence("SELL", pattern),
        reasons,
      };
    }

    // CONFIRMED BOUNCE: candle-confirmed reversal at support
    const bounceCandles = input.recentCandles ?? [];
    if (bounceCandles.length >= 2 && momentum && pressure.confidence >= 0.5) {
      const lastCandle = bounceCandles[bounceCandles.length - 1];
      const prevCandle = bounceCandles[bounceCandles.length - 2];
      const candleBody = Math.abs(lastCandle.close - lastCandle.open);
      const candleRange = lastCandle.high - lastCandle.low;
      const lowerWick = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;

      // 1. Candle must close above support
      const closedAbove = lastCandle.close > supportLevel;

      // 2. Bounce structure: lower wick present + close in upper 40% of range
      const hasBounceStructure = candleRange > 0
        && lowerWick > candleBody * 0.7
        && (lastCandle.high - lastCandle.close) / candleRange < 0.4;

      // 3. Momentum shift: previous candle bearish, current candle MUST be bullish (strict)
      const prevBearish = prevCandle.close < prevCandle.open;
      const currBullish = lastCandle.close > lastCandle.open;
      const momentumShifting = prevBearish && currBullish;

      // 4. Acceleration filter: must be accelerating upward
      const isAcceleratingUp = momentum.accelerationRaw > 0.001;

      // 5. Micro trend filter: block if last 3 candles show sustained downtrend
      let sustainedDowntrend = false;
      if (bounceCandles.length >= 3) {
        const c3 = bounceCandles[bounceCandles.length - 3];
        const c2 = bounceCandles[bounceCandles.length - 2];
        const c1 = bounceCandles[bounceCandles.length - 1];
        sustainedDowntrend = c3.close < c3.open && c2.close < c2.open && c1.close < c1.open;
      }

      if (
        closedAbove &&
        hasBounceStructure &&
        momentumShifting &&
        isAcceleratingUp &&
        isBuyPressure &&
        !sustainedDowntrend
      ) {
        reasons.push(`Bounce confirmed — candle closed ₹${lastCandle.close.toFixed(2)} above support ₹${supportLevel.toFixed(2)}`);
        reasons.push(`Bounce structure (lower wick > body, close in upper 40%)`);
        reasons.push(`${pressure.signal} pressure (confidence: ${(pressure.confidence * 100).toFixed(0)}%)`);
        reasons.push(`${momentum.signal} momentum (${momentum.acceleration}, accel: ${momentum.accelerationRaw.toFixed(4)})`);
        if (pattern) reasons.push(`${pattern.pattern} pattern detected`);
        return {
          action: "BUY",
          type: "BOUNCE",
          confidence: patternConfidence("BUY", pattern),
          reasons,
        };
      }
    }

    // NOT CONFIRMED — WAIT at support
    reasons.push(`Near support at ₹${supportLevel.toFixed(2)} (${sr.supportZone.distancePercent.toFixed(2)}%) — waiting for bounce or breakdown`);
    return { action: "WAIT", confidence: "LOW", reasons };
  }

  // Default: WAIT
  return { action: "WAIT", confidence: "LOW", reasons: ["Conditions not aligned for a signal"] };
}
