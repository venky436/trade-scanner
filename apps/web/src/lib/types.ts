export interface StockData {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
  timestamp: number;
  pressure?: PressureResult;
}

export interface MarketMessage {
  type: "snapshot" | "market_update";
  data: StockData[];
  timestamp: number;
}

export type SortKey = "symbol" | "price" | "change" | "volume" | "high" | "low" | "open";
export type SortDirection = "asc" | "desc";

export interface CandleData {
  time: number; // unix seconds
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
