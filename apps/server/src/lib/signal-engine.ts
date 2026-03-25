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
    if (
      price > resistanceLevel + buffer &&
      pressure.signal === "STRONG_BUY" &&
      momentum?.signal === "STRONG_UP"
    ) {
      reasons.push(`Breakout confirmed — price ₹${price.toFixed(2)} above resistance ₹${resistanceLevel.toFixed(2)}`);
      reasons.push("STRONG_BUY pressure");
      reasons.push("STRONG_UP momentum");
      if (pattern) reasons.push(`${pattern.pattern} pattern detected`);
      return {
        action: "BUY",
        type: "BREAKOUT",
        confidence: patternConfidence("BUY", pattern),
        reasons,
      };
    }

    // CONFIRMED REJECTION: price moving DOWN from resistance + sell pressure
    if (
      price < resistanceLevel &&
      isSellPressure &&
      (isDownMomentum || isMomentumWeakening)
    ) {
      reasons.push(`Rejection confirmed — price ₹${price.toFixed(2)} falling from resistance ₹${resistanceLevel.toFixed(2)}`);
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
    if (
      price < supportLevel - buffer &&
      pressure.signal === "STRONG_SELL" &&
      momentum?.signal === "STRONG_DOWN"
    ) {
      reasons.push(`Breakdown confirmed — price ₹${price.toFixed(2)} below support ₹${supportLevel.toFixed(2)}`);
      reasons.push("STRONG_SELL pressure");
      reasons.push("STRONG_DOWN momentum");
      if (pattern) reasons.push(`${pattern.pattern} pattern detected`);
      return {
        action: "SELL",
        type: "BREAKDOWN",
        confidence: patternConfidence("SELL", pattern),
        reasons,
      };
    }

    // CONFIRMED BOUNCE: price moving UP from support + buy pressure
    if (
      price > supportLevel + buffer &&
      isBuyPressure &&
      isUpMomentum
    ) {
      reasons.push(`Bounce confirmed — price ₹${price.toFixed(2)} rising from support ₹${supportLevel.toFixed(2)}`);
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

    // NOT CONFIRMED — WAIT at support
    reasons.push(`Near support at ₹${supportLevel.toFixed(2)} (${sr.supportZone.distancePercent.toFixed(2)}%) — waiting for bounce or breakdown`);
    return { action: "WAIT", confidence: "LOW", reasons };
  }

  // Default: WAIT
  return { action: "WAIT", confidence: "LOW", reasons: ["Conditions not aligned for a signal"] };
}
