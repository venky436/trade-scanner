import type {
  Bias,
  Candle,
  ConfidenceLabel,
  IndexDirection,
  IntelligenceMomentum,
  IntelligenceMomentumLabel,
  IntelligencePressure,
  IntelligencePressureLabel,
  IntelligenceSnapshot,
  IntelligenceVolatility,
  MarketCondition,
  MarketContext,
  MomentumResult,
  Outlook,
  PressureResult,
  SupportResistanceResult,
  VolatilityLabel,
  Zone,
} from "./types.js";

export interface IntelligenceInput {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
  timestamp: number;
  pressure: PressureResult | null;
  momentum: MomentumResult | null;
  sr: SupportResistanceResult | null;
  // Optional rolling-window OHLC (last N five-min candles) for "current chaos"
  // volatility. When ≥ 3 candles supplied, used instead of session high/low.
  recentCandles?: Candle[];
}

const NEAR_ZONE_PERCENT = 1.0; // ≤ 1% from a level counts as "near"

const MOMENTUM_LABEL_MAP: Record<MomentumResult["signal"], IntelligenceMomentumLabel> = {
  STRONG_UP: "STRONG_UP",
  UP: "WEAK_UP",
  FLAT: "NEUTRAL",
  DOWN: "WEAK_DOWN",
  STRONG_DOWN: "STRONG_DOWN",
};

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// Derive implied signal direction from zone + raw momentum value.
// This avoids circular dependency: zone → direction → confidence → outlook.
type ImpliedDirection = "BUY" | "SELL" | "NEUTRAL";

function getImpliedDirection(zone: Zone, momentumValue: number): ImpliedDirection {
  if (zone === "MID_RANGE") return "NEUTRAL";
  // At resistance: positive momentum → breakout (BUY), negative → rejection (SELL)
  // At support: positive momentum → bounce (BUY), negative → breakdown (SELL)
  if (momentumValue > 0) return "BUY";
  if (momentumValue < 0) return "SELL";
  return "NEUTRAL";
}

// Only count the component if it aligns with the expected direction.
function getDirectionalScore(value: number, direction: ImpliedDirection): number {
  if (direction === "BUY") return Math.max(value, 0);
  if (direction === "SELL") return Math.max(-value, 0);
  return 0;
}

function computeZone(
  price: number,
  sr: SupportResistanceResult | null,
): { zone: Zone; distanceToLevel: number | null; level: number | null } {
  const supportZone = sr?.supportZone ?? null;
  const resistanceZone = sr?.resistanceZone ?? null;

  const sDist = supportZone && price > 0
    ? (Math.abs(price - supportZone.level) / price) * 100
    : Infinity;
  const rDist = resistanceZone && price > 0
    ? (Math.abs(price - resistanceZone.level) / price) * 100
    : Infinity;

  const sNear = sDist <= NEAR_ZONE_PERCENT;
  const rNear = rDist <= NEAR_ZONE_PERCENT;

  if (rNear && (!sNear || rDist <= sDist)) {
    return { zone: "NEAR_RESISTANCE", distanceToLevel: round2(rDist), level: resistanceZone!.level };
  }
  if (sNear) {
    return { zone: "NEAR_SUPPORT", distanceToLevel: round2(sDist), level: supportZone!.level };
  }
  return { zone: "MID_RANGE", distanceToLevel: null, level: null };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildMomentum(m: MomentumResult | null): IntelligenceMomentum {
  if (!m) return { label: "NEUTRAL", score: 0 };
  const label = MOMENTUM_LABEL_MAP[m.signal] ?? "NEUTRAL";
  const score = clamp01(Math.abs(m.value));
  return { label, score };
}

function buildPressure(p: PressureResult | null): IntelligencePressure {
  if (!p) return { label: "NEUTRAL", score: 0 };
  let label: IntelligencePressureLabel;
  if (p.signal === "STRONG_BUY" || p.signal === "BUY") label = "BUY";
  else if (p.signal === "STRONG_SELL" || p.signal === "SELL") label = "SELL";
  else label = "NEUTRAL";
  return { label, score: clamp01(Math.abs(p.value)) };
}

// Volatility from intraday range. Prefers a rolling window of the last N
// five-min candles ("current chaos"); falls back to today's session high/low
// when fewer than 3 recent candles are available (cold start, fresh symbol,
// server restart). Bands match score-engine.ts.
function buildVolatility(
  price: number,
  sessionHigh: number,
  sessionLow: number,
  recentCandles?: Candle[],
): IntelligenceVolatility {
  if (price <= 0) return { label: "LOW", score: 0.2 };

  let high: number;
  let low: number;
  if (recentCandles && recentCandles.length >= 3) {
    high = -Infinity;
    low = Infinity;
    for (const c of recentCandles) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
    }
  } else if (sessionHigh > 0 && sessionLow > 0) {
    high = sessionHigh;
    low = sessionLow;
  } else {
    return { label: "LOW", score: 0.2 };
  }

  if (!Number.isFinite(high) || !Number.isFinite(low) || high <= 0 || low <= 0) {
    return { label: "LOW", score: 0.2 };
  }

  const range = (high - low) / price;
  let score: number;
  if (range >= 0.03) score = 1.0;
  else if (range >= 0.02) score = 0.8;
  else if (range >= 0.01) score = 0.6;
  else if (range >= 0.005) score = 0.4;
  else score = 0.2;

  const label: VolatilityLabel = score >= 0.7 ? "HIGH" : score >= 0.4 ? "MEDIUM" : "LOW";
  return { label, score };
}

