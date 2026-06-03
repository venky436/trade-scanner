export interface SearchableInstrument {
  symbol: string;
  token: number;
  lastPrice: number;
}

export interface InstrumentMaps {
  tokenToSymbol: Map<number, string>;
  symbolToToken: Map<string, number>;
  symbols: string[]; // ordered list of tracked symbols
  allInstruments?: SearchableInstrument[]; // full list for search
}

export interface StockSnapshot {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number; // previous close
  volume: number;
  change: number; // (price - close) / close * 100
  timestamp: number;
  // tick-driven
  pressure?: PressureResult;
  reaction?: "APPROACHING" | "REJECTING" | "BREAKING" | null;
  // candle-driven (set on candle close, reused until next close)
  momentum?: MomentumResult;
  pattern?: PatternSignal;
  signal?: SignalResult;
}

export interface WsMessage {
  type: "snapshot" | "market_update";
  data: StockSnapshot[];
  timestamp: number;
}

export interface Candle {
  time: number; // unix seconds (lightweight-charts wants seconds)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Proximity = "VERY_CLOSE" | "NEAR" | "FAR";
export type Reaction = "APPROACHING" | "REJECTING" | "NEUTRAL";
export type DirectionHint = "BULLISH" | "BEARISH" | "NEUTRAL";

export interface SRZone {
  min: number;
  max: number;
  level: number;
  touches: number;
  strength: number;
  confidence: number;
  distancePercent: number;
  proximity: Proximity;
  reaction: Reaction;
  zoneScore: number;
  isActionable: boolean;
  directionHint: DirectionHint;
}

export interface SROptions {
  windowSize?: number; // default: 10
}

export interface SupportResistanceResult {
  support: number | null;
  resistance: number | null;
  supportZone: SRZone | null;
  resistanceZone: SRZone | null;
  summary: {
    hasNearbySupport: boolean;
    hasNearbyResistance: boolean;
  };
}

export type PatternName =
  | "HAMMER" | "SHOOTING_STAR"
  | "BULLISH_ENGULFING" | "BEARISH_ENGULFING"
  | "DOJI" | "MORNING_STAR" | "EVENING_STAR";

export interface PatternSignal {
  pattern: PatternName;
  direction: "BULLISH" | "BEARISH";
  strength: 1 | 2;        // 1=single-candle, 2=multi-candle
  reason: string;
}

export type PressureSignal = "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL";
export type PressureTrend = "rising" | "falling" | "mixed";

export interface PressureResult {
  value: number;
  signal: PressureSignal;
  trend: PressureTrend;
  confidence: number;
}

export type MomentumSignal = "STRONG_UP" | "UP" | "FLAT" | "DOWN" | "STRONG_DOWN";
export type MomentumAcceleration = "INCREASING" | "DECREASING" | "STABLE";

export interface MomentumResult {
  value: number;                    // -1 to +1
  signal: MomentumSignal;
  acceleration: MomentumAcceleration;
  accelerationRaw: number;          // numeric acceleration value
  quality: number;                  // value × quality multiplier
}

export type SignalAction = "BUY" | "SELL" | "WAIT";
export type SignalType = "BOUNCE" | "REJECTION" | "BREAKOUT" | "BREAKDOWN" | "CONTINUATION";
export type SignalConfidence = "LOW" | "MEDIUM" | "HIGH";

export type MarketPhase = "OPENING" | "STABILIZING" | "NORMAL" | "CLOSED";

export interface SignalResult {
  action: SignalAction;
  type?: SignalType;
  confidence: SignalConfidence;
  reasons: string[];
  score?: number; // 1-10 signal strength
  finalScore?: number; // phase-adjusted score
  marketPhase?: MarketPhase;
  warningMessage?: string | null;
  srType?: "INTRADAY" | "DAILY";
  stage?: SignalStage; // progressive pipeline stage
  scoreBreakdown?: {
    pressure: number;   // 0-10
    momentum: number;
    sr: number;
    pattern: number;
    volatility: number;
  };
}

export interface ScoreBreakdown {
  pressure: number;   // 0-1
  momentum: number;   // 0-1
  sr: number;         // 0-1
  pattern: number;    // 0-1
  volatility: number; // 0-1
  signal: number;     // 0-1
}

export type SignalStage = "ACTIVITY" | "MOMENTUM" | "PRESSURE" | "CONFIRMED";

export interface SignalSnapshot {
  signal: SignalResult;
  stage: SignalStage;
  reaction: "APPROACHING" | "REJECTING" | "BREAKING" | null;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  computedAt: number;
  pressureVersion: number;
  momentumVersion: number;
  patternVersion: number;
}

// ── Market Intelligence (public, user-facing shape) ──

export type Zone = "NEAR_RESISTANCE" | "NEAR_SUPPORT" | "MID_RANGE";
export type IntelligenceMomentumLabel = "STRONG_UP" | "WEAK_UP" | "NEUTRAL" | "WEAK_DOWN" | "STRONG_DOWN";
// NOT_APPLICABLE is used for index symbols — pressure requires order-book
// volume and indices have none (Kite index ticks carry volume=0). Frontend
// renders an N/A card instead of misleading neutral readings.
export type IntelligencePressureLabel = "BUY" | "NEUTRAL" | "SELL" | "NOT_APPLICABLE";
export type VolatilityLabel = "HIGH" | "MEDIUM" | "LOW";
export type Outlook =
  | "BREAKOUT_LIKELY"
  | "BREAKDOWN_RISK"
  | "BOUNCE_EXPECTED"
  | "REJECTION_POSSIBLE"
  | "NO_CLEAR_EDGE";
export type Bias = "BULLISH" | "BEARISH" | "NEUTRAL";
export type ConfidenceLabel = "HIGH" | "MEDIUM" | "LOW";

export interface IntelligenceContext {
  zone: Zone;
  distanceToLevel: number | null; // percent, e.g. 0.35
  level: number | null;           // the nearby S or R price
}

export interface IntelligenceMomentum {
  label: IntelligenceMomentumLabel;
  score: number; // 0..1 magnitude
}

export interface IntelligencePressure {
  label: IntelligencePressureLabel;
  score: number; // 0..1 magnitude
}

export interface IntelligenceVolatility {
  label: VolatilityLabel;
  score: number; // 0..1
}

// Trade plan — explicit BUY/SELL with ATR-derived entry / SL / target.
// null = WAIT (no actionable setup). Personal-use mode; superseded the
// non-directive "intelligence-only" framing from the May 2026 redesign.
// Stop = entry ± 1.5 × ATR, Target = entry ± 3.0 × ATR (fixed 2:1 R:R).
// See docs/market-intelligence.md § "Trade Plan".
export interface TradePlan {
  action: "BUY" | "SELL";
  entry: number;
  stopLoss: number;
  target: number;
  riskPercent: number;    // |entry-SL|/entry × 100
  rewardPercent: number;  // |target-entry|/entry × 100
  riskReward: number;     // always 2.0 today; field reserved for future R:R variation
  atr: number;            // ATR (₹) used to size SL/target — exposed for setup transparency
}

export interface IntelligenceSnapshot {
  symbol: string;
  price: number;
  change: number; // % change vs prev close (so the card can render price delta)
  timestamp: number;
  context: IntelligenceContext;
  momentum: IntelligenceMomentum;
  pressure: IntelligencePressure;
  volatility: IntelligenceVolatility;
  outlook: Outlook;
  bias: Bias;
  confidence: number; // 0..1
  confidenceLabel: ConfidenceLabel;
  tradePlan: TradePlan | null;  // null = WAIT
}

export type MarketCondition = "TRENDING" | "SIDEWAYS";
export type IndexDirection = "UP" | "DOWN" | "FLAT";

export interface MarketContext {
  condition: MarketCondition;
  nifty: { direction: IndexDirection; changePercent: number };
  bankNifty: { direction: IndexDirection; changePercent: number };
}

export interface IntelligenceWsMessage {
  type: "snapshot" | "market_update";
  data: IntelligenceSnapshot[];
  market: MarketContext | null;
  timestamp: number;
}
