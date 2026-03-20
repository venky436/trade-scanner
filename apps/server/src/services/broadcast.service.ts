import type { WsManager } from "../ws/ws-server.js";
import type { StockSnapshot, WsMessage } from "../lib/types.js";
import { marketDataService } from "./market-data.service.js";

interface BroadcastConfig {
  wsManager: WsManager;
  intervalMs?: number;
}

export function createBroadcastEngine(config: BroadcastConfig) {
  const { wsManager, intervalMs = 500 } = config;
  let timer: ReturnType<typeof setInterval> | null = null;

  function tick() {
    // Skip if no clients connected
    if (wsManager.clientCount() === 0) return;

    // Get dirty symbols
    const dirty = marketDataService.getDirtySymbols();
    if (dirty.length === 0) return;

    // Build snapshots for only changed symbols
    const quotes = marketDataService.getAllQuotes();
    const data: StockSnapshot[] = [];

    for (const symbol of dirty) {
      const q = quotes.get(symbol);
      if (!q) continue;

      const change = q.close !== 0 ? ((q.lastPrice - q.close) / q.close) * 100 : 0;
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
