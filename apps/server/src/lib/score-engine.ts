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

const PRESSURE_SCORES: Record<string, number> = {
  STRONG_BUY: 1.0,
  BUY: 0.75,
  NEUTRAL: 0.5,
  SELL: 0.25,
  STRONG_SELL: 0.0,
};

function pressureScore(p: PressureResult | null): number {
  if (!p) return 0;
  return PRESSURE_SCORES[p.signal] ?? 0.5;
}

// ── Momentum Score (20%) ──

const MOMENTUM_SCORES: Record<string, number> = {
  STRONG_UP: 1.0,
  UP: 0.75,
  FLAT: 0.5,
  DOWN: 0.25,
  STRONG_DOWN: 0.0,
};

function momentumScore(m: MomentumResult | null): number {
  if (!m) return 0;
  let score = MOMENTUM_SCORES[m.signal] ?? 0.5;
  // Acceleration bonus
  if (m.acceleration === "INCREASING") score = Math.min(1, score + 0.1);
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
  const breakdown: ScoreBreakdown = {
    pressure: pressureScore(input.pressure),
    momentum: momentumScore(input.momentum),
    sr: srScore(input.sr, input.price),
    pattern: patternScore(input.pattern),
    volatility: volatilityScore(input.price, input.open, input.high, input.low),
    signal: signalScore(input.signal),
  };

  const raw =
    breakdown.pressure * 0.25 +
    breakdown.momentum * 0.20 +
    breakdown.sr * 0.20 +
    breakdown.pattern * 0.15 +
    breakdown.volatility * 0.10 +
    breakdown.signal * 0.10;

  const score = Math.max(1, Math.min(10, Math.round(raw * 10)));

  return { score, breakdown };
}
