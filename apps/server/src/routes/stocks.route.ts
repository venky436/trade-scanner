import type { FastifyInstance } from "fastify";
import { KiteConnect } from "kiteconnect";
import type { WsManager } from "../ws/ws-server.js";
import type { InstrumentMaps, Candle, SupportResistanceResult, PatternSignal, MomentumResult } from "../lib/types.js";
import { getSupportResistance } from "../services/levels.service.js";
import { marketDataService } from "../services/market-data.service.js";
import type { PressureEngine } from "../services/pressure.service.js";
import { detectPattern } from "../lib/pattern-engine.js";
import { getMomentum } from "../lib/momentum-engine.js";

const VALID_INTERVALS = [
  "minute",
  "3minute",
  "5minute",
  "15minute",
  "30minute",
  "60minute",
  "day",
] as const;
type KiteInterval = (typeof VALID_INTERVALS)[number];

interface StocksRouteOpts {
  apiKey: string;
  getWsManager: () => WsManager | null;
  getAccessToken: () => string | null;
  getInstrumentMaps: () => InstrumentMaps | null;
  getPressureEngine: () => PressureEngine | null;
}

const formatDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;

// Cache for S/R levels (daily candles don't change intraday)
let levelsCache: {
  levels: Record<string, SupportResistanceResult>;
  timestamp: number;
} | null = null;
const LEVELS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export async function stocksRoute(
  fastify: FastifyInstance,
  opts: StocksRouteOpts
) {
  fastify.get("/api/stocks", async () => {
    const wsManager = opts.getWsManager();
    if (!wsManager) {
      return { count: 0, data: [], timestamp: Date.now(), status: "not_connected" };
    }
    const data = wsManager.buildSnapshot();
    return { count: data.length, data, timestamp: Date.now() };
  });

  // --- S/R Levels for all stocks ---
  fastify.get("/api/stocks/levels", async (_req, reply) => {
    const accessToken = opts.getAccessToken();
    const instrumentMaps = opts.getInstrumentMaps();

    if (!accessToken || !instrumentMaps) {
      return reply
        .status(503)
        .send({ error: "Market data not initialized. Login to Kite first." });
    }

    // Return cache if fresh
    if (levelsCache && Date.now() - levelsCache.timestamp < LEVELS_CACHE_TTL) {
      return { levels: levelsCache.levels, timestamp: levelsCache.timestamp };
    }

    const kc = new KiteConnect({ api_key: opts.apiKey });
    kc.setAccessToken(accessToken);

    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 15); // ~10 trading days

    const levels: Record<string, SupportResistanceResult> = {};
    const symbols = instrumentMaps.symbols;

    fastify.log.info(`[SR] Computing levels for ${symbols.length} symbols...`);

    // Batch in groups of 5 to avoid Kite rate limits
    const BATCH_SIZE = 5;
    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);
      const promises = batch.map(async (symbol) => {
        const token = instrumentMaps.symbolToToken.get(symbol);
        if (token === undefined) return;

        try {
          const data = await kc.getHistoricalData(
            token,
            "day" as KiteInterval,
            formatDate(from),
            formatDate(to),
          );

          const candles: Candle[] = data.map((d: any) => ({
            time: Math.floor(new Date(d.date).getTime() / 1000),
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
            volume: d.volume,
          }));

          const quote = marketDataService.getQuote(symbol);
          const price =
            quote?.lastPrice ||
            (candles.length > 0 ? candles[candles.length - 1].close : 0);

          if (price > 0 && candles.length >= 2) {
            levels[symbol] = getSupportResistance(candles, price);
          }
        } catch (err: any) {
          fastify.log.warn(`[SR] Failed for ${symbol}: ${err.message}`);
        }
      });
      await Promise.allSettled(promises);
    }

    fastify.log.info(`[SR] Computed levels for ${Object.keys(levels).length}/${symbols.length} symbols`);

    levelsCache = { levels, timestamp: Date.now() };
    return { levels, timestamp: levelsCache.timestamp };
  });

  // --- Candlestick Patterns + Momentum for near-S/R symbols ---
  let patternsCache: {
    patterns: Record<string, PatternSignal>;
    momentum: Record<string, MomentumResult>;
    timestamp: number;
  } | null = null;
  const PATTERNS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  fastify.get("/api/stocks/patterns", async (_req, reply) => {
    const accessToken = opts.getAccessToken();
    const instrumentMaps = opts.getInstrumentMaps();

    if (!accessToken || !instrumentMaps) {
      return reply
        .status(503)
        .send({ error: "Market data not initialized. Login to Kite first." });
    }

    // Depend on levelsCache — if S/R levels not computed yet, return empty
    if (!levelsCache) {
      return { patterns: {}, timestamp: Date.now() };
    }

    // Return cache if fresh
    if (patternsCache && Date.now() - patternsCache.timestamp < PATTERNS_CACHE_TTL) {
      return { patterns: patternsCache.patterns, momentum: patternsCache.momentum, timestamp: patternsCache.timestamp };
    }

    const pressureEngine = opts.getPressureEngine();

    // Filter to symbols within 0.5% of support or resistance
    const PROXIMITY = 0.005;
    const nearSymbols: string[] = [];
    for (const [symbol, sr] of Object.entries(levelsCache.levels)) {
      const quote = marketDataService.getQuote(symbol);
      const price = quote?.lastPrice;
      if (!price || price <= 0) continue;

      const nearSupport = sr.support !== null && Math.abs(price - sr.support) / price <= PROXIMITY;
      const nearResistance = sr.resistance !== null && Math.abs(price - sr.resistance!) / price <= PROXIMITY;
      if (nearSupport || nearResistance) {
        nearSymbols.push(symbol);
      }
    }

    if (nearSymbols.length === 0) {
      patternsCache = { patterns: {}, momentum: {}, timestamp: Date.now() };
      return { patterns: {}, momentum: {}, timestamp: patternsCache.timestamp };
    }

    fastify.log.info(`[Pattern] Scanning ${nearSymbols.length} near-S/R symbols`);

    const kc = new KiteConnect({ api_key: opts.apiKey });
    kc.setAccessToken(accessToken);

    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 1); // 1 day of 5-min candles
    from.setHours(0, 0, 0, 0);

    const patterns: Record<string, PatternSignal> = {};
    const momentumMap: Record<string, MomentumResult> = {};

    // Batch in groups of 5
    const BATCH_SIZE = 5;
    for (let i = 0; i < nearSymbols.length; i += BATCH_SIZE) {
      const batch = nearSymbols.slice(i, i + BATCH_SIZE);
      const promises = batch.map(async (symbol) => {
        const token = instrumentMaps.symbolToToken.get(symbol);
        if (token === undefined) return;

        try {
          const data = await kc.getHistoricalData(
            token,
            "5minute" as KiteInterval,
            formatDate(from),
            formatDate(to),
          );

          const candles: Candle[] = data.map((d: any) => ({
            time: Math.floor(new Date(d.date).getTime() / 1000),
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
            volume: d.volume,
          }));

          // Take last 3 candles
          const last3 = candles.slice(-3);
          if (last3.length === 0) return;

          const quote = marketDataService.getQuote(symbol);
          const price = quote?.lastPrice ?? last3[last3.length - 1].close;
          const sr = levelsCache!.levels[symbol];
          if (!sr) return;

          const result = detectPattern({
            candles: last3,
            currentPrice: price,
            supportZone: sr.supportZone,
            resistanceZone: sr.resistanceZone,
            pressure: pressureEngine?.getPressure(symbol) ?? null,
          });

          if (result) {
            patterns[symbol] = result;
          }

          // Compute momentum from the same candles
          const mom = getMomentum(candles);
          if (mom) {
            momentumMap[symbol] = mom;
          }
        } catch (err: any) {
          fastify.log.warn(`[Pattern] Failed for ${symbol}: ${err.message}`);
        }
      });
      await Promise.allSettled(promises);
    }

    fastify.log.info(`[Pattern] Detected ${Object.keys(patterns).length} patterns, ${Object.keys(momentumMap).length} momentum from ${nearSymbols.length} symbols`);

    patternsCache = { patterns, momentum: momentumMap, timestamp: Date.now() };
    return { patterns, momentum: momentumMap, timestamp: patternsCache.timestamp };
  });

  fastify.get("/api/stocks/pressure/debug", async (_req, reply) => {
    const engine = opts.getPressureEngine();
    if (!engine) {
      return reply.status(503).send({ error: "Pressure engine not initialized" });
    }
    return { stats: engine.getStats(), timestamp: Date.now() };
  });

  fastify.get("/api/stocks/pressure", async (_req, reply) => {
    const engine = opts.getPressureEngine();
    if (!engine) {
      return reply.status(503).send({ error: "Pressure engine not initialized" });
    }
    return { pressure: engine.getAllPressure(), timestamp: Date.now() };
  });

  fastify.get<{
    Params: { symbol: string };
    Querystring: { interval?: string; days?: string };
  }>("/api/stocks/:symbol/history", async (req, reply) => {
    const accessToken = opts.getAccessToken();
    const instrumentMaps = opts.getInstrumentMaps();

    if (!accessToken || !instrumentMaps) {
      return reply
        .status(503)
        .send({ error: "Market data not initialized. Login to Kite first." });
    }

    const { symbol } = req.params;
    const interval = (req.query.interval || "minute") as string;
    const days = Math.min(Math.max(Number(req.query.days) || 1, 1), 365);

    if (!VALID_INTERVALS.includes(interval as KiteInterval)) {
      return reply
        .status(400)
        .send({ error: `Invalid interval. Valid: ${VALID_INTERVALS.join(", ")}` });
    }

    const instrumentToken = instrumentMaps.symbolToToken.get(symbol);
    if (instrumentToken === undefined) {
      return reply.status(404).send({ error: `Symbol ${symbol} not found` });
    }

    try {
      const kc = new KiteConnect({ api_key: opts.apiKey });
      kc.setAccessToken(accessToken);

      const to = new Date();
      const from = new Date();
      if (interval === "day") {
        from.setDate(from.getDate() - days);
      } else {
        // For intraday, go back `days` trading days
        from.setDate(from.getDate() - days);
        from.setHours(0, 0, 0, 0);
      }

      const data = await kc.getHistoricalData(
        instrumentToken,
        interval as KiteInterval,
        formatDate(from),
        formatDate(to)
      );

      const candles: Candle[] = data.map((d: any) => ({
        time: Math.floor(new Date(d.date).getTime() / 1000),
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        volume: d.volume,
      }));

      return { symbol, interval, candles };
    } catch (err: any) {
      fastify.log.error(err, `Failed to fetch history for ${symbol}`);
      return reply
        .status(500)
        .send({ error: "Failed to fetch historical data", detail: err.message });
    }
  });
}
