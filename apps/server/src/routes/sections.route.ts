import type { FastifyInstance } from "fastify";
import { marketDataService } from "../services/market-data.service.js";
import { toIntelligence } from "../lib/intelligence-transformer.js";
import {
  selectNearSupport,
  selectNearResistance,
  selectStrongAlignment,
  selectVolatile,
  selectDayMovers,
  ZONE_SECTION_CAP,
  ZONE_SECTION_CONF_FLOOR,
  STRONG_ALIGNMENT_CAP,
  STRONG_ALIGNMENT_FLOOR,
  VOLATILE_ATR_PCT_FLOOR,
  VOLATILE_RVOL_FLOOR,
  VOLATILE_CAP,
  DAY_MOVERS_PCT_FLOOR,
  DAY_MOVERS_RVOL_FLOOR,
  DAY_MOVERS_CAP,
} from "../lib/section-selector.js";
import { isIndexSymbol } from "../lib/index-symbols.js";
import { computeATR } from "../lib/atr.js";
import {
  computeAtrPct,
  computeRvol,
  computeCandleVolMultiplier,
  computeCandleDirection,
  computeDayMovePct,
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
  DayMover,
  DayMoverDirectionFilter,
  DayMoverSortKey,
  VolatileStock,
  VolatileSortKey,
  VolatileRecentCandle,
  VolatileNearestLevel,
} from "../lib/types.js";
import type { DayLevels } from "../lib/day-levels.js";
import { patternAtLine, type LevelPattern } from "../lib/level-patterns.js";
import {
  marketStructure,
  trendStage,
  CONFIRMED_MIN_STEPS,
  CONFIRMED_MIN_MOVE_PCT,
  EARLY_MIN_MOVE_PCT,
  type SwingLabel,
  type TrendStage,
} from "../lib/market-structure.js";

interface SectionsRouteDeps {
  getCachedLevels: () => Record<string, SupportResistanceResult>;
  getPressure: (symbol: string) => PressureResult | null;
  getMomentum: (symbol: string) => MomentumResult | null;
  getRecentCandles: (symbol: string, n: number) => Candle[];
  getAllSymbols: () => string[];
  // Day levels: when today's lines exist, the near-support / near-resistance
  // lanes use them (same lines as the Ready list); otherwise the old S/R.
  getDayLevels?: (symbol: string) => DayLevels | null;
  getSessionCandles?: (symbol: string) => Candle[];
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
      const dayLevels = deps.getDayLevels?.(sym) ?? null;
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
        ...(dayLevels ? { dayLevels, sessionCandles: deps.getSessionCandles?.(sym) } : {}),
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
        ...(intel.displayName ? { displayName: intel.displayName } : {}),
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