// Direction-aware confidence:
// Only count momentum/pressure that ALIGNS with the implied direction.
// Wrong-direction strength contributes 0, not inflated confidence.
// Minimum alignment check: both < 0.2 → cap at 0.1 to filter fake weak signals.
function buildConfidence(
  momentumValue: number,
  pressureValue: number,
  volatilityScore: number,
  direction: ImpliedDirection,
): { confidence: number; confidenceLabel: ConfidenceLabel } {
  const alignedMomentum = getDirectionalScore(momentumValue, direction);
  const alignedPressure = getDirectionalScore(pressureValue, direction);

  // Minimum alignment check: if both components are too weak, cap confidence
  if (alignedMomentum < 0.2 && alignedPressure < 0.2) {
    return { confidence: round2(clamp01(alignedMomentum + alignedPressure)), confidenceLabel: "LOW" };
  }

  const base = alignedMomentum * 0.5 + alignedPressure * 0.5;
  const amplifier = 1 - volatilityScore * 0.15;
  const confidence = clamp01(base * amplifier);
  const confidenceLabel: ConfidenceLabel =
    confidence > 0.7 ? "HIGH" : confidence > 0.5 ? "MEDIUM" : "LOW";
  return { confidence: round2(confidence), confidenceLabel };
}

// Outlook decision table (with NO_CLEAR_EDGE fallback for quiet/low-conf states).
function buildOutlook(
  zone: Zone,
  momentumLabel: IntelligenceMomentumLabel,
  confidenceLabel: ConfidenceLabel,
): Outlook {
  if (zone === "MID_RANGE") return "NO_CLEAR_EDGE";

  if (zone === "NEAR_RESISTANCE") {
    if (momentumLabel === "STRONG_UP" && confidenceLabel === "HIGH") return "BREAKOUT_LIKELY";
    if (momentumLabel === "STRONG_DOWN" || momentumLabel === "WEAK_DOWN") return "REJECTION_POSSIBLE";
    return "NO_CLEAR_EDGE";
  }

  // NEAR_SUPPORT
  if (momentumLabel === "STRONG_DOWN" && confidenceLabel === "HIGH") return "BREAKDOWN_RISK";
  if (momentumLabel === "STRONG_UP" || momentumLabel === "WEAK_UP") return "BOUNCE_EXPECTED";
  return "NO_CLEAR_EDGE";
}

function buildBias(momentumLabel: IntelligenceMomentumLabel, pressureLabel: IntelligencePressureLabel): Bias {
  const momentumUp = momentumLabel === "STRONG_UP" || momentumLabel === "WEAK_UP";
  const momentumDown = momentumLabel === "STRONG_DOWN" || momentumLabel === "WEAK_DOWN";
  if (momentumUp && pressureLabel === "BUY") return "BULLISH";
  if (momentumDown && pressureLabel === "SELL") return "BEARISH";
  return "NEUTRAL";
}

export function toIntelligence(input: IntelligenceInput): IntelligenceSnapshot {
  const { zone, distanceToLevel, level } = computeZone(input.price, input.sr);
  const momentum = buildMomentum(input.momentum);
  const pressure = buildPressure(input.pressure);
  const volatility = buildVolatility(input.price, input.high, input.low, input.recentCandles);

  // Direction-aware pipeline: zone → direction → confidence → outlook
  const direction = getImpliedDirection(zone, input.momentum?.value ?? 0);
  const { confidence, confidenceLabel } = buildConfidence(
    input.momentum?.value ?? 0,
    input.pressure?.value ?? 0,
    volatility.score,
    direction,
  );
  const outlook = buildOutlook(zone, momentum.label, confidenceLabel);
  const bias = buildBias(momentum.label, pressure.label);

  const change = input.close !== 0 ? ((input.price - input.close) / input.close) * 100 : 0;

  return {
    symbol: input.symbol,
    price: input.price,
    change: round2(change),
    timestamp: input.timestamp,
    context: { zone, distanceToLevel, level },
    momentum,
    pressure,
    volatility,
    outlook,
    bias,
    confidence,
    confidenceLabel,
  };
}

// Market context — derived from NIFTY 50 + NIFTY BANK quotes.
// Condition: TRENDING when |NIFTY day change| ≥ 0.3%, else SIDEWAYS.
const TRENDING_THRESHOLD_PERCENT = 0.3;

interface IndexQuoteLike {
  lastPrice: number;
  close: number;
}

function indexDirection(quote: IndexQuoteLike | null): { direction: IndexDirection; changePercent: number } {
  if (!quote || quote.close <= 0) return { direction: "FLAT", changePercent: 0 };
  const changePercent = ((quote.lastPrice - quote.close) / quote.close) * 100;
  let direction: IndexDirection;
  if (changePercent > 0.05) direction = "UP";
  else if (changePercent < -0.05) direction = "DOWN";
  else direction = "FLAT";
  return { direction, changePercent: round2(changePercent) };
}

export function buildMarketContext(
  niftyQuote: IndexQuoteLike | null,
  bankNiftyQuote: IndexQuoteLike | null,
): MarketContext {
  const nifty = indexDirection(niftyQuote);
  const bankNifty = indexDirection(bankNiftyQuote);
  const condition: MarketCondition =
    Math.abs(nifty.changePercent) >= TRENDING_THRESHOLD_PERCENT ? "TRENDING" : "SIDEWAYS";
  return { condition, nifty, bankNifty };
}
