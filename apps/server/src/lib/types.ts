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
}

export type SignalAction = "BUY" | "SELL" | "WAIT";
export type SignalType = "BOUNCE" | "REJECTION" | "BREAKOUT" | "BREAKDOWN";
export type SignalConfidence = "LOW" | "MEDIUM" | "HIGH";

export interface SignalResult {
  action: SignalAction;
  type?: SignalType;
  confidence: SignalConfidence;
  reasons: string[];
  score?: number; // 1-10 signal strength
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
