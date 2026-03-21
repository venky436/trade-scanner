import "dotenv/config";
import { buildServer } from "./server.js";
import { loadInstruments, loadIndices, type MarketMode } from "./services/instrument.service.js";
import { createKiteTickerManager } from "./services/kite-ticker.service.js";
import { createWsManager, type WsManager } from "./ws/ws-server.js";
import { createBroadcastEngine } from "./services/broadcast.service.js";
import { createPressureEngine, type PressureEngine } from "./services/pressure.service.js";
import { createCandleTracker } from "./services/candle-tracker.service.js";
import { getMomentum } from "./lib/momentum-engine.js";
import { detectPattern } from "./lib/pattern-engine.js";
import { loadSession } from "./lib/session-store.js";
import type { InstrumentMaps, SupportResistanceResult, MomentumResult, PatternSignal } from "./lib/types.js";
import { marketDataService } from "./services/market-data.service.js";

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

  // Shared S/R levels cache (populated by HTTP endpoint, read by broadcast)
  let cachedLevels: Record<string, SupportResistanceResult> = {};

  // Called after Kite login succeeds
  async function startMarketData(accessToken: string) {
    console.log(`Starting market data (mode: ${marketMode})...`);

    // Load instruments (stocks + indices)
    const instrumentMaps = await loadInstruments(apiKey, accessToken, marketMode);

    // Load indices separately and merge into instrument maps
    if (marketMode === "equity") {
      const indexMaps = await loadIndices(apiKey, accessToken);
      for (const [token, symbol] of indexMaps.tokenToSymbol) {
        instrumentMaps.tokenToSymbol.set(token, symbol);
        instrumentMaps.symbolToToken.set(symbol, token);
        instrumentMaps.symbols.push(symbol);
      }
      console.log(`[equity] Total instruments (stocks + indices): ${instrumentMaps.symbols.length}`);
    }

    // Store for history route
    currentAccessToken = accessToken;
    currentInstrumentMaps = instrumentMaps;

    // Create pressure engine
    const pressureEngine = createPressureEngine();
    currentPressureEngine = pressureEngine;

    // In-memory maps for candle-driven analysis
    const momentumMap = new Map<string, MomentumResult>();
    const patternMap = new Map<string, PatternSignal>();

    // Recreate WS manager with symbols + engine getters (for snapshot)
    if (wsManager) wsManager.close();
    wsManager = createWsManager({
      symbols: instrumentMaps.symbols,
      getPressure: (symbol) => pressureEngine.getPressure(symbol),
      getLevels: () => cachedLevels,
      getMomentum: (symbol) => momentumMap.get(symbol) ?? null,
      getPattern: (symbol) => patternMap.get(symbol) ?? null,
    });
    wsManager.attach(server.server);

    // Create candle tracker (5-min candles from ticks)
    const candleTracker = createCandleTracker({
      onCandleClose: (symbol, candles) => {
        // Compute momentum
        const mom = getMomentum(candles);
        if (mom) momentumMap.set(symbol, mom);
        else momentumMap.delete(symbol);

        // Compute pattern (needs S/R + pressure)
        const sr = cachedLevels[symbol];
        const price = marketDataService.getQuote(symbol)?.lastPrice ?? 0;
        if (sr && price > 0) {
          const pat = detectPattern({
            candles: candles.slice(-3),
            currentPrice: price,
            supportZone: sr.supportZone,
            resistanceZone: sr.resistanceZone,
            pressure: pressureEngine.getPressure(symbol),
          });
          if (pat) patternMap.set(symbol, pat);
          else patternMap.delete(symbol);
        }
      },
    });

    // Start broadcast engine
    if (broadcastStop) broadcastStop();
    const broadcast = createBroadcastEngine({
      wsManager,
      intervalMs: 500,
      getPressure: (symbol) => pressureEngine.getPressure(symbol),
      getLevels: () => cachedLevels,
      getMomentum: (symbol) => momentumMap.get(symbol) ?? null,
      getPattern: (symbol) => patternMap.get(symbol) ?? null,
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
        candleTracker.processTick(symbol, quote.lastPrice, quote.volume, quote.timestamp);
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
    onLevelsComputed: (levels) => { cachedLevels = levels; },
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
