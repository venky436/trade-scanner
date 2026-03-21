import type { WsManager } from "../ws/ws-server.js";
import type { StockSnapshot, WsMessage, SignalSnapshot, SignalStage, PressureResult, MomentumResult, PatternSignal } from "../lib/types.js";
import { marketDataService } from "./market-data.service.js";

const STAGE_RANK: Record<SignalStage, number> = { ACTIVITY: 1, MOMENTUM: 2, PRESSURE: 3, CONFIRMED: 4 };
const CONF_RANK: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

interface BroadcastConfig {
  wsManager: WsManager;
  intervalMs?: number;
  maxPerBroadcast?: number;
  getPressure?: (symbol: string) => PressureResult | null;
  getMomentum?: (symbol: string) => MomentumResult | null;
  getPattern?: (symbol: string) => PatternSignal | null;
  getSignalSnapshot?: (symbol: string) => SignalSnapshot | null;
  getEligibleSymbols?: () => string[];
}

export function createBroadcastEngine(config: BroadcastConfig) {
  const { wsManager, intervalMs = 500, maxPerBroadcast = 150 } = config;
  let timer: ReturnType<typeof setInterval> | null = null;
  let broadcastCount = 0;
  let totalSent = 0;

  function tick() {
    if (wsManager.clientCount() === 0) return;

    const dirty = marketDataService.getDirtySymbols();
    if (dirty.length === 0) return;

    const quotes = marketDataService.getAllQuotes();

    // Filter to eligible stocks only (+ always include BUY/SELL signals)
    const eligibleSet = new Set(config.getEligibleSymbols?.() ?? []);
    const signalSymbols: string[] = [];
    const otherSymbols: string[] = [];

    for (const symbol of dirty) {
      const cached = config.getSignalSnapshot?.(symbol);
      // Always include stocks with active BUY/SELL signals
      if (cached && cached.signal.action !== "WAIT") {
        signalSymbols.push(symbol);
      } else if (eligibleSet.size === 0 || eligibleSet.has(symbol)) {
        otherSymbols.push(symbol);
      }
    }

    // Sort signal symbols by stage (CONFIRMED first) then confidence
    signalSymbols.sort((a, b) => {
      const sa = config.getSignalSnapshot?.(a);
      const sb = config.getSignalSnapshot?.(b);
      const stageA = sa?.stage ? STAGE_RANK[sa.stage] : 0;
      const stageB = sb?.stage ? STAGE_RANK[sb.stage] : 0;
      if (stageB !== stageA) return stageB - stageA;
      const confA = CONF_RANK[sa?.signal.confidence ?? "LOW"] ?? 0;
      const confB = CONF_RANK[sb?.signal.confidence ?? "LOW"] ?? 0;
      return confB - confA;
    });

    const selected = [
      ...signalSymbols,
      ...otherSymbols.slice(0, Math.max(0, maxPerBroadcast - signalSymbols.length)),
    ];

    // Build snapshots — ALL reads from caches, NO computation
    const data: StockSnapshot[] = [];

    for (const symbol of selected) {
      const q = quotes.get(symbol);
      if (!q) continue;

      const change = q.close !== 0 ? ((q.lastPrice - q.close) / q.close) * 100 : 0;
      const cached = config.getSignalSnapshot?.(symbol);

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
        pressure: config.getPressure?.(symbol) ?? undefined,
        reaction: cached?.reaction ?? undefined,
        momentum: config.getMomentum?.(symbol) ?? undefined,
        pattern: config.getPattern?.(symbol) ?? undefined,
        signal: cached?.signal ?? undefined,
      });
    }

    const msg: WsMessage = {
      type: "market_update",
      data,
      timestamp: Date.now(),
    };

    wsManager.broadcast(msg);
    marketDataService.clearDirty();

    broadcastCount++;
    totalSent += data.length;

    // Log every 60 broadcasts (~30s at 500ms interval)
    if (broadcastCount % 60 === 0) {
      console.log(`[Broadcast] ${broadcastCount} ticks, avg ${Math.round(totalSent / broadcastCount)} symbols/tick, ${wsManager.clientCount()} clients`);
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
