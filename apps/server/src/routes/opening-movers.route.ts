// GET /api/sections/opening-movers — today's BUY / SELL list from the first
// 5-min candle, 09:15 (services/opening-movers.service.ts). Display only.
// Adds the live price (and the move since the 09:20 signal) for the cards.
import type { FastifyInstance } from "fastify";
import { marketDataService } from "../services/market-data.service.js";
import type { OpeningMoversState } from "../services/opening-movers.service.js";

export async function openingMoversRoute(fastify: FastifyInstance, opts: { getState: () => OpeningMoversState | null }) {
  fastify.get("/api/sections/opening-movers", async () => {
    const s = opts.getState();
    if (!s) return { status: "WAITING_LOGIN", stocks: [] };
    return {
      ...s,
      stocks: s.stocks.map((m) => {
        const ltp = marketDataService.getQuote(m.symbol)?.lastPrice ?? null;
        const sinceSignalPct = ltp && m.c1.close > 0 ? Math.round(((ltp - m.c1.close) / m.c1.close) * 10_000) / 100 : null;
        return { ...m, ltp, sinceSignalPct };
      }),
    };
  });
}