  // ── Day Movers lane ──
  //
  // Returns stocks that have made a large *cumulative* move from today's
  // open. Sibling to /api/sections/volatile — different mental model
  // (reversal-hunt vs momentum-scalp). Independent filter, so a stock can
  // appear in one, both, or neither.
  // ── Trend Structure lane (display only — feeds no engine / score / call) ──
  // Today's 5-min swings → HH / HL / LH / LL (lib/market-structure.ts), read
  // as a stage (trendStage): CONFIRMED (3+ agreeing swings, moved ≥ 1 %) or
  // EARLY (first HH + HL / LH + LL, or a higher low with price breaking the
  // last high — mirror for down — moved ≥ 0.5 %). Confirmed trends first,
  // then early ones; each group ranked by the move since the trend began.
  fastify.get("/api/sections/trend", async (request) => {
    const q = request.query as { limit?: string };
    const limit = Math.min(10, Math.max(1, Number(q.limit) || 10));
    const out: {
      symbol: string;
      price: number;
      change: number;
      trend: "UP" | "DOWN";
      stage: TrendStage;
      steps: number;
      movePct: number;
      sequence: SwingLabel[];
      lastHigh: { price: number; time: number; label: SwingLabel | null } | null;
      lastLow: { price: number; time: number; label: SwingLabel | null } | null;
    }[] = [];
    let pool = 0, up = 0, down = 0;
    for (const sym of deps.getAllSymbols()) {
      if (isIndexSymbol(sym)) continue;
      const quote = marketDataService.getQuote(sym);
      if (!quote || quote.lastPrice <= 0) continue;
      const session = deps.getSessionCandles?.(sym) ?? [];
      if (session.length < 8) continue;
      pool++;
      const m = marketStructure(session);
      const read = trendStage(m, quote.lastPrice);
      if (!read) continue;
      if (read.trend === "UP") up++; else down++;
      const seq = m.swings.slice(m.swings.indexOf(read.start)).map((x) => x.label).filter((l): l is SwingLabel => !!l);
      out.push({
        symbol: sym,
        price: quote.lastPrice,
        change: quote.close > 0 ? Math.round(((quote.lastPrice - quote.close) / quote.close) * 10000) / 100 : 0,
        trend: read.trend,
        stage: read.stage,
        steps: read.steps,
        movePct: Math.round(read.movePct * 100) / 100,
        sequence: seq.slice(-6),
        lastHigh: m.lastHigh ? { price: m.lastHigh.price, time: m.lastHigh.time, label: m.lastHigh.label ?? null } : null,
        lastLow: m.lastLow ? { price: m.lastLow.price, time: m.lastLow.time, label: m.lastLow.label ?? null } : null,
      });
    }
    out.sort((a, b) => (a.stage === b.stage ? b.movePct - a.movePct : a.stage === "CONFIRMED" ? -1 : 1));
    return {
      stocks: out.slice(0, limit),
      meta: { poolSize: pool, upCount: up, downCount: down, confirmedMinSteps: CONFIRMED_MIN_STEPS, confirmedMinMovePct: CONFIRMED_MIN_MOVE_PCT, earlyMinMovePct: EARLY_MIN_MOVE_PCT, computedAt: Date.now() },
    };
  });

  // ── Trend flags for every stock (display only) ──
  // { SYMBOL: { trend, stage, steps, sequence } } for stocks whose structure
  // reads as an EARLY or CONFIRMED trend right now (same rules as the lane
  // above). The UI shows a small "trend forming" flag on cards with ≥ 75 %
  // confidence. Feeds no engine, score or call.
  fastify.get("/api/sections/trend-map", async () => {
    const trends: Record<string, { trend: "UP" | "DOWN"; stage: TrendStage; steps: number; sequence: SwingLabel[]; movePct: number }> = {};
    // candlestick reversal pattern at one of today's S/R lines in the last 15 min (lib/level-patterns.ts)
    const patterns: Record<string, LevelPattern> = {};
    for (const sym of deps.getAllSymbols()) {
      if (isIndexSymbol(sym)) continue;
      const quote = marketDataService.getQuote(sym);
      if (!quote || quote.lastPrice <= 0) continue;
      const session = deps.getSessionCandles?.(sym) ?? [];
      if (session.length < 8) continue;
      const pat = patternAtLine(deps.getDayLevels?.(sym) ?? null, session);
      if (pat) patterns[sym] = pat;
      const m = marketStructure(session);
      const read = trendStage(m, quote.lastPrice);
      if (!read) continue;
      const seq = m.swings.slice(m.swings.indexOf(read.start)).map((x) => x.label).filter((l): l is SwingLabel => !!l);
      trends[sym] = { trend: read.trend, stage: read.stage, steps: read.steps, sequence: seq.slice(-4), movePct: Math.round(read.movePct * 100) / 100 };
    }
    return { trends, patterns, computedAt: Date.now() };
  });

