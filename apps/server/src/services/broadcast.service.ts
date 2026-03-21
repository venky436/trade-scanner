import type { WsManager } from "../ws/ws-server.js";
import type { StockSnapshot, WsMessage, PressureResult, SupportResistanceResult, MomentumResult, PatternSignal } from "../lib/types.js";
import { marketDataService } from "./market-data.service.js";
import { getSignal } from "../lib/signal-engine.js";

interface BroadcastConfig {
  wsManager: WsManager;
  intervalMs?: number;
  getPressure?: (symbol: string) => PressureResult | null;
  getLevels?: () => Record<string, SupportResistanceResult>;
  getMomentum?: (symbol: string) => MomentumResult | null;
  getPattern?: (symbol: string) => PatternSignal | null;
}

type ReactionValue = "APPROACHING" | "REJECTING" | "BREAKING";

const NEAR_THRESHOLD = 0.01;   // 1% — within reaction range

const REACTION_PRIORITY: Record<ReactionValue, number> = {
  BREAKING: 3,
  REJECTING: 2,
  APPROACHING: 1,
};

/**
 * Compute reaction for a single S/R level.
 *
 * - Position relative to level is the primary gate (S/R-aware).
 * - Price direction (prevPrice) is secondary — used to distinguish
 *   APPROACHING vs REJECTING when price is on the expected side.
 * - BREAKING requires price to have crossed the level AND confirming
 *   pressure from the pressure engine.
 */
function computeReactionForLevel(
  price: number,
  level: number,
  isResistance: boolean,
  prevPrice: number | undefined,
  pressure: PressureResult | undefined,
): ReactionValue | null {
  // Signed distance: positive = price on expected side of level
  //   resistance: expected side is below (price < level)
  //   support:    expected side is above (price > level)
  const dist = isResistance
    ? (level - price) / price   // positive when below resistance
    : (price - level) / price;  // positive when above support

  // Too far — no reaction
  if (Math.abs(dist) > NEAR_THRESHOLD) return null;

  // Price has crossed through the level (dist < 0)
  if (dist < 0) {
    const hasConfirmingPressure = isResistance
      ? pressure?.signal === "BUY" || pressure?.signal === "STRONG_BUY"
      : pressure?.signal === "SELL" || pressure?.signal === "STRONG_SELL";
    return hasConfirmingPressure ? "BREAKING" : "APPROACHING";
  }

  // Price is on expected side, within threshold
  if (prevPrice !== undefined) {
    const movingAway = isResistance
      ? price < prevPrice  // falling away from resistance
      : price > prevPrice; // rising away from support

    if (movingAway) return "REJECTING";
  }

  return "APPROACHING";
}

/**
 * Compute reaction from current price against cached S/R levels.
 *
 * Evaluates both support and resistance independently, then returns
 * the highest-priority reaction. This avoids the "nearest level only"
 * problem where a stock near both levels would miss one.
 */
function computeReaction(
  price: number,
  sr: SupportResistanceResult,
  prevPrice: number | undefined,
  pressure: PressureResult | undefined,
): ReactionValue | null {
  let supportReaction: ReactionValue | null = null;
  let resistanceReaction: ReactionValue | null = null;

  if (sr.support !== null) {
    supportReaction = computeReactionForLevel(price, sr.support, false, prevPrice, pressure);
  }

  if (sr.resistance !== null) {
    resistanceReaction = computeReactionForLevel(price, sr.resistance, true, prevPrice, pressure);
  }

  // Return highest priority reaction
  if (supportReaction && resistanceReaction) {
    return REACTION_PRIORITY[supportReaction] >= REACTION_PRIORITY[resistanceReaction]
      ? supportReaction
      : resistanceReaction;
  }

  return supportReaction ?? resistanceReaction;
}

export function createBroadcastEngine(config: BroadcastConfig) {
  const { wsManager, intervalMs = 500 } = config;
  let timer: ReturnType<typeof setInterval> | null = null;

  // Scoped to this engine instance — resets on startMarketData restart
  const prevPrices = new Map<string, number>();

  function tick() {
    // Skip if no clients connected
    if (wsManager.clientCount() === 0) return;

    // Get dirty symbols
    const dirty = marketDataService.getDirtySymbols();
    if (dirty.length === 0) return;

    // Build snapshots for only changed symbols
    const quotes = marketDataService.getAllQuotes();
    const sr = config.getLevels?.();
    const data: StockSnapshot[] = [];

    for (const symbol of dirty) {
      const q = quotes.get(symbol);
      if (!q) continue;

      const change = q.close !== 0 ? ((q.lastPrice - q.close) / q.close) * 100 : 0;
      const pressure = config.getPressure?.(symbol) ?? undefined;
      const reaction = sr?.[symbol]
        ? computeReaction(q.lastPrice, sr[symbol], prevPrices.get(symbol), pressure) ?? undefined
        : undefined;
      // Candle-driven — just read cached values, no recomputation
      const momentum = config.getMomentum?.(symbol) ?? undefined;
      const pattern = config.getPattern?.(symbol) ?? undefined;

      // Compute fresh distancePercent for signal engine
      const symbolSr = sr?.[symbol];
      const freshSr = symbolSr ? {
        supportZone: symbolSr.supportZone
          ? { level: symbolSr.supportZone.level, distancePercent: Math.abs(q.lastPrice - symbolSr.supportZone.level) / q.lastPrice * 100 }
          : null,
        resistanceZone: symbolSr.resistanceZone
          ? { level: symbolSr.resistanceZone.level, distancePercent: Math.abs(q.lastPrice - symbolSr.resistanceZone.level) / q.lastPrice * 100 }
          : null,
      } : undefined;

      const signalResult = freshSr
        ? getSignal({
            price: q.lastPrice,
            sr: freshSr,
            pressure: pressure ?? null,
            momentum: momentum ?? null,
            pattern: pattern ?? null,
          })
        : undefined;

      const signal = signalResult ?? undefined;

      prevPrices.set(symbol, q.lastPrice);

      data.push({
        symbol,
        price: q.lastPrice,
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: q.volume,
        change: Math.round(change * 100) / 100,
        timestamp: q.timestamp,
        pressure,
        reaction,
        momentum,
        pattern,
        signal,
      });
    }

    const msg: WsMessage = {
      type: "market_update",
      data,
      timestamp: Date.now(),
    };

    wsManager.broadcast(msg);
    marketDataService.clearDirty();
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(tick, intervalMs);
      timer.unref();
      console.log(`Broadcast engine started (${intervalMs}ms interval)`);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        console.log("Broadcast engine stopped");
      }
    },
  };
}
