import type { FastifyInstance } from "fastify";
import { KiteConnect } from "kiteconnect";
import type { WsManager } from "../ws/ws-server.js";
import type { InstrumentMaps, Candle } from "../lib/types.js";

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

      const formatDate = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;

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
