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
  /** Day-level path: which frozen line (S1–S3 / R1–R3) the stock is at */
  levelName?: DayLevelName;
  /** Day-level path: price passed all lines on one side → no calls today */
  levelsDone?: boolean;
}

// ── Day levels: the frozen support / resistance lines for today ──
export type DayLevelName = "S1" | "S2" | "S3" | "R1" | "R2" | "R3";
export interface DayLevel {
  name: DayLevelName;
  kind: "SUPPORT" | "RESISTANCE";
  level: number;
  min: number;
  max: number;
  strength: number;
  days: number;
}
export interface DayLevelsView {
  date: string;
  open: number;
  levels: DayLevel[];
  broken: DayLevelName[];
  done: boolean;
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
  /**
   * Human-friendly display label. Present only for index-futures contracts
   * (e.g. "NIFTY (Jun FUT)" for symbol "NIFTY25JUNFUT"). Cards should render
   * `displayName ?? symbol`.
   */
  displayName?: string;
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
  /** Today's frozen S1–S3 / R1–R3 (null before the open / on holidays) */
  dayLevels?: DayLevelsView | null;
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
  /** Human-friendly display label — present only for index-futures. */
  displayName?: string;
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

// ── Day Movers screen ──
// Mirrors apps/server/src/lib/types.ts:DayMover.

export type DayMoverSortKey =
  | "absDayMove"
  | "signedDayMove"
  | "rvol"
  | "lastCandleVolSpike";

export type DayMoverDirectionFilter = "all" | "gainers" | "losers";

export type DayMoverDirection = "up" | "down";

export interface DayMover {
  symbol: string;
  /** Human-friendly display label — present only for index-futures. */
  displayName?: string;
  price: number;
  dayOpen: number;
  dayHigh: number;
  dayLow: number;
  dayMovePct: number;
  absDayMovePct: number;
  direction: DayMoverDirection;
  distanceFromHighAbs: number;
  distanceFromHighPct: number;
  distanceFromLowAbs: number;
  distanceFromLowPct: number;
  dayRangePosition: number | null;
  rvol: number;
  recentCandles: VolatileRecentCandle[];
  zone: Zone;
  pattern: string | null;
}

export interface DayMoversResponse {
  stocks: DayMover[];
  meta: {
    dayMovePctFloor: number;
    rvolFloor: number;
    cap: number;
    direction: DayMoverDirectionFilter;
    sortBy: DayMoverSortKey;
    priceMin: number | null;
    priceMax: number | null;
    poolSize: number;
    matchedCount: number;
    gainersCount: number;
    losersCount: number;
  };
}

// ── Trend Structure lane (GET /api/sections/trend) ──
// Display only: today's 5-min swings labelled HH / HL / LH / LL.
export type SwingLabel = "HH" | "LH" | "HL" | "LL";
export interface TrendSwing {
  price: number;
  time: number; // epoch seconds
  label: SwingLabel | null;
}
export interface TrendStock {
  symbol: string;
  price: number;
  change: number; // % vs previous close
  trend: "UP" | "DOWN";
  stage: "CONFIRMED" | "EARLY"; // confirmed = 3+ swings & 1 %+, early = just forming & 0.5 %+
  steps: number; // agreeing confirmed swings (1 = forming now)
  movePct: number; // % moved since the trend began
  sequence: SwingLabel[]; // labels since the trend began, oldest first
  lastHigh: TrendSwing | null;
  lastLow: TrendSwing | null;
}
export interface TrendResponse {
  stocks: TrendStock[];
  meta: {
    poolSize: number;
    upCount: number;
    downCount: number;
    confirmedMinSteps: number;
    confirmedMinMovePct: number;
    earlyMinMovePct: number;
    computedAt: number;
  };
}
export interface TrendFlag {
  trend: "UP" | "DOWN";
  stage: "CONFIRMED" | "EARLY";
  steps: number;
  sequence: SwingLabel[];
  movePct: number;
}
export interface LevelPatternFlag {
  pattern: string; // e.g. "HAMMER"
  side: "BULLISH" | "BEARISH";
  line: "S1" | "S2" | "S3" | "R1" | "R2" | "R3";
  level: number;
  time: number; // epoch seconds (candle that completed the pattern)
}

// ── Opening movers — BUY / SELL from the first 5-min candle, 09:15 (display only) ──
export interface OpeningCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
export interface OpeningMover {
  symbol: string;
  side: "BUY" | "SELL";
  prevClose: number;
  c1: OpeningCandle;
  movePct: number; // candle 1 close vs yesterday's close
  volumeX: number; // candle 1 volume ÷ normal for that time
  ltp: number | null;
  sinceSignalPct: number | null; // live price vs candle 1 close
}
export type OpeningStatus = "WAITING_LOGIN" | "LOADING" | "WAITING" | "COMPUTING" | "READY" | "NO_SESSION";
export interface OpeningMoversResponse {
  date?: string;
  status: OpeningStatus;
  progress?: { done: number; total: number };
  computedAt?: number | null;
  checked?: number;
  rule?: string;
  stocks: OpeningMover[];
}

// ── Smart zones — FVGs + Order Blocks after a clear move: Reversal / Trend (display only) ──
export type SmartZoneStatus = "IN_TRADE" | "STOPPED" | "CLOSED";
export interface SmartZone {
  id: string;
  symbol: string;
  type: "FVG" | "OB";
  kind: "REVERSAL" | "TREND";
  side: "BUY" | "SELL";
  formedAt: number; // epoch s — pattern complete = entry time
  patternStartAt: number; // FVG candle 1 / OB block candle (open time)
  zoneTop: number;
  zoneBottom: number;
  entry: number; // close of the pattern's last candle
  stop: number; // first candle's low (BUY) / high (SELL)
  move: { fromAt: number; toAt: number; from: number; to: number; pct: number };
  status: SmartZoneStatus;
  exitAt: number | null;
  exitPrice: number | null;
  resultPct: number | null;
  resultR: number | null;
  ltp: number | null;
  toEntryPct: number | null; // live price vs entry, % (in the trade's favour when positive is set by the card)
}
export interface SmartZonesResponse {
  date?: string;
  status: "WAITING_LOGIN" | "WAITING" | "SCANNING" | "LIVE" | "NO_SESSION";
  lastScanAt?: number | null;
  progress?: { done: number; total: number };
  zones: SmartZone[];
}