  fastify.get("/api/sections/day-movers", async (request) => {
    const q = (request.query ?? {}) as {
      direction?: string;
      priceMin?: string;
      priceMax?: string;
      sortBy?: string;
    };
    const direction = parseDayMoverDirection(q.direction);
    const priceMin = parseNumericQuery(q.priceMin);
    const priceMax = parseNumericQuery(q.priceMax);
    const sortBy = parseDayMoverSortKey(q.sortBy);

    const symbols = deps.getAllSymbols();
    const candidates: DayMover[] = [];
    let gainersCount = 0;
    let losersCount = 0;

    for (const sym of symbols) {
      if (isIndexSymbol(sym)) continue;
      const quote = marketDataService.getQuote(sym);
      if (!quote || quote.lastPrice <= 0) continue;
      // dayOpen is required — if Kite hasn't pushed an opening tick yet
      // there's nothing meaningful to compute.
      if (!Number.isFinite(quote.open) || quote.open <= 0) continue;

      const candles = deps.getRecentCandles(sym, 24);
      if (candles.length < 6) continue;       // RVOL baseline

      const dayMovePct = computeDayMovePct(quote.lastPrice, quote.open);
      if (dayMovePct === null) continue;
      const absDayMovePct = Math.abs(dayMovePct);

      // Cheap rejection: skip candidates below the magnitude floor before
      // doing the more expensive enrichment.
      if (absDayMovePct < DAY_MOVERS_PCT_FLOOR) continue;

      const rvol = computeRvol(candles);
      if (rvol === null || rvol < DAY_MOVERS_RVOL_FLOOR) continue;

      const distHigh = computeDistanceToLevel(quote.lastPrice, quote.high);
      const distLow = computeDistanceToLevel(quote.lastPrice, quote.low);

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

      const dir: DayMover["direction"] = dayMovePct >= 0 ? "up" : "down";
      if (dir === "up") gainersCount++;
      else losersCount++;

      candidates.push({
        symbol: sym,
        ...(intel.displayName ? { displayName: intel.displayName } : {}),
        price: quote.lastPrice,
        dayOpen: quote.open,
        dayHigh: quote.high,
        dayLow: quote.low,
        dayMovePct,
        absDayMovePct,
        direction: dir,
        distanceFromHighAbs: distHigh?.abs ?? 0,
        distanceFromHighPct: distHigh?.pct ?? 0,
        distanceFromLowAbs: distLow?.abs ?? 0,
        distanceFromLowPct: distLow?.pct ?? 0,
        dayRangePosition: computeDayRangePosition(quote.lastPrice, quote.high, quote.low),
        rvol,
        recentCandles: buildRecentCandles(candles),
        zone: intel.context.zone,
        pattern: null,
      });
    }

    const stocks = selectDayMovers(candidates, { direction, priceMin, priceMax, sortBy });

    return {
      stocks,
      meta: {
        dayMovePctFloor: DAY_MOVERS_PCT_FLOOR,
        rvolFloor: DAY_MOVERS_RVOL_FLOOR,
        cap: DAY_MOVERS_CAP,
        direction,
        sortBy,
        priceMin,
        priceMax,
        poolSize: symbols.length,
        matchedCount: stocks.length,
        gainersCount,
        losersCount,
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

const VALID_DAY_MOVER_SORT: ReadonlySet<DayMoverSortKey> = new Set([
  "absDayMove",
  "signedDayMove",
  "rvol",
  "lastCandleVolSpike",
]);

function parseDayMoverSortKey(v: string | undefined): DayMoverSortKey {
  if (v && (VALID_DAY_MOVER_SORT as Set<string>).has(v)) {
    return v as DayMoverSortKey;
  }
  return "absDayMove";
}

const VALID_DAY_MOVER_DIRECTION: ReadonlySet<DayMoverDirectionFilter> = new Set([
  "all",
  "gainers",
  "losers",
]);

function parseDayMoverDirection(v: string | undefined): DayMoverDirectionFilter {
  if (v && (VALID_DAY_MOVER_DIRECTION as Set<string>).has(v)) {
    return v as DayMoverDirectionFilter;
  }
  return "all";
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
