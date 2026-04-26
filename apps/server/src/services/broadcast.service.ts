import type { WsManager } from "../ws/ws-server.js";
import type {
  Candle,
  IntelligenceSnapshot,
  IntelligenceWsMessage,
  MarketContext,
  MomentumResult,
  PressureResult,
  SupportResistanceResult,
} from "../lib/types.js";
import { marketDataService } from "./market-data.service.js";
import { buildMarketContext, toIntelligence } from "../lib/intelligence-transformer.js";

interface BroadcastConfig {
  wsManager: WsManager;
  intervalMs?: number;
  maxPerBroadcast?: number;
  getPressure?: (symbol: string) => PressureResult | null;
  getMomentum?: (symbol: string) => MomentumResult | null;
  getLevels?: (symbol: string) => SupportResistanceResult | null;
  getRecentCandles?: (symbol: string) => Candle[];
  getEligibleSymbols?: () => string[];
  onIntelligenceComputed?: (symbol: string, intel: IntelligenceSnapshot, price: number) => void;
}

const NIFTY_SYMBOL = "NIFTY 50";
const BANK_NIFTY_SYMBOL = "NIFTY BANK";

export function createBroadcastEngine(config: BroadcastConfig) {
  const { wsManager, intervalMs = 500, maxPerBroadcast = 150 } = config;
  let timer: ReturnType<typeof setInterval> | null = null;
  let broadcastCount = 0;
  let totalSent = 0;

  function computeMarketContext(): MarketContext {
    const nifty = marketDataService.getQuote(NIFTY_SYMBOL);
    const bankNifty = marketDataService.getQuote(BANK_NIFTY_SYMBOL);
    return buildMarketContext(
      nifty ? { lastPrice: nifty.lastPrice, close: nifty.close } : null,
      bankNifty ? { lastPrice: bankNifty.lastPrice, close: bankNifty.close } : null,
    );
  }

  function tick() {
    const dirty = marketDataService.getDirtySymbols();
    if (dirty.length === 0) return;

    const hasClients = wsManager.clientCount() > 0;
    const quotes = marketDataService.getAllQuotes();
    const eligibleSet = new Set(config.getEligibleSymbols?.() ?? []);

    // Sort dirty symbols by confidence after transform so the top N are highest-conviction.
    const candidates: IntelligenceSnapshot[] = [];

    for (const symbol of dirty) {
      const q = quotes.get(symbol);
      if (!q) continue;
      if (eligibleSet.size > 0 && !eligibleSet.has(symbol)) continue;

      const intel = toIntelligence({
        symbol,
        price: q.lastPrice,
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        timestamp: q.timestamp,
        pressure: config.getPressure?.(symbol) ?? null,
        momentum: config.getMomentum?.(symbol) ?? null,
        sr: config.getLevels?.(symbol) ?? null,
        recentCandles: config.getRecentCandles?.(symbol),
      });
      if (hasClients) candidates.push(intel);

      // Fire tracking hook regardless of WS clients — server-driven recording
      // must continue when no browsers are connected.
      config.onIntelligenceComputed?.(symbol, intel, q.lastPrice);
    }

    if (!hasClients) {
      marketDataService.clearDirty();
      return;
    }

    // Highest confidence first, then stocks with clearest outlook
    candidates.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      const aActionable = a.context.zone !== "MID_RANGE" ? 1 : 0;
      const bActionable = b.context.zone !== "MID_RANGE" ? 1 : 0;
      return bActionable - aActionable;
    });

    const selected = candidates.slice(0, maxPerBroadcast);

    const msg: IntelligenceWsMessage = {
      type: "market_update",
      data: selected,
      market: computeMarketContext(),
      timestamp: Date.now(),
    };

    wsManager.broadcast(msg);
    marketDataService.clearDirty();

    broadcastCount++;
    totalSent += selected.length;

    if (broadcastCount % 60 === 0) {
      console.log(
        `[Broadcast] ${broadcastCount} ticks, avg ${Math.round(totalSent / broadcastCount)} symbols/tick, ${wsManager.clientCount()} clients`,
      );
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(tick, intervalMs);
      timer.unref();
      console.log(`Broadcast engine started (${intervalMs}ms interval, max ${maxPerBroadcast}/tick)`);
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
