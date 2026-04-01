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
  Candle,
} from "../lib/types.js";
import { getSignal } from "../lib/signal-engine.js";
import { computeSignalScore } from "../lib/score-engine.js";
import { applyMarketPhase, getMarketPhase } from "../lib/market-phase.js";
import { selectBestSR } from "./intraday-levels.service.js";
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
  getIntradayLevels?: () => Record<string, SupportResistanceResult>;
  getSessionCandleCount?: (symbol: string) => number;
  getLastCandle?: (symbol: string) => Candle | null;
  getSessionCandles?: (symbol: string) => Candle[];
  getGlobalMarketState?: () => "DEAD" | "SLOW" | "ACTIVE";
  onFirstCycleComplete?: () => void;
}

// ── Market Filter thresholds ──
const STOCK_DEAD_RANGE = 0.002;    // 0.2% — skip stock (truly flat)
const STOCK_SIDEWAYS_RANGE = 0.005; // 0.5% — block breakouts
const SLOW_MARKET_RANGE = 0.004;    // 0.4% — higher threshold during slow market

// ── Bounce Quality Filter thresholds ──
const BOUNCE_MAX_RECENT_MOVE = 0.025;  // 2.5% — reject bounce if stock already rallied this much

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
  // Market filter rejection counters (reset each batch cycle)
  let filterRejects = { globalDead: 0, lowRange: 0, slowMarket: 0, sidewaysBreakout: 0, bounceRejected: 0 };
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
    const wasBelow9 = !existing || (existing.score < 9);
    if (wasBelow9 && effectiveScore >= 9 && signal.action !== "WAIT" && signal.type && stage === "CONFIRMED" && phaseResult.marketPhase === "NORMAL" && onHighConfidenceSignal) {
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

    // ── Market Filter Layer ──
    const globalState = config.getGlobalMarketState?.() ?? "ACTIVE";

    // Global DEAD → skip all stocks
    if (globalState === "DEAD") { filterRejects.globalDead++; return; }

    // Per-stock 5-min range check
    const lastCandle = config.getLastCandle?.(symbol);
    if (lastCandle && lastCandle.high > 0 && lastCandle.low > 0) {
      const stockRange = (lastCandle.high - lastCandle.low) / q.lastPrice;

      // Stock too quiet → skip
      if (stockRange < STOCK_DEAD_RANGE) { filterRejects.lowRange++; return; }

      // Global SLOW + stock not active enough → skip
      if (globalState === "SLOW" && stockRange < SLOW_MARKET_RANGE) { filterRejects.slowMarket++; return; }
    }

    const pressure = config.getPressure(symbol);
    const momentum = config.getMomentum(symbol);
    const pattern = config.getPattern(symbol);
    const dailyLevels = config.getLevels();
    const intradayLevels = config.getIntradayLevels?.() ?? {};
    const sessionCandleCount = config.getSessionCandleCount?.(symbol) ?? 0;

    // Early market (before 9:30 AM IST) → force daily S/R only
    const istNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const earlyMarket = istNow.getHours() === 9 && istNow.getMinutes() < 30;

    // Merge daily + intraday S/R (force daily before 9:30 AM)
    const { sr: mergedSr, srType } = earlyMarket
      ? { sr: dailyLevels[symbol], srType: "DAILY" as const }
      : selectBestSR(dailyLevels[symbol], intradayLevels[symbol] ?? null, q.lastPrice, sessionCandleCount);
    let symbolSr = mergedSr;

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
      const sessionCandles = config.getSessionCandles?.(symbol) ?? [];
      const signal = getSignal({
        price: q.lastPrice, sr: freshSr,
        pressure, momentum: momentum ?? null, pattern: pattern ?? null,
        recentCandles: sessionCandles.slice(-3),
      });
      signal.srType = srType;

      // Sideways filter: block BREAKOUT/BREAKDOWN in sideways market
      if (lastCandle && lastCandle.high > 0 && lastCandle.low > 0) {
        const stockRange = (lastCandle.high - lastCandle.low) / q.lastPrice;
        if (stockRange < STOCK_SIDEWAYS_RANGE && (signal.type === "BREAKOUT" || signal.type === "BREAKDOWN")) {
          filterRejects.sidewaysBreakout++;
          signal.action = "WAIT";
          signal.confidence = "LOW";
          signal.reasons = ["Sideways market — breakout signals suppressed"];
        }
      }

      // Bounce quality filter: reject overextended bounces
      if (signal.type === "BOUNCE" && signal.action !== "WAIT") {
        const bounceCandles = config.getSessionCandles?.(symbol) ?? [];

        if (bounceCandles.length >= 6) {
          const oldCandle = bounceCandles[Math.max(0, bounceCandles.length - 6)];
          const recentMove = Math.abs(q.lastPrice - oldCandle.close) / oldCandle.close;
          if (recentMove > BOUNCE_MAX_RECENT_MOVE) {
            filterRejects.bounceRejected++;
            signal.action = "WAIT";
            signal.confidence = "LOW";
            signal.reasons = [`Overextended — ${(recentMove * 100).toFixed(1)}% move in 30 min`];
          }
        }
      }

      // ── Market Awareness Filter (sector-based) ──
      if (signal.action !== "WAIT" && signal.type) {
        // Sector → Index mapping
        const SECTOR_MAP: Record<string, string> = {
          // Banking & Finance
          HDFCBANK: "NIFTY BANK", ICICIBANK: "NIFTY BANK", SBIN: "NIFTY BANK",
          KOTAKBANK: "NIFTY BANK", AXISBANK: "NIFTY BANK", PNB: "NIFTY BANK",
          BANKBARODA: "NIFTY BANK", INDUSINDBK: "NIFTY BANK", BANDHANBNK: "NIFTY BANK",
          FEDERALBNK: "NIFTY BANK", IDFCFIRSTB: "NIFTY BANK", RBLBANK: "NIFTY BANK",
          AUBANK: "NIFTY BANK", CANBK: "NIFTY BANK", UNIONBANK: "NIFTY BANK",
          BAJFINANCE: "NIFTY BANK", BAJAJFINSV: "NIFTY BANK", CHOLAFIN: "NIFTY BANK",
          MANAPPURAM: "NIFTY BANK", MUTHOOTFIN: "NIFTY BANK",
          // IT
          INFY: "NIFTY IT", TCS: "NIFTY IT", WIPRO: "NIFTY IT", HCLTECH: "NIFTY IT",
          TECHM: "NIFTY IT", LTIM: "NIFTY IT", MPHASIS: "NIFTY IT", COFORGE: "NIFTY IT",
          PERSISTENT: "NIFTY IT", TATAELXSI: "NIFTY IT",
        };

        const sectorIndex = SECTOR_MAP[symbol] ?? "NIFTY 50";
        const idxMom = config.getMomentum(sectorIndex);
        const idxPres = config.getPressure(sectorIndex);
        const idxCandles = config.getSessionCandles?.(sectorIndex) ?? [];

        // Only apply filter if we have reliable index data
        if (idxMom && idxPres && idxCandles.length >= 3) {
          const last3 = idxCandles.slice(-3);
          const bullishCount = last3.filter(c => c.close > c.open).length;
          const bearishCount = last3.filter(c => c.close < c.open).length;

          // Detect market mode
          const isStrongUp = idxMom.signal === "STRONG_UP";
          const isUp = idxMom.signal === "UP";
          const isStrongDown = idxMom.signal === "STRONG_DOWN";
          const isDown = idxMom.signal === "DOWN";
          const isBuyPres = idxPres.signal === "BUY" || idxPres.signal === "STRONG_BUY";
          const isSellPres = idxPres.signal === "SELL" || idxPres.signal === "STRONG_SELL";
          const isStrongBuyPres = idxPres.signal === "STRONG_BUY";
          const isStrongSellPres = idxPres.signal === "STRONG_SELL";

          let marketMode: "TREND_UP" | "TREND_DOWN" | "RANGE" = "RANGE";
          if ((isStrongUp || (isUp && isStrongBuyPres)) && isBuyPres && bullishCount >= 2) {
            marketMode = "TREND_UP";
          } else if ((isStrongDown || (isDown && isStrongSellPres)) && isSellPres && bearishCount >= 2) {
            marketMode = "TREND_DOWN";
          }

          // BREAKOUT: only in matching TREND_UP
          if (signal.type === "BREAKOUT" && signal.action === "BUY" && marketMode !== "TREND_UP") {
            signal.action = "WAIT";
            signal.confidence = "LOW";
            signal.reasons = [`Market ${marketMode} (${sectorIndex}) — BUY breakout needs TREND_UP`];
          }

          // BREAKDOWN: only in matching TREND_DOWN
          if (signal.type === "BREAKDOWN" && signal.action === "SELL" && marketMode !== "TREND_DOWN") {
            signal.action = "WAIT";
            signal.confidence = "LOW";
            signal.reasons = [`Market ${marketMode} (${sectorIndex}) — SELL breakdown needs TREND_DOWN`];
          }

          // REJECTION in TREND_UP: stricter quality (counter-trend)
          if (signal.type === "REJECTION" && signal.action === "SELL" && marketMode === "TREND_UP" && momentum) {
            if (Math.abs(momentum.quality) <= 0.7) {
              signal.action = "WAIT";
              signal.confidence = "LOW";
              signal.reasons = [`Counter-trend REJECTION in TREND_UP (${sectorIndex}) — quality ${Math.abs(momentum.quality).toFixed(2)} < 0.7`];
            }
          }

          // BOUNCE in TREND_DOWN: stricter quality (counter-trend)
          if (signal.type === "BOUNCE" && signal.action === "BUY" && marketMode === "TREND_DOWN" && momentum) {
            if (momentum.quality <= 0.7) {
              signal.action = "WAIT";
              signal.confidence = "LOW";
              signal.reasons = [`Counter-trend BOUNCE in TREND_DOWN (${sectorIndex}) — quality ${momentum.quality.toFixed(2)} < 0.7`];
            }
          }

          // Log market mode in reasons for debugging
          if (signal.action !== "WAIT") {
            signal.reasons.push(`Market: ${marketMode} (${sectorIndex})`);
          }
        }
        // If index data missing → skip filter entirely (don't assume RANGE)
      }

      const reaction = computeReaction(q.lastPrice, symbolSr, pressure);

      // ── CONTINUATION: indices only, when S/R signal returns WAIT ──
      const CONTINUATION_INDICES = new Set(["NIFTY 50", "NIFTY BANK", "SENSEX"]);
      if (signal.action === "WAIT" && CONTINUATION_INDICES.has(symbol) && momentum && pressure) {
        const sessionCandles2 = config.getSessionCandles?.(symbol) ?? [];

        // Gate 1: Distance safety — must be > 0.5% from BOTH S/R levels
        const supDist = symbolSr.supportZone ? (Math.abs(q.lastPrice - symbolSr.supportZone.level) / q.lastPrice * 100) : 999;
        const resDist = symbolSr.resistanceZone ? (Math.abs(q.lastPrice - symbolSr.resistanceZone.level) / q.lastPrice * 100) : 999;
        const safeDistance = supDist > 0.5 && resDist > 0.5;

        // Gate 2: Trend mode filter — 3 of last 5 candles aligned + last 2 same direction
        let trendConfirmed = false;
        if (sessionCandles2.length >= 5) {
          const last5 = sessionCandles2.slice(-5);
          const last2 = sessionCandles2.slice(-2);
          const bullishCount = last5.filter(c => c.close > c.open).length;
          const bearishCount = last5.filter(c => c.close < c.open).length;
          const last2Bullish = last2.every(c => c.close > c.open);
          const last2Bearish = last2.every(c => c.close < c.open);

          if ((bullishCount >= 3 && last2Bullish) || (bearishCount >= 3 && last2Bearish)) {
            trendConfirmed = true;
          }
        }

        // Gate 3-8: Momentum + Acceleration + Pressure + Quality
        const isBullishCont = momentum.signal === "UP" || momentum.signal === "STRONG_UP";
        const isBearishCont = momentum.signal === "DOWN" || momentum.signal === "STRONG_DOWN";
        const accConfirming = isBullishCont
          ? momentum.acceleration === "INCREASING"
          : momentum.acceleration === "DECREASING";
        const pressureAligned = isBullishCont
          ? (pressure.signal === "BUY" || pressure.signal === "STRONG_BUY")
          : (pressure.signal === "SELL" || pressure.signal === "STRONG_SELL");
        const confidenceOk = pressure.confidence >= 0.5;
        const qualityOk = isBullishCont
          ? momentum.quality > 0.6
          : Math.abs(momentum.quality) > 0.6;

        // Gate 9: Room to move — enough distance to next level in signal direction
        const roomToMove = isBullishCont
          ? resDist > 0.8  // BUY: resistance must be > 0.8% away
          : supDist > 0.8; // SELL: support must be > 0.8% away

        if (
          safeDistance &&
          trendConfirmed &&
          (isBullishCont || isBearishCont) &&
          accConfirming &&
          pressureAligned &&
          confidenceOk &&
          qualityOk &&
          roomToMove
        ) {
          const contAction = isBullishCont ? "BUY" : "SELL";
          const contReasons: string[] = [
            `${contAction === "BUY" ? "Bullish" : "Bearish"} trend continuation on ${symbol}`,
            `${momentum.signal} momentum (${momentum.acceleration}, quality: ${momentum.quality.toFixed(2)})`,
            `${pressure.signal} pressure (confidence: ${(pressure.confidence * 100).toFixed(0)}%)`,
            `Safe distance — support ${supDist.toFixed(1)}%, resistance ${resDist.toFixed(1)}% away`,
          ];

          // Dynamic boost
          const isVeryStrong =
            (momentum.signal === "STRONG_UP" || momentum.signal === "STRONG_DOWN") &&
            (pressure.signal === "STRONG_BUY" || pressure.signal === "STRONG_SELL") &&
            Math.abs(momentum.quality) > 0.8;
          const isStrong = qualityOk; // already checked > 0.6

          const contSignal: SignalResult = {
            action: contAction,
            type: "CONTINUATION",
            confidence: isVeryStrong ? "HIGH" : "MEDIUM",
            reasons: contReasons,
          };

          const { score: rawScore, breakdown: contBreakdown } = getScore(contSignal, pressure, momentum, pattern, symbolSr, q);
          const boost = isVeryStrong ? 1.5 : isStrong ? 1.0 : 0;
          const boostedScore = Math.min(isVeryStrong ? 9.5 : 8.5, rawScore + boost);
          const finalContScore = Math.round(boostedScore);

          setCacheEntry(symbol, contSignal, "CONFIRMED", reaction, finalContScore, contBreakdown);
          return;
        }
      }

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
      const fr = filterRejects;
      const totalFiltered = fr.globalDead + fr.lowRange + fr.slowMarket + fr.sidewaysBreakout + fr.bounceRejected;
      console.log(
        `[SignalWorker] Cycle: ${signalCache.size} cached, ${batchComputedCount} computed, ${batchSkippedCount} skipped | ` +
        `ACTIVITY: ${activity}, MOMENTUM: ${momentum}, PRESSURE: ${pressure}, CONFIRMED: ${confirmed} | ` +
        `BUY: ${buyCount}, SELL: ${sellCount} | score≥8: ${highScore}, score≥6: ${midScore}` +
        (totalFiltered > 0 ? ` | FILTERED: ${totalFiltered} (dead:${fr.globalDead} low:${fr.lowRange} slow:${fr.slowMarket} sideways:${fr.sidewaysBreakout} bounce:${fr.bounceRejected})` : "")
      );
      batchIndex = 0;
      batchComputedCount = 0;
      batchSkippedCount = 0;
      filterRejects = { globalDead: 0, lowRange: 0, slowMarket: 0, sidewaysBreakout: 0, bounceRejected: 0 };

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
