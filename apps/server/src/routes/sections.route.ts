import type { FastifyInstance } from "fastify";
import { marketDataService } from "../services/market-data.service.js";
import { toIntelligence } from "../lib/intelligence-transformer.js";
import {
  selectNearSupport,
  selectNearResistance,
  selectStrongAlignment,
  selectVolatile,
  ZONE_SECTION_CAP,
  ZONE_SECTION_CONF_FLOOR,
  STRONG_ALIGNMENT_CAP,
  STRONG_ALIGNMENT_FLOOR,
  VOLATILE_ATR_PCT_FLOOR,
  VOLATILE_RVOL_FLOOR,
  VOLATILE_CAP,
} from "../lib/section-selector.js";
import { isIndexSymbol } from "../lib/index-symbols.js";
import { computeATR } from "../lib/atr.js";
import {
  computeAtrPct,
  computeRvol,
  computeCandleVolMultiplier,
  computeCandleDirection,
  computeDayRangePosition,
  computeDistanceToLevel,
  getLastNCandlesNewestFirst,
} from "../lib/volatility-metrics.js";
import type {
  IntelligenceSnapshot,
  SupportResistanceResult,
  PressureResult,
  MomentumResult,
  Candle,
  VolatileStock,
  VolatileSortKey,
  VolatileRecentCandle,
  VolatileNearestLevel,
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

  // ── Volatile Stocks lane ──
  //
  // Returns stocks that are actively volatile (high ATR%) AND backed by real
  // volume (high RVOL). Intended for the intraday-trading "Volatile" tab on
  // the dashboard. Filters + sort applied server-side per the plan's
  // backend-only-filter rule.
  fastify.get("/api/sections/volatile", async (request) => {
    const q = (request.query ?? {}) as {
      priceMin?: string;
      priceMax?: string;
      sortBy?: string;
    };
    const priceMin = parseNumericQuery(q.priceMin);
    const priceMax = parseNumericQuery(q.priceMax);
    const sortBy = parseVolatileSortKey(q.sortBy);

    const symbols = deps.getAllSymbols();
    const candidates: VolatileStock[] = [];

    for (const sym of symbols) {
      if (isIndexSymbol(sym)) continue;
      const quote = marketDataService.getQuote(sym);
      if (!quote || quote.lastPrice <= 0) continue;

      const candles = deps.getRecentCandles(sym, 24);
      if (candles.length < 6) continue; // need RVOL baseline

      const atr = computeATR(candles, 14);
      const atrPct = computeAtrPct(atr, quote.lastPrice);
      const rvol = computeRvol(candles);
      if (atrPct === null || rvol === null) continue;

      // Cheap rejection: skip stocks below the floors before doing the
      // (more expensive) enrichment work. selectVolatile re-checks the
      // floors, so this is just an optimisation.
      if (atrPct < VOLATILE_ATR_PCT_FLOOR || rvol < VOLATILE_RVOL_FLOOR) continue;

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
        recentCandles: candles,
      });

      candidates.push({
        symbol: sym,
        price: quote.lastPrice,
        changePct: intel.change,
        atrPct,
        rvol,
        dayHigh: quote.high,
        dayLow: quote.low,
        dayRangePosition: computeDayRangePosition(quote.lastPrice, quote.high, quote.low),
        nearestLevel: pickNearestLevel(quote.lastPrice, sr),
        recentCandles: buildRecentCandles(candles),
        zone: intel.context.zone,
        pattern: null, // v1: pattern detection deferred — covered in plan §11
      });
    }

    const stocks = selectVolatile(candidates, { priceMin, priceMax, sortBy });

    return {
      stocks,
      meta: {
        atrPctFloor: VOLATILE_ATR_PCT_FLOOR,
        rvolFloor: VOLATILE_RVOL_FLOOR,
        cap: VOLATILE_CAP,
        sortBy,
        priceMin,
        priceMax,
        poolSize: symbols.length,
        matchedCount: stocks.length,
      },
    };
  });
}

// ── Helpers (local to this route file) ──

function parseNumericQuery(v: string | undefined): number | null {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const VALID_VOLATILE_SORT: ReadonlySet<VolatileSortKey> = new Set([
  "atrPct",
  "rvol",
  "changePct",
  "lastCandleVolSpike",
]);

function parseVolatileSortKey(v: string | undefined): VolatileSortKey {
  if (v && (VALID_VOLATILE_SORT as Set<string>).has(v)) {
    return v as VolatileSortKey;
  }
  return "atrPct";
}

function pickNearestLevel(
  price: number,
  sr: SupportResistanceResult | null,
): VolatileNearestLevel | null {
  const supLevel = sr?.supportZone?.level ?? null;
  const resLevel = sr?.resistanceZone?.level ?? null;
  const supDist = computeDistanceToLevel(price, supLevel);
  const resDist = computeDistanceToLevel(price, resLevel);
  if (!supDist && !resDist) return null;
  if (supDist && (!resDist || supDist.abs <= resDist.abs)) {
    return { kind: "SUPPORT", price: supLevel!, distanceAbs: supDist.abs, distancePct: supDist.pct };
  }
  return { kind: "RESISTANCE", price: resLevel!, distanceAbs: resDist!.abs, distancePct: resDist!.pct };
}

function buildRecentCandles(allCandles: Candle[]): VolatileRecentCandle[] {
  const newestFirst = getLastNCandlesNewestFirst(allCandles, 3);
  return newestFirst.map((c) => ({
    time: c.time,
    direction: computeCandleDirection(c),
    volume: c.volume,
    volMultiplier: computeCandleVolMultiplier(c, allCandles),
  }));
}
