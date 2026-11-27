// GET /api/sections/smart-zones — today's Fair Value Gaps and Order Blocks
// (services/smart-zones.service.ts). Display only. Adds the live price and how
// far it is from each zone's entry.
import type { FastifyInstance } from "fastify";
import { marketDataService } from "../services/market-data.service.js";
import type { SmartZonesState } from "../services/smart-zones.service.js";

export async function smartZonesRoute(fastify: FastifyInstance, opts: { getState: () => SmartZonesState | null }) {
  fastify.get("/api/sections/smart-zones", async () => {
    const s = opts.getState();
    if (!s) return { status: "WAITING_LOGIN", zones: [] };
    return {
      ...s,
      zones: s.zones.map((z) => {
        const ltp = marketDataService.getQuote(z.symbol)?.lastPrice ?? null;
        const toEntryPct = ltp && z.entry > 0 ? Math.round(((ltp - z.entry) / z.entry) * 10_000) / 100 : null;
        return { ...z, ltp, toEntryPct };
      }),
    };
  });
}
