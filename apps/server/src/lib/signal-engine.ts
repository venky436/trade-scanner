import type { PressureResult, MomentumResult, PatternSignal, SignalResult, SignalConfidence } from "./types.js";

interface SignalInput {
  price: number;
  sr: {
    supportZone: { level: number; distancePercent: number } | null;
    resistanceZone: { level: number; distancePercent: number } | null;
  };
  pressure: PressureResult | null;
  momentum: MomentumResult | null;
  pattern: PatternSignal | null;
}

const NEAR_THRESHOLD = 1; // 1% distance

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
  const { pressure, momentum, pattern, sr } = input;
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

  // Rule 3: BREAKOUT — near resistance + STRONG_BUY + STRONG_UP + INCREASING
  if (
    nearResistance &&
    pressure.signal === "STRONG_BUY" &&
    momentum?.signal === "STRONG_UP" &&
    momentum?.acceleration === "INCREASING"
  ) {
    reasons.push(`Near resistance at ${sr.resistanceZone!.level.toFixed(2)} (${sr.resistanceZone!.distancePercent.toFixed(2)}%)`);
    reasons.push("STRONG_BUY pressure");
    reasons.push("STRONG_UP momentum with INCREASING acceleration");
    if (pattern) reasons.push(`${pattern.pattern} pattern detected`);
    return {
      action: "BUY",
      type: "BREAKOUT",
      confidence: patternConfidence("BUY", pattern),
      reasons,
    };
  }

  // Rule 4: BREAKDOWN — near support + STRONG_SELL + STRONG_DOWN + DECREASING
  // acc = r1 - r2: strengthening downtrend means r1 < r2, so acceleration is DECREASING
  if (
    nearSupport &&
    pressure.signal === "STRONG_SELL" &&
    momentum?.signal === "STRONG_DOWN" &&
    momentum?.acceleration === "DECREASING"
  ) {
    reasons.push(`Near support at ${sr.supportZone!.level.toFixed(2)} (${sr.supportZone!.distancePercent.toFixed(2)}%)`);
    reasons.push("STRONG_SELL pressure");
    reasons.push("STRONG_DOWN momentum with DECREASING acceleration");
    if (pattern) reasons.push(`${pattern.pattern} pattern detected`);
    return {
      action: "SELL",
      type: "BREAKDOWN",
      confidence: patternConfidence("SELL", pattern),
      reasons,
    };
  }

  // Rule 5: BOUNCE — near support + BUY/STRONG_BUY + UP/STRONG_UP
  const isBuyPressure = pressure.signal === "BUY" || pressure.signal === "STRONG_BUY";
  const isUpMomentum = momentum?.signal === "UP" || momentum?.signal === "STRONG_UP";
  if (nearSupport && isBuyPressure && isUpMomentum) {
    reasons.push(`Near support at ${sr.supportZone!.level.toFixed(2)} (${sr.supportZone!.distancePercent.toFixed(2)}%)`);
    reasons.push(`${pressure.signal} pressure`);
    reasons.push(`${momentum!.signal} momentum`);
    if (pattern) reasons.push(`${pattern.pattern} pattern detected`);
    return {
      action: "BUY",
      type: "BOUNCE",
      confidence: patternConfidence("BUY", pattern),
      reasons,
    };
  }

  // Rule 6: REJECTION — near resistance + SELL pressure + (DOWN momentum OR weakening momentum)
  const isSellPressure = pressure.signal === "SELL" || pressure.signal === "STRONG_SELL";
  const isDownMomentum = momentum?.signal === "DOWN" || momentum?.signal === "STRONG_DOWN";
  const isMomentumWeakening = (momentum?.signal === "UP" || momentum?.signal === "STRONG_UP") && momentum?.acceleration === "DECREASING";
  if (nearResistance && isSellPressure && (isDownMomentum || isMomentumWeakening)) {
    reasons.push(`Near resistance at ${sr.resistanceZone!.level.toFixed(2)} (${sr.resistanceZone!.distancePercent.toFixed(2)}%)`);
    reasons.push(`${pressure.signal} pressure`);
    if (isDownMomentum) {
      reasons.push(`${momentum!.signal} momentum`);
    } else {
      reasons.push(`Momentum weakening (${momentum!.signal} but decelerating)`);
    }
    if (pattern) reasons.push(`${pattern.pattern} pattern detected`);
    return {
      action: "SELL",
      type: "REJECTION",
      confidence: patternConfidence("SELL", pattern),
      reasons,
    };
  }

  // Default: WAIT
  return { action: "WAIT", confidence: "LOW", reasons: ["Conditions not aligned for a signal"] };
}
