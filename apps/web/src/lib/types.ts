// ── Market Intelligence (public, user-facing shape) ──
//
// The frontend never reads BUY/SELL/score-style signal data. The server's
// internal engines still produce them for accuracy tracking + admin dashboard,
// but the public WS / REST payloads expose only intelligence.

export type Zone = "NEAR_RESISTANCE" | "NEAR_SUPPORT" | "MID_RANGE";
export type MomentumLabel = "STRONG_UP" | "WEAK_UP" | "NEUTRAL" | "WEAK_DOWN" | "STRONG_DOWN";
export type PressureLabel = "BUY" | "NEUTRAL" | "SELL";
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
  distanceToLevel: number | null;
  level: number | null;
}

export interface IntelligenceMomentum {
  label: MomentumLabel;
  score: number;
}

export interface IntelligencePressure {
  label: PressureLabel;
  score: number;
}

export interface IntelligenceVolatility {
  label: VolatilityLabel;
  score: number;
}

export interface IntelligenceSnapshot {
  symbol: string;
  price: number;
  change: number;
  timestamp: number;
  context: IntelligenceContext;
  momentum: IntelligenceMomentum;
  pressure: IntelligencePressure;
  volatility: IntelligenceVolatility;
  outlook: Outlook;
  bias: Bias;
  confidence: number;
  confidenceLabel: ConfidenceLabel;
}

// Alias kept so existing imports of StockData keep working — they all become intelligence now.
export type StockData = IntelligenceSnapshot;

export type MarketCondition = "TRENDING" | "SIDEWAYS";
export type IndexDirection = "UP" | "DOWN" | "FLAT";

export interface MarketContext {
  condition: MarketCondition;
  nifty: { direction: IndexDirection; changePercent: number };
  bankNifty: { direction: IndexDirection; changePercent: number };
}

export interface MarketMessage {
  type: "snapshot" | "market_update";
  data: IntelligenceSnapshot[];
  market: MarketContext | null;
  timestamp: number;
}

export type SortKey = "symbol" | "price" | "change" | "confidence";
export type SortDirection = "asc" | "desc";

export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ── Chart-helper types (kept for the candlestick chart S/R drawing) ──

export interface SROnlyLevels {
  support: number | null;
  resistance: number | null;
}

// Single-stock detail snapshot returned by /api/stocks/:symbol/snapshot.
// Combines the public intelligence shape with chart-only helper fields.
export interface StockDetailSnapshot extends IntelligenceSnapshot {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  levels: SROnlyLevels;
  dataSource: "live" | "on-demand";
  computedAt: number;
}
