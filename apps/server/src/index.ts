import "dotenv/config";
import { buildServer } from "./server.js";
import { loadInstruments, type MarketMode } from "./services/instrument.service.js";
import { createKiteTickerManager } from "./services/kite-ticker.service.js";
import { createWsManager, type WsManager } from "./ws/ws-server.js";
import { createBroadcastEngine } from "./services/broadcast.service.js";
import { createPressureEngine, type PressureEngine } from "./services/pressure.service.js";
import { loadSession } from "./lib/session-store.js";
import type { InstrumentMaps } from "./lib/types.js";

const PORT = Number(process.env.PORT) || 4002;

async function main() {
  const apiKey = process.env.KITE_API_KEY!;
  const apiSecret = process.env.KITE_API_SECRET!;

  if (!apiKey || !apiSecret) {
    throw new Error("KITE_API_KEY and KITE_API_SECRET must be set in environment");
  }

  const marketMode = (process.env.MARKET_MODE || "commodity") as MarketMode;

  // WsManager starts empty — symbols added after auth
  let wsManager: WsManager | null = null;
  let tickerDisconnect: (() => void) | null = null;
  let broadcastStop: (() => void) | null = null;

  // Exposed so the history route can use them
  let currentAccessToken: string | null = null;
  let currentInstrumentMaps: InstrumentMaps | null = null;
  let currentPressureEngine: PressureEngine | null = null;

  // Called after Kite login succeeds
  async function startMarketData(accessToken: string) {
    console.log(`Starting market data (mode: ${marketMode})...`);

    // Load instruments
    const instrumentMaps = await loadInstruments(apiKey, accessToken, marketMode);

    // Store for history route
    currentAccessToken = accessToken;
    currentInstrumentMaps = instrumentMaps;

    // Recreate WS manager with symbols
    if (wsManager) wsManager.close();
    wsManager = createWsManager({ symbols: instrumentMaps.symbols });
    wsManager.attach(server.server);

    // Create pressure engine
    const pressureEngine = createPressureEngine();
    currentPressureEngine = pressureEngine;

    // Start broadcast engine
    if (broadcastStop) broadcastStop();
    const broadcast = createBroadcastEngine({
      wsManager,
      intervalMs: 500,
      getPressure: (symbol) => pressureEngine.getPressure(symbol),
    });
    broadcast.start();
    broadcastStop = broadcast.stop;

    // Connect to Kite ticker
    if (tickerDisconnect) tickerDisconnect();
    const ticker = createKiteTickerManager({
      apiKey,
      accessToken,
      instrumentMaps,
      onTick: (symbol, quote) => {
        pressureEngine.processTick(symbol, {
          last_price: quote.lastPrice,
          volume: quote.volume,
          timestamp: quote.timestamp,
        });
      },
    });
    ticker.connect();
    tickerDisconnect = ticker.disconnect;

    console.log("Market data pipeline started");
  }

  // Try saved session first, then env variable
  const envAccessToken = loadSession() || process.env.KITE_ACCESS_TOKEN;

  // Build and start HTTP server (always starts, even without access token)
  const server = await buildServer({
    apiKey,
    apiSecret,
    onAccessToken: startMarketData,
    getWsManager: () => wsManager,
    getAccessToken: () => currentAccessToken,
    getInstrumentMaps: () => currentInstrumentMaps,
    getPressureEngine: () => currentPressureEngine,
  });

  await server.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`Server running on http://localhost:${PORT}`);

  // If we already have an access token from env, start immediately
  if (envAccessToken) {
    try {
      await startMarketData(envAccessToken);
    } catch (err) {
      console.error("Failed to start with env access token (may be expired):", err);
      console.log("Use the Kite login flow at http://localhost:${PORT}/api/auth/login");
    }
  } else {
    console.log(`No access token set. Login at: http://localhost:${PORT}/api/auth/login`);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received. Shutting down...`);
    if (broadcastStop) broadcastStop();
    if (tickerDisconnect) tickerDisconnect();
    if (wsManager) wsManager.close();
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
