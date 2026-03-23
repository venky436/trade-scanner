import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import type { StockSnapshot, WsMessage, SignalSnapshot, PressureResult, MomentumResult, PatternSignal } from "../lib/types.js";
import { marketDataService } from "../services/market-data.service.js";

interface WsManagerConfig {
  symbols: string[];
  getPressure?: (symbol: string) => PressureResult | null;
  getMomentum?: (symbol: string) => MomentumResult | null;
  getPattern?: (symbol: string) => PatternSignal | null;
  getSignalSnapshot?: (symbol: string) => SignalSnapshot | null;
  getEligibleSymbols?: () => string[];
}

const FALLBACK_SIGNAL = { action: "WAIT" as const, confidence: "LOW" as const, reasons: ["Loading..."] };

export function createWsManager(config: WsManagerConfig) {
  const { symbols } = config;
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();
  let pingInterval: ReturnType<typeof setInterval> | null = null;

  function buildSnapshot(): StockSnapshot[] {
    const quotes = marketDataService.getAllQuotes();
    const snapshots: StockSnapshot[] = [];

    // Send eligible stocks, fallback to all symbols when market closed (few eligible)
    let symbolList = config.getEligibleSymbols?.() ?? symbols;
    if (symbolList.length < 50) symbolList = symbols;
    for (const symbol of symbolList) {
      const q = quotes.get(symbol);
      if (!q) continue;

      const change = q.close !== 0 ? ((q.lastPrice - q.close) / q.close) * 100 : 0;
      const cached = config.getSignalSnapshot?.(symbol);

      snapshots.push({
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
        momentum: config.getMomentum?.(symbol) ?? undefined,
        pattern: config.getPattern?.(symbol) ?? undefined,
        reaction: cached?.reaction ?? undefined,
        signal: cached?.signal ?? FALLBACK_SIGNAL,
      });
    }

    return snapshots;
  }

  function handleConnection(ws: WebSocket) {
    clients.add(ws);
    console.log(`WS client connected. Total: ${clients.size}`);

    const snapshot: WsMessage = {
      type: "snapshot",
      data: buildSnapshot(),
      timestamp: Date.now(),
    };
    ws.send(JSON.stringify(snapshot));

    ws.on("close", () => {
      clients.delete(ws);
      console.log(`WS client disconnected. Total: ${clients.size}`);
    });

    ws.on("error", (err) => {
      console.error("WS client error:", err.message);
      clients.delete(ws);
    });

    ws.on("pong", () => {
      (ws as any).__alive = true;
    });
  }

  function startPingInterval() {
    pingInterval = setInterval(() => {
      for (const ws of clients) {
        if ((ws as any).__alive === false) {
          ws.terminate();
          clients.delete(ws);
          continue;
        }
        (ws as any).__alive = false;
        ws.ping();
      }
    }, 30_000);
    pingInterval.unref();
  }

  return {
    attach(httpServer: Server) {
      httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
        const url = new URL(req.url || "/", `http://${req.headers.host}`);
        if (url.pathname !== "/ws") {
          socket.destroy();
          return;
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
          (ws as any).__alive = true;
          handleConnection(ws);
        });
      });

      startPingInterval();
      console.log("WebSocket server attached on /ws");
    },

    broadcast(msg: WsMessage) {
      const data = JSON.stringify(msg);
      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      }
    },

    clientCount() {
      return clients.size;
    },

    buildSnapshot,

    close() {
      if (pingInterval) clearInterval(pingInterval);
      for (const ws of clients) {
        ws.close();
      }
      clients.clear();
      wss.close();
    },
  };
}

export type WsManager = ReturnType<typeof createWsManager>;
