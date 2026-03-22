import type { FastifyInstance } from "fastify";
import { KiteConnect } from "kiteconnect";
import type { WsManager } from "../ws/ws-server.js";
import type { InstrumentMaps, Candle, SupportResistanceResult, PatternSignal, MomentumResult, SignalSnapshot } from "../lib/types.js";
import { getSignal } from "../lib/signal-engine.js";
import { computeSignalScore } from "../lib/score-engine.js";
import { applyMarketPhase } from "../lib/market-phase.js";
import { getSupportResistance } from "../services/levels.service.js";
import { marketDataService } from "../services/market-data.service.js";
import type { PressureEngine } from "../services/pressure.service.js";
import type { EodJob } from "../services/eod-job.service.js";
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
  onLevelsComputed?: (levels: Record<string, SupportResistanceResult>) => void;
  getCachedLevels?: () => Record<string, SupportResistanceResult>;
  getEodJob?: () => EodJob | null;
  getSignalSnapshot?: (symbol: string) => SignalSnapshot | null;
  getMomentum?: (symbol: string) => MomentumResult | null;
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

  // --- S/R Levels for all stocks (served from background worker cache) ---
  fastify.get("/api/stocks/levels", async (_req, reply) => {
    const instrumentMaps = opts.getInstrumentMaps();

    if (!instrumentMaps) {
      return reply
        .status(503)
        .send({ error: "Market data not initialized. Login to Kite first." });
    }

    // Read from shared cachedLevels (populated by levels-worker)
    const levels = opts.getCachedLevels?.() ?? {};
    return {
      levels,
      coverage: `${Object.keys(levels).length}/${instrumentMaps.symbols.length}`,
      timestamp: Date.now(),
    };
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

    let instrumentToken = instrumentMaps.symbolToToken.get(symbol);
    // Fallback: search in allInstruments for untracked stocks
    if (instrumentToken === undefined) {
      const inst = instrumentMaps.allInstruments?.find((i) => i.symbol === symbol);
      if (inst) instrumentToken = inst.token;
    }
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

  // --- Stock Search (all NSE EQ instruments) ---
  fastify.get("/api/stocks/search", async (req) => {
    const instrumentMaps = opts.getInstrumentMaps();
    if (!instrumentMaps?.allInstruments) return { results: [] };

    const { q } = req.query as { q?: string };
    if (!q || q.length < 2) return { results: [] };

    const query = q.toUpperCase();
    const trackedSet = new Set(instrumentMaps.symbols);

    // Starts-with first, then contains
    const startsWith: any[] = [];
    const contains: any[] = [];

    for (const inst of instrumentMaps.allInstruments) {
      if (inst.symbol.startsWith(query)) {
        startsWith.push(inst);
      } else if (inst.symbol.includes(query)) {
        contains.push(inst);
      }
      if (startsWith.length + contains.length >= 20) break;
    }

    const results = [...startsWith, ...contains].slice(0, 10).map((inst) => {
      const quote = marketDataService.getQuote(inst.symbol);
      return {
        symbol: inst.symbol,
        token: inst.token,
        price: quote?.lastPrice ?? inst.lastPrice,
        change: quote && quote.close ? Math.round(((quote.lastPrice - quote.close) / quote.close) * 10000) / 100 : 0,
        isTracked: trackedSet.has(inst.symbol),
      };
    });

    return { results };
  });

  // --- On-demand Stock Snapshot ---
  const snapshotCache = new Map<string, { data: any; timestamp: number }>();
  const SNAPSHOT_TTL = 60_000; // 60s

  fastify.get("/api/stocks/:symbol/snapshot", async (req, reply) => {
    const { symbol } = req.params as { symbol: string };
    const accessToken = opts.getAccessToken();
    const instrumentMaps = opts.getInstrumentMaps();

    if (!accessToken || !instrumentMaps) {
      return reply.status(503).send({ error: "Not initialized" });
    }

    // Check cache
    const cached = snapshotCache.get(symbol);
    if (cached && Date.now() - cached.timestamp < SNAPSHOT_TTL) {
      return cached.data;
    }

    const quote = marketDataService.getQuote(symbol);
    const isTracked = instrumentMaps.symbols.includes(symbol);
    const levels = opts.getCachedLevels?.() ?? {};
    let sr = levels[symbol] ?? null;
    let onDemandMomentum: MomentumResult | null = null;

    // Price from live quote
    let price = quote?.lastPrice ?? 0;
    let open = quote?.open ?? 0;
    let high = quote?.high ?? 0;
    let low = quote?.low ?? 0;
    let close = quote?.close ?? 0;
    let volume = quote?.volume ?? 0;

    // For untracked stocks (or missing data): fetch candles from Kite API
    const needsCandles = !isTracked || (!sr && price === 0);
    if (needsCandles) {
      const token = instrumentMaps.symbolToToken.get(symbol)
        ?? instrumentMaps.allInstruments?.find((i) => i.symbol === symbol)?.token;

      if (token && accessToken) {
        try {
          const kc = new KiteConnect({ api_key: opts.apiKey });
          kc.setAccessToken(accessToken);
          const to = new Date();
          const from = new Date();
          from.setDate(from.getDate() - 25);
          const data = await kc.getHistoricalData(token, "day" as any, formatDate(from), formatDate(to));
          const candles: Candle[] = data.map((d: any) => ({
            time: Math.floor(new Date(d.date).getTime() / 1000),
            open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume,
          }));

          if (candles.length >= 2) {
            // Set price from latest candle if no live quote
            const last = candles[candles.length - 1];
            if (!quote) {
              price = last.close;
              open = last.open; high = last.high; low = last.low; close = last.close; volume = last.volume;
            }

            // Compute S/R if not cached
            if (!sr && price > 0) {
              sr = getSupportResistance(candles, price);
            }

            // Compute momentum from daily candles
            if (candles.length >= 3) {
              onDemandMomentum = getMomentum(candles.slice(-3));
            }
          }
        } catch {
          // ignore API errors
        }
      }
    }

    // Get existing engine data if tracked, or use on-demand computed values
    const signalSnap = opts.getSignalSnapshot?.(symbol);
    const momentum = opts.getMomentum?.(symbol) ?? onDemandMomentum;
    const pressure = opts.getPressureEngine()?.getPressure(symbol) ?? null;

    // Compute signal
    const change = close !== 0 ? Math.round(((price - close) / close) * 10000) / 100 : 0;
    let signal = signalSnap?.signal ?? null;

    if (!signal && sr && price > 0) {
      const freshSr = {
        supportZone: sr.supportZone ? { level: sr.supportZone.level, distancePercent: Math.abs(price - sr.supportZone.level) / price * 100 } : null,
        resistanceZone: sr.resistanceZone ? { level: sr.resistanceZone.level, distancePercent: Math.abs(price - sr.resistanceZone.level) / price * 100 } : null,
      };
      signal = getSignal({ price, sr: freshSr, pressure, momentum, pattern: null });
    }

    // Always compute score (even if signal came from cache — ensures scoreBreakdown)
    if (signal && price > 0) {
      const { score, breakdown } = computeSignalScore({ pressure, momentum, pattern: null, sr, signal, price, open, high, low });
      signal.score = score;
      signal.scoreBreakdown = {
        pressure: Math.round(breakdown.pressure * 10),
        momentum: Math.round(breakdown.momentum * 10),
        sr: Math.round(breakdown.sr * 10),
        pattern: Math.round(breakdown.pattern * 10),
        volatility: Math.round(breakdown.volatility * 10),
      };

      // Apply market phase adjustment (same as signal-worker)
      if (!signal.marketPhase) {
        const phaseResult = applyMarketPhase(signal, score);
        signal.finalScore = phaseResult.finalScore;
        signal.marketPhase = phaseResult.marketPhase;
        signal.warningMessage = phaseResult.warningMessage;
        if (phaseResult.marketPhase === "OPENING") {
          signal.action = "WAIT";
          signal.confidence = "LOW";
        } else if (phaseResult.marketPhase === "STABILIZING") {
          signal.action = phaseResult.decision;
          signal.confidence = phaseResult.confidence;
        }
      }
    }

    const result = {
      symbol,
      price, open, high, low, close, volume, change,
      signal,
      momentum,
      pressure: pressure ? pressure : { status: "UNAVAILABLE", reason: "Not tracked in real-time" },
      srLevels: sr,
      dataSource: isTracked ? "live" : "on-demand",
      computedAt: Date.now(),
    };

    // Cache it
    snapshotCache.set(symbol, { data: result, timestamp: Date.now() });

    return result;
  });

  // --- EOD Precomputation ---
  fastify.post("/api/eod/run", async (_req, reply) => {
    const eodJob = opts.getEodJob?.();
    if (!eodJob) {
      return reply.status(503).send({ error: "EOD job not initialized" });
    }
    if (eodJob.isRunning()) {
      return reply.status(409).send({ error: "EOD job already running" });
    }
    try {
      const result = await eodJob.run();
      return { success: true, ...result };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });
}
