import type { SignalResult } from "./types.js";

export type MarketPhase = "OPENING" | "STABILIZING" | "NORMAL" | "CLOSED";

// Market open: 9:15 AM IST (Mon-Fri)
const MARKET_OPEN_HOUR = 9;
const MARKET_OPEN_MIN = 15;
const MARKET_CLOSE_HOUR = 15;
const MARKET_CLOSE_MIN = 30;

const OPENING_DURATION_MIN = 5;
const STABILIZING_DURATION_MIN = 10;

export interface MarketPhaseResult {
  phase: MarketPhase;
  elapsedMinutes: number;
  scoreMultiplier: number;
  warningMessage: string | null;
}

export function getMarketPhase(): MarketPhaseResult {
  // Use explicit IST timezone — production servers may run in UTC
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const day = now.getDay(); // 0=Sun, 6=Sat
  const hour = now.getHours();
  const min = now.getMinutes();
  const currentMinutes = hour * 60 + min;
  const openMinutes = MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MIN;
  const closeMinutes = MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MIN;

  // Weekend or outside market hours
  if (day === 0 || day === 6 || currentMinutes < openMinutes || currentMinutes > closeMinutes) {
    return {
      phase: "CLOSED",
      elapsedMinutes: 0,
      scoreMultiplier: 1,
      warningMessage: null,
    };
  }

  const elapsed = currentMinutes - openMinutes;

  if (elapsed < OPENING_DURATION_MIN) {
    return {
      phase: "OPENING",
      elapsedMinutes: elapsed,
      scoreMultiplier: 0.6,
      warningMessage: "Market opening volatility — signals restricted",
    };
  }

  if (elapsed < STABILIZING_DURATION_MIN) {
    return {
      phase: "STABILIZING",
      elapsedMinutes: elapsed,
      scoreMultiplier: 0.8,
      warningMessage: "Market stabilizing — only confirmed signals",
    };
  }

  return {
    phase: "NORMAL",
    elapsedMinutes: elapsed,
    scoreMultiplier: 1,
    warningMessage: null,
  };
}

export interface PhaseAdjustedSignal {
  finalScore: number;
  decision: "BUY" | "SELL" | "WAIT";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  marketPhase: MarketPhase;
  elapsedMinutes: number;
  warningMessage: string | null;
}

export function applyMarketPhase(
  signal: SignalResult,
  rawScore: number,
): PhaseAdjustedSignal {
  const { phase, elapsedMinutes, scoreMultiplier, warningMessage } = getMarketPhase();

  // CLOSED — no adjustments
  if (phase === "CLOSED") {
    return {
      finalScore: rawScore,
      decision: signal.action,
      confidence: signal.confidence,
      marketPhase: phase,
      elapsedMinutes,
      warningMessage: null,
    };
  }

  // OPENING (0-5 min) — force WAIT, penalize score
  if (phase === "OPENING") {
    const finalScore = Math.max(1, Math.round(rawScore * scoreMultiplier));
    return {
      finalScore,
      decision: "WAIT",
      confidence: "LOW",
      marketPhase: phase,
      elapsedMinutes,
      warningMessage,
    };
  }

  // STABILIZING (5-10 min) — only allow confirmed breakout/rejection
  if (phase === "STABILIZING") {
    const finalScore = Math.max(1, Math.round(rawScore * scoreMultiplier));

    // Only allow signals with confirmed type (BREAKOUT, REJECTION, BOUNCE, BREAKDOWN)
    if (signal.action !== "WAIT" && signal.type) {
      return {
        finalScore,
        decision: signal.action,
        confidence: "LOW", // always LOW during stabilizing
        marketPhase: phase,
        elapsedMinutes,
        warningMessage,
      };
    }

    // No confirmed type — force WAIT
    return {
      finalScore,
      decision: "WAIT",
      confidence: "LOW",
      marketPhase: phase,
      elapsedMinutes,
      warningMessage: "Waiting for confirmed signal pattern",
    };
  }

  // NORMAL (10+ min) — no restrictions
  return {
    finalScore: rawScore,
    decision: signal.action,
    confidence: signal.confidence,
    marketPhase: phase,
    elapsedMinutes,
    warningMessage: null,
  };
}
