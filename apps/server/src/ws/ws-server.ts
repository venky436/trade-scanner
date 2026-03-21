import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import type { StockSnapshot, WsMessage, PressureResult, SupportResistanceResult, MomentumResult, PatternSignal } from "../lib/types.js";
import { marketDataService } from "../services/market-data.service.js";
import { getSignal } from "../lib/signal-engine.js";

interface WsManagerConfig {
  symbols: string[];
  getPressure?: (symbol: string) => PressureResult | null;
  getLevels?: () => Record<string, SupportResistanceResult>;
  getMomentum?: (symbol: string) => MomentumResult | null;
  getPattern?: (symbol: string) => PatternSignal | null;
}

export function createWsManager(config: WsManagerConfig) {
  const { symbols } = config;
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();
  let pingInterval: ReturnType<typeof setInterval> | null = null;

  function buildSnapshot(): StockSnapshot[] {
    const quotes = marketDataService.getAllQuotes();
    const sr = config.getLevels?.();
    const snapshots: StockSnapshot[] = [];

    for (const symbol of symbols) {
      const q = quotes.get(symbol);
      if (!q) continue;

      const change = q.close !== 0 ? ((q.lastPrice - q.close) / q.close) * 100 : 0;
      const pressure = config.getPressure?.(symbol) ?? undefined;
      const momentum = config.getMomentum?.(symbol) ?? undefined;
      const pattern = config.getPattern?.(symbol) ?? undefined;

      // Compute signal if S/R levels exist
      const symbolSr = sr?.[symbol];
      const freshSr = symbolSr ? {
        supportZone: symbolSr.supportZone
          ? { level: symbolSr.supportZone.level, distancePercent: Math.abs(q.lastPrice - symbolSr.supportZone.level) / q.lastPrice * 100 }
          : null,
        resistanceZone: symbolSr.resistanceZone
          ? { level: symbolSr.resistanceZone.level, distancePercent: Math.abs(q.lastPrice - symbolSr.resistanceZone.level) / q.lastPrice * 100 }
          : null,
      } : undefined;

      const signal = freshSr
        ? getSignal({
            price: q.lastPrice,
            sr: freshSr,
            pressure: pressure ?? null,
            momentum: momentum ?? null,
            pattern: pattern ?? null,
          })
        : undefined;

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
        pressure,
        momentum,
        pattern,
        signal,
      });
    }

    return snapshots;
  }

  function handleConnection(ws: WebSocket) {
    clients.add(ws);
    console.log(`WS client connected. Total: ${clients.size}`);

    // Send snapshot immediately
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

    // Respond to pings from client
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
