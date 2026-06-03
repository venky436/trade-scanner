import type { FastifyInstance } from "fastify";
import { marketDataService } from "../services/market-data.service.js";
import { toIntelligence } from "../lib/intelligence-transformer.js";
import {
  selectNearSupport,
  selectNearResistance,
  selectStrongAlignment,
  ZONE_SECTION_CAP,
  ZONE_SECTION_CONF_FLOOR,
  STRONG_ALIGNMENT_CAP,
  STRONG_ALIGNMENT_FLOOR,
} from "../lib/section-selector.js";
import { isIndexSymbol } from "../lib/index-symbols.js";
import type {
  IntelligenceSnapshot,
  SupportResistanceResult,
  PressureResult,
  MomentumResult,
  Candle,
} from "../lib/types.js";

interface SectionsRouteDeps {
  getCachedLevels: () => Record<string, SupportResistanceResult>;
  getPressure: (symbol: string) => PressureResult | null;
  getMomentum: (symbol: string) => MomentumResult | null;
  getRecentCandles: (symbol: string, n: number) => Candle[];
  getAllSymbols: () => string[];
}

// Public sections endpoint — single source of truth for which stocks appear
// in which dashboard lane. Frontend polls this; AI scheduler uses the same
// selection logic internally. Changing one constant in section-selector.ts
// updates BOTH the cards the user sees and the stocks the AI evaluates.
//
// No auth required — same access bar as the WebSocket which is also public.
export async function sectionsRoute(fastify: FastifyInstance, deps: SectionsRouteDeps) {
  fastify.get("/api/sections", async () => {
    const symbols = deps.getAllSymbols();
    const pool: IntelligenceSnapshot[] = [];
    for (const sym of symbols) {
      if (isIndexSymbol(sym)) continue;
      const quote = marketDataService.getQuote(sym);
      if (!quote || quote.lastPrice <= 0) continue;
      const sr = deps.getCachedLevels()[sym] ?? null;
      const intel = toIntelligence({
        symbol: sym,
        price: quote.lastPrice,
        open: quote.open,
        high: quote.high,
        low: quote.low,
        close: quote.close,
        timestamp: quote.timestamp,
        pressure: deps.getPressure(sym),
        momentum: deps.getMomentum(sym),
        sr,
        recentCandles: deps.getRecentCandles(sym, 24),
      });
      pool.push(intel);
    }
    return {
      nearSupport: selectNearSupport(pool).map((s) => s.symbol),
      nearResistance: selectNearResistance(pool).map((s) => s.symbol),
      strongAlignment: selectStrongAlignment(pool).map((s) => s.symbol),
      meta: {
        zoneCap: ZONE_SECTION_CAP,
        zoneConfFloor: ZONE_SECTION_CONF_FLOOR,
        strongAlignmentCap: STRONG_ALIGNMENT_CAP,
        strongAlignmentFloor: STRONG_ALIGNMENT_FLOOR,
        poolSize: pool.length,
      },
    };
  });
}
