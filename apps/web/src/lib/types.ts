// ── Market Intelligence (public, user-facing shape) ──
//
// The frontend never reads BUY/SELL/score-style signal data. The server's
// internal engines still produce them for accuracy tracking + admin dashboard,
// but the public WS / REST payloads expose only intelligence.

export type Zone = "NEAR_RESISTANCE" | "NEAR_SUPPORT" | "MID_RANGE";
export type MomentumLabel = "STRONG_UP" | "WEAK_UP" | "NEUTRAL" | "WEAK_DOWN" | "STRONG_DOWN";
// NOT_APPLICABLE is used for index symbols — pressure requires order-book
// volume and indices have none. UI renders an N/A card instead of misleading
// neutral readings. Mirrors apps/server/src/lib/types.ts:IntelligencePressureLabel.
export type PressureLabel = "BUY" | "NEUTRAL" | "SELL" | "NOT_APPLICABLE";
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

// ── AI Verdict Module (Experimental) ──
// Mirrors the server's AiCallRecord shape. Optional — present only when the
// server has AI_MODE_ENABLED=true. Frontend components self-disable when the
// /api/config endpoint reports aiModeEnabled = false.

export type AiVerdictAction = "BUY" | "SELL" | "WAIT";

export type AiReasonCode =
  | "SUPPORT_BOUNCE" | "RESISTANCE_REJECTION" | "BREAKOUT" | "BREAKDOWN"
  | "HAMMER" | "ENGULFING" | "MORNING_STAR" | "EVENING_STAR"
  | "BUY_PRESSURE" | "SELL_PRESSURE" | "STRONG_MOMENTUM"
  | "MARKET_ALIGNED" | "RVOL_SURGE" | "STRUCTURAL_LEVEL"
  | "RISK_REWARD_FAVOURABLE";

export type AiRiskFlag =
  | "LOW_VOLUME" | "HIGH_VOLATILITY" | "WEAK_PATTERN" | "AGAINST_MARKET_TREND"
  | "POOR_RR" | "NARROW_RANGE" | "OVEREXTENDED_MOVE" | "WEAK_CONFIRMATION"
  | "SMALL_BODY" | "OPENING_NOISE" | "CLOSING_VOLATILITY"
  | "INSUFFICIENT_CONFLUENCE";

export interface AiVerdict {
  id: number;
  symbol: string;
  computedAt: number;
  verdict: AiVerdictAction;
  /** 0..1 — RANK, not probability. Use for sorting, not for confidence math. */
  confidence: number;
  patterns: string[];
  reasons: AiReasonCode[];
  reasoning: string;
  risk_flags: AiRiskFlag[];
  // Trade plan (null when WAIT)
  entry: number | null;
  stopLoss: number | null;
  target: number | null;
  riskReward: number | null;
  // Snapshot of rule engine for agreement comparison
  ruleVerdict: AiVerdictAction;
  ruleConfidence: number;
  marketRegime: "TRENDING_UP" | "TRENDING_DOWN" | "RANGING" | "HIGH_VOLATILITY";
  /** True when server-side validation forced verdict to WAIT due to bad math. */
  downgraded: boolean;
  downgradeReason: string | null;
}

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

// ── Volatile Stocks screen ──
// Mirrors apps/server/src/lib/types.ts:VolatileStock. Returned by
// GET /api/sections/volatile.

export type VolatileSortKey =
  | "atrPct"
  | "rvol"
  | "changePct"
  | "lastCandleVolSpike";

export type VolatileCandleDirection = "up" | "down" | "flat";

export interface VolatileRecentCandle {
  time: number;
  direction: VolatileCandleDirection;
  volume: number;
  volMultiplier: number | null;
}

export interface VolatileNearestLevel {
  kind: "SUPPORT" | "RESISTANCE";
  price: number;
  distanceAbs: number;
  distancePct: number;
}

export interface VolatileStock {
  symbol: string;
  price: number;
  changePct: number;
  atrPct: number;
  rvol: number;
  dayHigh: number;
  dayLow: number;
  dayRangePosition: number | null;
  nearestLevel: VolatileNearestLevel | null;
  recentCandles: VolatileRecentCandle[];
  zone: Zone;
  pattern: string | null;
}

export interface VolatileStocksResponse {
  stocks: VolatileStock[];
  meta: {
    atrPctFloor: number;
    rvolFloor: number;
    cap: number;
    sortBy: VolatileSortKey;
    priceMin: number | null;
    priceMax: number | null;
    poolSize: number;
    matchedCount: number;
  };
}
