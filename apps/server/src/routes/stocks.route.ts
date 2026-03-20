import type { FastifyInstance } from "fastify";
import { KiteConnect } from "kiteconnect";
import type { WsManager } from "../ws/ws-server.js";
import type { InstrumentMaps, Candle, SupportResistanceResult } from "../lib/types.js";
import { getSupportResistance } from "../services/levels.service.js";
import { marketDataService } from "../services/market-data.service.js";

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
