import type {
  SignalSnapshot,
  SignalResult,
  SignalStage,
  SignalConfidence,
  ScoreBreakdown,
  PressureResult,
  SupportResistanceResult,
  MomentumResult,
  PatternSignal,
} from "../lib/types.js";
import { getSignal } from "../lib/signal-engine.js";
import { computeSignalScore } from "../lib/score-engine.js";
import { applyMarketPhase, getMarketPhase } from "../lib/market-phase.js";
import { marketDataService } from "./market-data.service.js";

type ReactionValue = "APPROACHING" | "REJECTING" | "BREAKING" | null;

const NEAR_THRESHOLD = 0.01; // 1%
const STAGE_RANK: Record<SignalStage, number> = { ACTIVITY: 1, MOMENTUM: 2, PRESSURE: 3, CONFIRMED: 4 };
const STALENESS_MS = 30_000; // 30s
const CONFIDENCE_DOWNGRADE: Record<SignalConfidence, SignalConfidence> = { HIGH: "MEDIUM", MEDIUM: "LOW", LOW: "LOW" };

interface SignalWorkerConfig {
  batchSize: number;
  batchIntervalMs: number;
  fastLaneIntervalMs: number;
  getPressure: (symbol: string) => PressureResult | null;
  getPressureVersion: (symbol: string) => number;
  getLevels: () => Record<string, SupportResistanceResult>;
  getMomentum: (symbol: string) => MomentumResult | null;
  getMomentumVersion: (symbol: string) => number;
  getPattern: (symbol: string) => PatternSignal | null;
  getPatternVersion: (symbol: string) => number;
  getEligibleSymbols?: () => string[];
  onFirstCycleComplete?: () => void;
}

// ── Reaction computation ──

function computeReactionForLevel(
  price: number, level: number, isResistance: boolean, pressure: PressureResult | undefined,
): ReactionValue {
  const dist = isResistance ? (level - price) / price : (price - level) / price;
  if (Math.abs(dist) > NEAR_THRESHOLD) return null;
  if (dist < 0) {
    const confirming = isResistance
      ? pressure?.signal === "BUY" || pressure?.signal === "STRONG_BUY"
      : pressure?.signal === "SELL" || pressure?.signal === "STRONG_SELL";
    return confirming ? "BREAKING" : "APPROACHING";
  }
  return "APPROACHING";
}

function computeReaction(price: number, sr: SupportResistanceResult, pressure: PressureResult | undefined): ReactionValue {
  let sup: ReactionValue = null;
  let res: ReactionValue = null;
  if (sr.support !== null) sup = computeReactionForLevel(price, sr.support, false, pressure);
  if (sr.resistance !== null) res = computeReactionForLevel(price, sr.resistance, true, pressure);
  if (sup && res) {
    const P: Record<string, number> = { BREAKING: 3, REJECTING: 2, APPROACHING: 1 };
    return (P[sup] ?? 0) >= (P[res] ?? 0) ? sup : res;
  }
  return sup ?? res;
}

function buildFreshSr(price: number, sr: SupportResistanceResult) {
  return {
    supportZone: sr.supportZone
      ? { level: sr.supportZone.level, distancePercent: Math.abs(price - sr.supportZone.level) / price * 100 }
      : null,
    resistanceZone: sr.resistanceZone
      ? { level: sr.resistanceZone.level, distancePercent: Math.abs(price - sr.resistanceZone.level) / price * 100 }
      : null,
  };
}

// ── Signal Worker ──

