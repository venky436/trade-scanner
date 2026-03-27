import type {
  PressureResult,
  MomentumResult,
  PatternSignal,
  SupportResistanceResult,
  SignalResult,
  ScoreBreakdown,
} from "./types.js";

interface ScoreInput {
  pressure: PressureResult | null;
  momentum: MomentumResult | null;
  pattern: PatternSignal | null;
  sr: SupportResistanceResult | null;
  signal: SignalResult;
  price: number;
  open: number;
  high: number;
  low: number;
}

// ── Pressure Score (25%) ──

// Pressure and momentum scores are direction-aware:
// For BUY signals: STRONG_BUY=1.0, STRONG_SELL=0.0 (buying strength)
// For SELL signals: STRONG_SELL=1.0, STRONG_BUY=0.0 (selling strength)
// We use signal action to determine which direction to score

const PRESSURE_BUY_SCORES: Record<string, number> = {
  STRONG_BUY: 1.0, BUY: 0.75, NEUTRAL: 0.5, SELL: 0.25, STRONG_SELL: 0.0,
};
const PRESSURE_SELL_SCORES: Record<string, number> = {
  STRONG_SELL: 1.0, SELL: 0.75, NEUTRAL: 0.5, BUY: 0.25, STRONG_BUY: 0.0,
};

function pressureScore(p: PressureResult | null, action?: string): number {
  if (!p) return 0;
  const scores = action === "SELL" ? PRESSURE_SELL_SCORES : PRESSURE_BUY_SCORES;
  return scores[p.signal] ?? 0.5;
}

// ── Momentum Score (20%) ──

const MOMENTUM_BUY_SCORES: Record<string, number> = {
  STRONG_UP: 1.0, UP: 0.75, FLAT: 0.5, DOWN: 0.25, STRONG_DOWN: 0.0,
};
const MOMENTUM_SELL_SCORES: Record<string, number> = {
  STRONG_DOWN: 1.0, DOWN: 0.75, FLAT: 0.5, UP: 0.25, STRONG_UP: 0.0,
};

function momentumScore(m: MomentumResult | null, action?: string): number {
  if (!m) return 0;
  const scores = action === "SELL" ? MOMENTUM_SELL_SCORES : MOMENTUM_BUY_SCORES;
  let score = scores[m.signal] ?? 0.5;
  // Acceleration bonus (INCREASING for BUY, DECREASING for SELL)
  const goodAccel = action === "SELL" ? "DECREASING" : "INCREASING";
  if (m.acceleration === goodAccel) score = Math.min(1, score + 0.1);
  return score;
}

// ── S/R Score (20%) ──

function srScore(sr: SupportResistanceResult | null, price: number): number {
  if (!sr || price <= 0) return 0;

  let best = 0;

  // Check support proximity — compute fresh distance from current price
  if (sr.supportZone) {
    const dist = Math.abs(price - sr.supportZone.level) / price * 100;
    let s = 0;
    if (dist <= 0.5) s = 1.0;
    else if (dist <= 1) s = 0.8;
    else if (dist <= 2) s = 0.6;
    else if (dist <= 5) s = 0.3;
    else s = 0.1;
    // Touches bonus
    if (sr.supportZone.touches >= 5) s = Math.min(1, s + 0.1);
    best = Math.max(best, s);
  }

  // Check resistance proximity — compute fresh distance from current price
  if (sr.resistanceZone) {
    const dist = Math.abs(price - sr.resistanceZone.level) / price * 100;
    let s = 0;
    if (dist <= 0.5) s = 1.0;
    else if (dist <= 1) s = 0.8;
    else if (dist <= 2) s = 0.6;
    else if (dist <= 5) s = 0.3;
    else s = 0.1;
    if (sr.resistanceZone.touches >= 5) s = Math.min(1, s + 0.1);
    best = Math.max(best, s);
  }

  return best;
}

// ── Pattern Score (15%) ──

const STRONG_PATTERNS = new Set(["BULLISH_ENGULFING", "BEARISH_ENGULFING", "MORNING_STAR", "EVENING_STAR"]);
const MEDIUM_PATTERNS = new Set(["HAMMER", "SHOOTING_STAR"]);

function patternScore(p: PatternSignal | null): number {
  if (!p) return 0;
  if (STRONG_PATTERNS.has(p.pattern)) return 1.0;
  if (MEDIUM_PATTERNS.has(p.pattern)) return 0.7;
  return 0.5; // DOJI
}

// ── Volatility Score (10%) ──

function volatilityScore(price: number, open: number, high: number, low: number): number {
  if (high <= 0 || low <= 0 || price <= 0) return 0;
  const range = (high - low) / price;
  const bodySize = Math.abs(price - open) / price;

  // Normalize: typical intraday range ~1-3%
  if (range >= 0.03) return 1.0;
  if (range >= 0.02) return 0.8;
  if (range >= 0.01) return 0.6;
  if (range >= 0.005) return 0.4;
  return 0.2;
}

// ── Signal Boost (10%) ──

function signalScore(s: SignalResult): number {
  if (s.action === "WAIT") return 0;
  if (s.confidence === "HIGH") return 1.0;
  if (s.confidence === "MEDIUM") return 0.7;
  return 0.5;
}

// ── Main Score Function ──

export function computeSignalScore(input: ScoreInput): { score: number; breakdown: ScoreBreakdown } {
  const action = input.signal.action;
  const isConfirmed = input.signal.type != null; // BREAKOUT/BOUNCE/REJECTION/BREAKDOWN
  const breakdown: ScoreBreakdown = {
    pressure: pressureScore(input.pressure, action),
    momentum: momentumScore(input.momentum, action),
    // Confirmed signals at S/R get minimum 0.8 — crossing the level IS the strongest setup
    sr: isConfirmed ? Math.max(0.8, srScore(input.sr, input.price)) : srScore(input.sr, input.price),
    pattern: patternScore(input.pattern),
    volatility: volatilityScore(input.price, input.open, input.high, input.low),
    signal: signalScore(input.signal),
  };

  // Pattern excluded from score — shown as visual badge only on frontend
  const raw =
    breakdown.pressure * 0.30 +
    breakdown.momentum * 0.25 +
    breakdown.sr * 0.25 +
    breakdown.volatility * 0.10 +
    breakdown.signal * 0.10;

  const score = Math.max(1, Math.min(10, Math.round(raw * 10)));

  return { score, breakdown };
}
