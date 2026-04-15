import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import type {
  IntelligenceSnapshot,
  IntelligenceWsMessage,
  MomentumResult,
  PressureResult,
  SupportResistanceResult,
} from "../lib/types.js";
import { marketDataService } from "../services/market-data.service.js";
import { buildMarketContext, toIntelligence } from "../lib/intelligence-transformer.js";

interface WsManagerConfig {
  symbols: string[];
  getPressure?: (symbol: string) => PressureResult | null;
  getMomentum?: (symbol: string) => MomentumResult | null;
  getLevels?: (symbol: string) => SupportResistanceResult | null;
  getEligibleSymbols?: () => string[];
}

const NIFTY_SYMBOL = "NIFTY 50";
const BANK_NIFTY_SYMBOL = "NIFTY BANK";

export function createWsManager(config: WsManagerConfig) {
  const { symbols } = config;
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();
  let pingInterval: ReturnType<typeof setInterval> | null = null;

  function buildSnapshot(): IntelligenceSnapshot[] {
    const quotes = marketDataService.getAllQuotes();
    const snapshots: IntelligenceSnapshot[] = [];

    let symbolList = config.getEligibleSymbols?.() ?? symbols;
    if (symbolList.length < 50) symbolList = symbols;

    for (const symbol of symbolList) {
      const q = quotes.get(symbol);
      if (!q) continue;

      snapshots.push(
        toIntelligence({
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
        }),
      );
    }

    // Confidence-first ordering so the initial snapshot already highlights actionable stocks.
    snapshots.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      const aActionable = a.context.zone !== "MID_RANGE" ? 1 : 0;
      const bActionable = b.context.zone !== "MID_RANGE" ? 1 : 0;
      return bActionable - aActionable;
    });

    return snapshots;
  }

  function buildMarketContextSnapshot() {
    const nifty = marketDataService.getQuote(NIFTY_SYMBOL);
    const bankNifty = marketDataService.getQuote(BANK_NIFTY_SYMBOL);
    return buildMarketContext(
      nifty ? { lastPrice: nifty.lastPrice, close: nifty.close } : null,
      bankNifty ? { lastPrice: bankNifty.lastPrice, close: bankNifty.close } : null,
    );
  }

  function handleConnection(ws: WebSocket) {
    clients.add(ws);
    console.log(`WS client connected. Total: ${clients.size}`);

    const snapshot: IntelligenceWsMessage = {
      type: "snapshot",
      data: buildSnapshot(),
      market: buildMarketContextSnapshot(),
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

    broadcast(msg: IntelligenceWsMessage) {
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
    buildMarketContextSnapshot,

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