export function createSignalWorker(config: SignalWorkerConfig) {
  const signalCache = new Map<string, SignalSnapshot>();
  let allSymbols: string[] = [];
  let prioritySymbols: string[] = [];
  let batchIndex = 0;
  let fastLaneTimer: ReturnType<typeof setInterval> | null = null;
  let batchTimer: ReturnType<typeof setInterval> | null = null;
  let priorityTimer: ReturnType<typeof setInterval> | null = null;
  let isComputingFastLane = false;
  let firstCycleComplete = false;
  let onHighConfidenceSignal: ((symbol: string, signal: SignalResult, price: number) => void) | null = null;

  // ── Cache entry with stage protection ──

  function setCacheEntry(
    symbol: string, signal: SignalResult, stage: SignalStage, reaction: ReactionValue,
    score: number, scoreBreakdown: ScoreBreakdown,
  ): void {
    const existing = signalCache.get(symbol);
    // Never downgrade stage
    if (existing && STAGE_RANK[existing.stage] > STAGE_RANK[stage]) return;

    // Attach score to signal for frontend
    signal.score = score;
    signal.stage = stage;
    signal.scoreBreakdown = {
      pressure: Math.round(scoreBreakdown.pressure * 10),
      momentum: Math.round(scoreBreakdown.momentum * 10),
      sr: Math.round(scoreBreakdown.sr * 10),
      pattern: Math.round(scoreBreakdown.pattern * 10),
      volatility: Math.round(scoreBreakdown.volatility * 10),
    };

    // ── Market Phase Adjustment ──
    // Apply AFTER score is computed, BEFORE storing in cache
    const phaseResult = applyMarketPhase(signal, score);
    signal.finalScore = phaseResult.finalScore;
    signal.marketPhase = phaseResult.marketPhase;
    signal.warningMessage = phaseResult.warningMessage;

    // Override decision/confidence during volatile phases
    if (phaseResult.marketPhase === "OPENING") {
      signal.action = "WAIT";
      signal.confidence = "LOW";
    } else if (phaseResult.marketPhase === "STABILIZING") {
      signal.action = phaseResult.decision;
      signal.confidence = phaseResult.confidence;
    }

    // Use phase-adjusted score for final evaluation
    const effectiveScore = phaseResult.finalScore;

    // Track high-confidence signals for accuracy evaluation
    // Only track during NORMAL phase to avoid polluting accuracy data
    const wasBelow8 = !existing || (existing.score < 8);
    if (wasBelow8 && effectiveScore >= 8 && signal.action !== "WAIT" && phaseResult.marketPhase === "NORMAL" && onHighConfidenceSignal) {
      const q = marketDataService.getQuote(symbol);
      if (q) onHighConfidenceSignal(symbol, signal, q.lastPrice);
    }

    // Only mark dirty if signal actually changed (new entry, different action, or different score)
    const signalChanged = !existing
      || existing.signal.action !== signal.action
      || existing.score !== effectiveScore
      || existing.stage !== stage;

    signalCache.set(symbol, {
      signal, stage, reaction, score: effectiveScore, scoreBreakdown,
      computedAt: Date.now(),
      pressureVersion: config.getPressureVersion(symbol),
      momentumVersion: config.getMomentumVersion(symbol),
      patternVersion: config.getPatternVersion(symbol),
    });

    // Mark symbol dirty so broadcast picks up the signal change
    if (signalChanged) {
      marketDataService.markDirty(symbol);
    }
  }

  // ── Progressive signal computation ──

  function getScore(
    signal: SignalResult,
    pressure: PressureResult | null,
    momentum: MomentumResult | null,
    pattern: PatternSignal | null,
    symbolSr: SupportResistanceResult | undefined,
    q: { lastPrice: number; open: number; high: number; low: number },
  ) {
    return computeSignalScore({
      pressure, momentum, pattern,
      sr: symbolSr ?? null,
      signal,
      price: q.lastPrice,
      open: q.open,
      high: q.high,
      low: q.low,
    });
  }

  function computeForSymbol(symbol: string): void {
    const q = marketDataService.getQuote(symbol);
    if (!q || q.lastPrice <= 0) return;

    const pressure = config.getPressure(symbol);
    const momentum = config.getMomentum(symbol);
    const pattern = config.getPattern(symbol);
    const sr = config.getLevels();
    let symbolSr = sr[symbol];

    // Validate S/R orientation — swap if inverted relative to current price
    if (symbolSr && symbolSr.support != null && symbolSr.resistance != null) {
      if (symbolSr.support > q.lastPrice && symbolSr.resistance < q.lastPrice) {
        symbolSr = {
          ...symbolSr,
          support: symbolSr.resistance,
          resistance: symbolSr.support,
          supportZone: symbolSr.resistanceZone,
          resistanceZone: symbolSr.supportZone,
          summary: {
            hasNearbySupport: symbolSr.summary.hasNearbyResistance,
            hasNearbyResistance: symbolSr.summary.hasNearbySupport,
          },
        };
      }
    }

    const existing = signalCache.get(symbol);
    const currentStage = existing?.stage;

    // ── STAGE 4: CONFIRMED (full signal engine — S/R + pressure) ──
    if (symbolSr && pressure) {
      const freshSr = buildFreshSr(q.lastPrice, symbolSr);
      const signal = getSignal({
        price: q.lastPrice, sr: freshSr,
        pressure, momentum: momentum ?? null, pattern: pattern ?? null,
      });
      const reaction = computeReaction(q.lastPrice, symbolSr, pressure);
      const { score, breakdown } = getScore(signal, pressure, momentum, pattern, symbolSr, q);
      setCacheEntry(symbol, signal, "CONFIRMED", reaction, score, breakdown);
      return;
    }

    // ── STAGE 3: PRESSURE (pressure exists but no S/R yet) ──
    if (pressure) {
      const isBuy = pressure.signal === "BUY" || pressure.signal === "STRONG_BUY";
      const isSell = pressure.signal === "SELL" || pressure.signal === "STRONG_SELL";

      if (isBuy || isSell) {
        const action = isBuy ? "BUY" : "SELL";
        const conf: SignalConfidence = pressure.signal.startsWith("STRONG") ? "HIGH" : "MEDIUM";
        const signal: SignalResult = { action, confidence: conf, reasons: [`${pressure.signal} pressure (${pressure.trend})`] };
        const { score, breakdown } = getScore(signal, pressure, momentum, pattern, symbolSr, q);
        setCacheEntry(symbol, signal, "PRESSURE", null, score, breakdown);
        return;
      }
      if (currentStage && STAGE_RANK[currentStage] >= STAGE_RANK.MOMENTUM) return;
    }

    // ── S/R context for early stages ──
    const nearSupport = symbolSr?.supportZone
      ? (Math.abs(q.lastPrice - symbolSr.supportZone.level) / q.lastPrice * 100) <= 2
      : false;
    const nearResistance = symbolSr?.resistanceZone
      ? (Math.abs(q.lastPrice - symbolSr.resistanceZone.level) / q.lastPrice * 100) <= 2
      : false;

    // ── STAGE 2: MOMENTUM (S/R-aware) ──
    if (momentum) {
      const isUp = momentum.signal === "STRONG_UP" || momentum.signal === "UP";
      const isDown = momentum.signal === "STRONG_DOWN" || momentum.signal === "DOWN";

      if (isUp || isDown) {
        if (currentStage && STAGE_RANK[currentStage] >= STAGE_RANK.PRESSURE) return;

        let action: "BUY" | "SELL";
        const reasons: string[] = [`${momentum.signal} momentum (${momentum.acceleration})`];

        // S/R context overrides raw momentum direction
        if (isUp && nearResistance) {
          // Going up into resistance → likely rejection → SELL
          action = "SELL";
          reasons.push("Approaching resistance — potential rejection");
        } else if (isDown && nearSupport) {
          // Going down into support → likely bounce → BUY
          action = "BUY";
          reasons.push("Approaching support — potential bounce");
        } else {
          action = isUp ? "BUY" : "SELL";
        }

        const signal: SignalResult = { action, confidence: "LOW", reasons };
        const { score, breakdown } = getScore(signal, pressure, momentum, pattern, symbolSr, q);
        setCacheEntry(symbol, signal, "MOMENTUM", null, score, breakdown);
        return;
      }
    }

    // ── STAGE 1: ACTIVITY (S/R-aware) ──
    if (!existing) {
      const changePercent = q.close !== 0
        ? Math.abs((q.lastPrice - q.close) / q.close) * 100 : 0;

      if (changePercent >= 0.5) {
        const priceUp = q.lastPrice > q.close;
        const reasons: string[] = [`Active: ${changePercent.toFixed(1)}% move`];

        let action: "BUY" | "SELL" | "WAIT";

        // S/R context: don't say BUY at resistance or SELL at support
        if (priceUp && nearResistance) {
          action = "WAIT";
          reasons.push("Near resistance — waiting for confirmation");
        } else if (!priceUp && nearSupport) {
          action = "WAIT";
          reasons.push("Near support — waiting for confirmation");
        } else {
          action = priceUp ? "BUY" : "SELL";
        }

        const signal: SignalResult = { action, confidence: "LOW", reasons };
        const { score, breakdown } = getScore(signal, pressure, momentum, pattern, symbolSr, q);
        setCacheEntry(symbol, signal, "ACTIVITY", null, score, breakdown);
      }
    }
  }

  // ── Dedup helpers ──

  function recentlyComputed(symbol: string, withinMs: number): boolean {
    const cached = signalCache.get(symbol);
    if (!cached) return false;
    return Date.now() - cached.computedAt < withinMs;
  }

  function shouldSkip(symbol: string): boolean {
    const cached = signalCache.get(symbol);
    if (!cached) return false;

    // Force recompute if market phase changed (OPENING→STABILIZING→NORMAL)
    const { phase } = getMarketPhase();
    if (cached.signal.marketPhase !== phase) return false;

    return (
      cached.pressureVersion === config.getPressureVersion(symbol) &&
      cached.momentumVersion === config.getMomentumVersion(symbol) &&
      cached.patternVersion === config.getPatternVersion(symbol)
    );
  }

  // ── Fast lane: priority stocks every 500ms ──

  function fastLaneTick(): void {
    if (isComputingFastLane) return;
    isComputingFastLane = true;
    try {
      for (const symbol of prioritySymbols) {
        if (recentlyComputed(symbol, 500)) continue;
        computeForSymbol(symbol);
      }
    } finally {
      isComputingFastLane = false;
    }
  }

  // ── Batch: 200 symbols per tick, round-robin ──

  let batchComputedCount = 0;
  let batchSkippedCount = 0;

  function batchTick(): void {
    const end = Math.min(batchIndex + config.batchSize, allSymbols.length);
    const batch = allSymbols.slice(batchIndex, end);

    for (const symbol of batch) {
      if (recentlyComputed(symbol, 500)) { batchSkippedCount++; continue; }
      if (shouldSkip(symbol)) { batchSkippedCount++; continue; }
      computeForSymbol(symbol);
      batchComputedCount++;
    }

    batchIndex = end;

    if (batchIndex >= allSymbols.length) {
      // Count stages
      let activity = 0, momentum = 0, pressure = 0, confirmed = 0;
      let buyCount = 0, sellCount = 0;
      for (const s of signalCache.values()) {
        if (s.stage === "ACTIVITY") activity++;
        else if (s.stage === "MOMENTUM") momentum++;
        else if (s.stage === "PRESSURE") pressure++;
        else if (s.stage === "CONFIRMED") confirmed++;
        if (s.signal.action === "BUY") buyCount++;
        if (s.signal.action === "SELL") sellCount++;
      }
      const highScore = [...signalCache.values()].filter((s) => s.score >= 8).length;
      const midScore = [...signalCache.values()].filter((s) => s.score >= 6 && s.score < 8).length;
      console.log(
        `[SignalWorker] Cycle: ${signalCache.size} cached, ${batchComputedCount} computed, ${batchSkippedCount} skipped | ` +
        `ACTIVITY: ${activity}, MOMENTUM: ${momentum}, PRESSURE: ${pressure}, CONFIRMED: ${confirmed} | ` +
        `BUY: ${buyCount}, SELL: ${sellCount} | score≥8: ${highScore}, score≥6: ${midScore}`
      );
      batchIndex = 0;
      batchComputedCount = 0;
      batchSkippedCount = 0;

      // One-time: after first full cycle, push full snapshot to all clients
      if (!firstCycleComplete) {
        firstCycleComplete = true;
        config.onFirstCycleComplete?.();
      }
    }
  }

  // ── Priority rebuild: use eligible stocks ──

  function rebuildPriority(): void {
    const eligible = config.getEligibleSymbols?.() ?? [];
    if (eligible.length > 0) {
      prioritySymbols = eligible.slice(0, 100);
      return;
    }

    const quotes = marketDataService.getAllQuotes();
    const active: { symbol: string; score: number }[] = [];
    for (const symbol of allSymbols) {
      const q = quotes.get(symbol);
      if (!q) continue;
      const absChange = Math.abs(q.lastPrice && q.close ? ((q.lastPrice - q.close) / q.close) * 100 : 0);
      const score = absChange + (q.volume > 0 ? 1 : 0);
      if (score > 1) active.push({ symbol, score });
    }
    active.sort((a, b) => b.score - a.score);
    const dynamicTop = active.slice(0, 50).map((a) => a.symbol);
    const staticTop = allSymbols.slice(0, 50);
    const combined = new Set([...staticTop, ...dynamicTop]);
    prioritySymbols = [...combined].slice(0, 100);
  }

  // ── Public API ──

  return {
    setSymbols(symbols: string[]) {
      allSymbols = symbols;
      prioritySymbols = symbols.slice(0, 100);
      batchIndex = 0;
    },

    setOnHighConfidenceSignal(cb: (symbol: string, signal: SignalResult, price: number) => void) {
      onHighConfidenceSignal = cb;
    },

    getSignal(symbol: string): SignalSnapshot | null {
      const cached = signalCache.get(symbol);
      if (!cached) return null;

      // Staleness protection: downgrade confidence if stale
      if (Date.now() - cached.computedAt > STALENESS_MS) {
        return {
          ...cached,
          signal: {
            ...cached.signal,
            confidence: CONFIDENCE_DOWNGRADE[cached.signal.confidence],
          },
        };
      }

      return cached;
    },

    getCacheSize(): number {
      return signalCache.size;
    },

    start() {
      fastLaneTimer = setInterval(fastLaneTick, config.fastLaneIntervalMs);
      fastLaneTimer.unref();
      batchTimer = setInterval(batchTick, config.batchIntervalMs);
      batchTimer.unref();
      priorityTimer = setInterval(rebuildPriority, 30_000);
      priorityTimer.unref();
      console.log(`Signal worker started (fast lane: ${config.fastLaneIntervalMs}ms, batch: ${config.batchIntervalMs}ms × ${config.batchSize})`);
    },

    stop() {
      if (fastLaneTimer) { clearInterval(fastLaneTimer); fastLaneTimer = null; }
      if (batchTimer) { clearInterval(batchTimer); batchTimer = null; }
      if (priorityTimer) { clearInterval(priorityTimer); priorityTimer = null; }
      console.log("Signal worker stopped");
    },
  };
}

export type SignalWorker = ReturnType<typeof createSignalWorker>;
