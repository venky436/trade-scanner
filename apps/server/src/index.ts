import "dotenv/config";
import { buildServer } from "./server.js";
import { loadInstruments, loadIndices, loadIndexFutures, type MarketMode } from "./services/instrument.service.js";
import { createKiteTickerManager } from "./services/kite-ticker.service.js";
import { createWsManager, type WsManager } from "./ws/ws-server.js";
import { createBroadcastEngine } from "./services/broadcast.service.js";
import { createPressureEngine, type PressureEngine } from "./services/pressure.service.js";
import { createCandleTracker } from "./services/candle-tracker.service.js";
import { createHistoryBackfill, type HistoryBackfill } from "./services/history-backfill.service.js";
import { createSignalWorker, type SignalWorker } from "./services/signal-worker.service.js";
import { createLevelsWorker, type LevelsWorker } from "./services/levels-worker.service.js";
import { createStockFilter, type StockFilter } from "./services/stock-filter.service.js";
import { createEodJob, type EodJob } from "./services/eod-job.service.js";
import { createSignalAccuracyService, type SignalAccuracyService } from "./services/signal-accuracy.service.js";
import { createSignalTrackingService, type SignalTrackingService } from "./services/signal-tracking.service.js";
import { createAiCallService, type AiCallService } from "./services/ai-call.service.js";
import { createAiOutcomeService, type AiOutcomeService } from "./services/ai-outcome.service.js";
import { getAiModeEnabled } from "./lib/runtime-config.js";
import { redisService } from "./services/redis.service.js";
import { getIntradaySR } from "./services/intraday-levels.service.js";
import { getMomentum } from "./lib/momentum-engine.js";
import { detectPattern } from "./lib/pattern-engine.js";
import { INDEX_SYMBOLS, isIndexSymbol, isIndexLikeSymbol } from "./lib/index-symbols.js";
import { loadSession } from "./lib/session-store.js";
import type { InstrumentMaps, SupportResistanceResult, MomentumResult, PatternSignal } from "./lib/types.js";
import { marketDataService } from "./services/market-data.service.js";
import { createOrderExecutionService } from "./services/order-execution.service.js";
import { createAutoTrader } from "./services/auto-trader.service.js";
import { buildTradeSetups, inCallWindow, CALL_WINDOW_LABEL } from "./lib/trade-setups.js";
import { istDate, type DayLevels } from "./lib/day-levels.js";
import { db } from "./db/index.js";
import { users } from "./db/schema/users.js";
import { eq } from "drizzle-orm";

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
  // Loads today's 5-min candles from Kite after (re)connect so engines are warm in minutes
  let historyBackfillInstance: HistoryBackfill | null = null;
  let broadcastStop: (() => void) | null = null;
  let signalWorkerInstance: SignalWorker | null = null;
  let levelsWorkerInstance: LevelsWorker | null = null;
  let stockFilterInstance: StockFilter | null = null;
  let eodJobInstance: EodJob | null = null;
  let accuracyServiceInstance: SignalAccuracyService | null = null;
  let trackingServiceInstance: SignalTrackingService | null = null;
  // AI verdict module — only created + started when AI_MODE_ENABLED=true.
  // When the flag is off this stays null, the scheduler never runs, no
  // Gemini calls are made, and no GEMINI_API_KEY is required.
  let aiCallServiceInstance: AiCallService | null = null;
  let aiOutcomeServiceInstance: AiOutcomeService | null = null;
  // Lifecycle handlers populated inside startMarketData() so they have
  // closure access to the live pressureEngine / momentumMap / candleTracker.
  // Exposed to /api/config/ai-mode for the runtime toggle.
  let enableAiServices: (() => void) | null = null;
  let disableAiServices: (() => void) | null = null;

  // Exposed so routes can use them
  let currentAccessToken: string | null = null;
  let currentInstrumentMaps: InstrumentMaps | null = null;
  let currentPressureEngine: PressureEngine | null = null;
  let currentMomentumMap: Map<string, MomentumResult> | null = null;
  // Exposed for sections route (reads recent candles) — assigned in startMarketData
  let currentCandleTracker: ReturnType<typeof createCandleTracker> | null = null;

  // Order execution (manual trades from the Trade screen / order window).
  // Paper / Real comes ONLY from the navbar switch (saved in data/trade-mode.json).
  // Never used yet → PAPER. Real Zerodha orders only after switching to Real.
  const orderExecution = createOrderExecutionService({
    apiKey,
    getAccessToken: () => currentAccessToken,
    getInstrumentMaps: () => currentInstrumentMaps,
    paperCapital: Number(process.env.PAPER_CAPITAL) || 25_000,
    modeFile: "data/trade-mode.json",
    entryCutoff: process.env.ENTRY_CUTOFF,
    squareOffAt: process.env.SQUARE_OFF_AT,
  });

  // Auto-trader: PAPER only (pauses while the switch is on Real).
  // ≥90% confidence, max 5 active trades, ₹500 risk per trade (quantity =
  // ₹500 ÷ stop distance, capped by margin). See auto-trader.service.ts.
  let adminUserId: string | null = null;
  const autoTrader = createAutoTrader({
    getMode: () => orderExecution.mode,
    getUserId: async () => {
      if (!adminUserId) {
        const [u] = await db.select({ id: users.id }).from(users).where(eq(users.role, "ADMIN")).limit(1);
        adminUserId = u?.id ?? null;
      }
      return adminUserId;
    },
    getReadySetups: () =>
      buildTradeSetups(
        {
          getCachedLevels: () => cachedLevels,
          getPressure: (s) => currentPressureEngine?.getPressure(s) ?? null,
          getMomentum: (s) => currentMomentumMap?.get(s) ?? null,
          getRecentCandles: (s, n) => currentCandleTracker?.getRecentCandles(s, n) ?? [],
          getAllSymbols: () => currentInstrumentMaps?.symbols ?? [],
          getDayLevels: todayDayLevels,
          getSessionCandles: (s) => currentCandleTracker?.getSessionCandles(s) ?? [],
        },
        20,
      ).ready,
    getMaxQuantity: async (symbol, side) => (await orderExecution.quoteMargin(symbol, side)).maxQty,
    getTodayTrades: async (userId) => {
      const [today, active] = await Promise.all([
        orderExecution.listTrades(userId, { range: "today" }),
        orderExecution.listTrades(userId, { range: "all", status: "active" }),
      ]);
      const seen = new Set(today.map((t) => t.id));
      return [...today, ...active.filter((t) => !seen.has(t.id))];
    },
    placeTrade: (userId, input) => orderExecution.placeTrade(userId, input),
    callWindow: { isOpen: () => inCallWindow(Date.now()), label: CALL_WINDOW_LABEL },
    stateFile: "data/auto-trade.json",
  });

  // Shared S/R levels cache (populated by levels-worker, read by signal-worker + broadcast)
  let cachedLevels: Record<string, SupportResistanceResult> = {};
  // DAY LEVELS — today's frozen S1–S3 / R1–R3 per stock (levels-worker computes
  // them once per day after the open). Only today's are ever returned.
  const cachedDayLevels: Record<string, DayLevels> = {};
  function todayDayLevels(symbol: string): DayLevels | null {
    const d = cachedDayLevels[symbol];
    return d && d.date === istDate(Date.now()) ? d : null;
  }
  // Intraday S/R levels (computed from 5-min session candles)
  const intradayLevels: Record<string, SupportResistanceResult> = {};
  // Per-symbol counter for throttling intraday S/R recompute. Recomputes
  // every 3 candle closes (= 15 min) instead of every candle. Stops the
  // S/R level from visibly "jumping" every 5 min (UX trust); also keeps
  // any future intraday-S/R-pipe-into-broadcast stable for the gates.
  const intradaySrCandlesSince = new Map<string, number>();
  const INTRADAY_SR_RECOMPUTE_EVERY = 3;
  // Global market state (computed from NIFTY 50 5-min range)
  let globalMarketState: "DEAD" | "SLOW" | "ACTIVE" = "ACTIVE";

  // Called after Kite login succeeds
  async function startMarketData(accessToken: string) {
    console.log(`Starting market data (mode: ${marketMode})...`);

    // Load instruments (stocks + indices)
    const instrumentMaps = await loadInstruments(apiKey, accessToken, marketMode);

    // Load indices separately and merge into instrument maps
    // Index FUTURES (NIFTY for v1) are loaded next and merged into the same
    // maps — they ride through the existing pipeline as ordinary symbols
    // because every downstream engine is symbol-agnostic.
    const futuresSymbols: string[] = [];
    if (marketMode === "equity") {
      const indexMaps = await loadIndices(apiKey, accessToken);
      for (const [token, symbol] of indexMaps.tokenToSymbol) {
        instrumentMaps.tokenToSymbol.set(token, symbol);
        instrumentMaps.symbolToToken.set(symbol, token);
        instrumentMaps.symbols.push(symbol);
      }
      console.log(`[equity] Total instruments (stocks + indices): ${instrumentMaps.symbols.length}`);

      // Fail-soft: any error here must NOT block the rest of the boot. The
      // scanner is still useful without futures, and an outage of the NFO
      // instrument list should not take the whole app down.
      try {
        const futuresMaps = await loadIndexFutures(apiKey, accessToken);
        for (const [token, symbol] of futuresMaps.tokenToSymbol) {
          instrumentMaps.tokenToSymbol.set(token, symbol);
          instrumentMaps.symbolToToken.set(symbol, token);
          instrumentMaps.symbols.push(symbol);
          futuresSymbols.push(symbol);
        }
        if (futuresMaps.symbols.length > 0) {
          console.log(`[equity] Added ${futuresMaps.symbols.length} index future(s): ${futuresMaps.symbols.join(", ")}`);
        }
      } catch (err) {
        console.error("[index_futures] Failed to load — scanner continuing without futures:", (err as Error).message);
      }
    }

    // Store for history route
    currentAccessToken = accessToken;
    currentInstrumentMaps = instrumentMaps;

    // Load precomputed S/R from Redis (instant load)
    const precomputed = await redisService.getPrecomputed();
    if (precomputed && Object.keys(precomputed.levels).length > 0) {
      cachedLevels = precomputed.levels;
      const age = Math.round((Date.now() - precomputed.timestamp) / 60_000);
      console.log(`[Redis] Loaded ${Object.keys(precomputed.levels).length} precomputed levels (${age} min old)`);
    }

    // Create EOD job
    const eodJob = createEodJob({
      apiKey,
      getAccessToken: () => currentAccessToken,
      getInstrumentMaps: () => currentInstrumentMaps,
      onLevelComputed: (symbol, sr) => { cachedLevels[symbol] = sr; },
      onMomentumComputed: (symbol, result) => {
        momentumMap.set(symbol, result);
        momentumVersion.set(symbol, (momentumVersion.get(symbol) ?? 0) + 1);
      },
      onPatternComputed: (symbol, result) => {
        patternMap.set(symbol, result);
        patternVersion.set(symbol, (patternVersion.get(symbol) ?? 0) + 1);
      },
    });
    eodJobInstance = eodJob;

    // Create pressure engine
    const pressureEngine = createPressureEngine();
    currentPressureEngine = pressureEngine;

    // In-memory maps for candle-driven analysis
    const momentumMap = new Map<string, MomentumResult>();
    currentMomentumMap = momentumMap;
    const patternMap = new Map<string, PatternSignal>();
    const momentumVersion = new Map<string, number>();
    const patternVersion = new Map<string, number>();

    // Create stock filter (fast eligibility layer)
    // alwaysInclude: indices (no volume → never pass naturally) AND any index
    // futures we picked up — they have huge volume and would pass the change/
    // RVOL filter most days, but pinning them ensures they never drop off
    // the dashboard during a quiet hour.
    const alwaysIncludeSet = futuresSymbols.length > 0
      ? new Set([...INDEX_SYMBOLS, ...futuresSymbols])
      : INDEX_SYMBOLS;
    if (stockFilterInstance) stockFilterInstance.stop();
    const stockFilter = createStockFilter({
      maxStocks: 150,
      minChangePercent: 0.5,
      minRelativeVolume: 1.2,
      minPrice: 50,
      refreshIntervalMs: 5000,
      allSymbols: instrumentMaps.symbols,
      alwaysInclude: alwaysIncludeSet,
    });
    stockFilterInstance = stockFilter;

    // Ref for candle tracker (created later, used by signal worker via closure)
    let candleTrackerRef: ReturnType<typeof createCandleTracker> | null = null;

    // Create signal worker (background batch computation)
    if (signalWorkerInstance) signalWorkerInstance.stop();
    const signalWorker = createSignalWorker({
      batchSize: 200,
      batchIntervalMs: 1000,
      fastLaneIntervalMs: 500,
      getPressure: (s) => pressureEngine.getPressure(s),
      getPressureVersion: (s) => pressureEngine.getVersion(s),
      getLevels: () => cachedLevels,
      getMomentum: (s) => momentumMap.get(s) ?? null,
      getMomentumVersion: (s) => momentumVersion.get(s) ?? 0,
      getPattern: (s) => patternMap.get(s) ?? null,
      getPatternVersion: (s) => patternVersion.get(s) ?? 0,
      getEligibleSymbols: () => stockFilter.getEligibleSymbols(),
      getIntradayLevels: () => intradayLevels,
      getSessionCandleCount: (s) => candleTrackerRef?.getSessionCandleCount(s) ?? 0,
      getLastCandle: (s) => candleTrackerRef?.getLastCandle(s) ?? null,
      getSessionCandles: (s) => candleTrackerRef?.getSessionCandles(s) ?? [],
      getGlobalMarketState: () => globalMarketState,
    });
    signalWorker.setSymbols(instrumentMaps.symbols);
    signalWorkerInstance = signalWorker;

    // Create signal accuracy service (old: score-based, target/SL evaluation)
    const accuracyService = createSignalAccuracyService();
    accuracyServiceInstance = accuracyService;

    // Create signal tracking service (new: confidence-bucketed, 15-min evaluation)
    const trackingService = createSignalTrackingService();
    trackingServiceInstance = trackingService;

    // Hook: record high-confidence signals for accuracy tracking
    signalWorker.setOnHighConfidenceSignal((symbol, signal, price) => {
      accuracyService.recordSignal(symbol, signal, price);
    });

    // Create levels worker (background S/R computation)
    if (levelsWorkerInstance) levelsWorkerInstance.stop();
    const levelsWorker = createLevelsWorker({
      apiKey,
      batchSize: 10,
      intervalMs: 2000,
      getAccessToken: () => currentAccessToken,
      getInstrumentMaps: () => currentInstrumentMaps,
      onLevelsUpdate: (symbol, result) => { cachedLevels[symbol] = result; redisService.setLevel(symbol, result); },
      onDayLevels: (symbol, levels) => { cachedDayLevels[symbol] = levels; },
      getDayLevelsDate: (symbol) => cachedDayLevels[symbol]?.date ?? null,
    });
    levelsWorkerInstance = levelsWorker;

    // Recreate WS manager with symbols + cache readers (NO computation)
    if (wsManager) wsManager.close();
    wsManager = createWsManager({
      symbols: instrumentMaps.symbols,
      getPressure: (s) => pressureEngine.getPressure(s),
      getMomentum: (s) => momentumMap.get(s) ?? null,
      getLevels: (s) => cachedLevels[s] ?? null,
      getRecentCandles: (s) => candleTrackerRef?.getRecentCandles(s, 21) ?? [],
      getDayLevels: todayDayLevels,
      getSessionCandles: (s) => candleTrackerRef?.getSessionCandles(s) ?? [],
      getEligibleSymbols: () => stockFilter.getEligibleSymbols(),
    });
    wsManager.attach(server.server);

    // Create candle tracker (5-min candles from ticks)
    const candleTracker = createCandleTracker({
      onCandleClose: (symbol, candles) => {
        // Compute momentum (3× more sensitive divisor for indices — they
        // move 0.05–0.2% per candle vs stocks at 0.3–1%, so the same
        // threshold puts indices perpetually in FLAT)
        const mom = getMomentum(candles, isIndexLikeSymbol(symbol));
        if (mom) momentumMap.set(symbol, mom);
        else momentumMap.delete(symbol);
        momentumVersion.set(symbol, (momentumVersion.get(symbol) ?? 0) + 1);

        // Update global market state from NIFTY 50 range
        if (symbol === "NIFTY 50" && candles.length > 0) {
          const lastCandle = candles[candles.length - 1];
          const niftyPrice = marketDataService.getQuote("NIFTY 50")?.lastPrice ?? 0;
          if (niftyPrice > 0 && lastCandle.high > 0 && lastCandle.low > 0) {
            const niftyRange = (lastCandle.high - lastCandle.low) / niftyPrice;
            const prev = globalMarketState;
            if (niftyRange < 0.001) globalMarketState = "DEAD";        // < 0.10%
            else if (niftyRange < 0.003) globalMarketState = "SLOW";   // < 0.30%
            else globalMarketState = "ACTIVE";
            if (prev !== globalMarketState) {
              console.log(`[MarketFilter] Global state: ${prev} → ${globalMarketState} (NIFTY range: ${(niftyRange * 100).toFixed(2)}%)`);
            }
          }
        }

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
        patternVersion.set(symbol, (patternVersion.get(symbol) ?? 0) + 1);

        // Compute intraday S/R from session candles (5-min). Throttled to
        // every 3rd close (15 min) so the user-visible level doesn't jump
        // every 5 min. Always fires on the very first qualifying close
        // (length === 15), which also handles new-trading-day resets — the
        // candle tracker zeroes session candles on day change, so the next
        // run-up to 15 always recomputes regardless of any leftover counter.
        const sessionCandles = candleTracker.getSessionCandles(symbol);
        if (sessionCandles.length >= 15 && price > 0) {
          const since = intradaySrCandlesSince.get(symbol) ?? Infinity;
          const isFirstSessionCompute = sessionCandles.length === 15;
          const dueForRecompute = since + 1 >= INTRADAY_SR_RECOMPUTE_EVERY;
          if (isFirstSessionCompute || dueForRecompute) {
            const intradaySr = getIntradaySR(sessionCandles, price);
            if (intradaySr) {
              intradayLevels[symbol] = intradaySr;
            }
            intradaySrCandlesSince.set(symbol, 0);
          } else {
            intradaySrCandlesSince.set(symbol, since + 1);
          }
        }
      },
    });
    candleTrackerRef = candleTracker;
    currentCandleTracker = candleTracker;

    // Start broadcast engine (reads from caches, NO computation)
    if (broadcastStop) broadcastStop();
    const broadcast = createBroadcastEngine({
      wsManager,
      intervalMs: 500,
      maxPerBroadcast: 150,
      getPressure: (s) => pressureEngine.getPressure(s),
      getMomentum: (s) => momentumMap.get(s) ?? null,
      getLevels: (s) => cachedLevels[s] ?? null,
      getRecentCandles: (s) => candleTrackerRef?.getRecentCandles(s, 21) ?? [],
      getDayLevels: todayDayLevels,
      getSessionCandles: (s) => candleTrackerRef?.getSessionCandles(s) ?? [],
      getEligibleSymbols: () => stockFilter.getEligibleSymbols(),
      onIntelligenceComputed: (symbol, intel, price) => {
        trackingService.recordSignal(symbol, intel, price);
      },
    });
    broadcast.start();
    broadcastStop = broadcast.stop;

    // Start workers
    stockFilter.start();
    signalWorker.start();
    // levelsWorker starts AFTER the startup history jobs (see below) — it uses
    // the same Kite historical-data rate limit; until then daily S/R comes
    // from the Redis cache loaded above.
    accuracyService.start();
    trackingService.start();

    // AI Verdict Module — lifecycle hooks. Define enable/disable as closures
    // over the live engines (pressureEngine, momentumMap, candleTracker,
    // instrumentMaps) so the /api/config/ai-mode toggle can spin them up or
    // tear them down at runtime without a server restart.
    enableAiServices = () => {
      if (aiCallServiceInstance) return; // already running
      const aiCallService = createAiCallService({
        getCachedLevels: () => cachedLevels,
        getPressure: (s) => pressureEngine.getPressure(s),
        getMomentum: (s) => momentumMap.get(s) ?? null,
        getRecentCandles: (s, n) => candleTracker.getRecentCandles(s, n),
        getAllSymbols: () => instrumentMaps.symbols,
      });
      aiCallService.start();
      aiCallServiceInstance = aiCallService;

      const aiOutcomeService = createAiOutcomeService();
      aiOutcomeService.start();
      aiOutcomeServiceInstance = aiOutcomeService;
    };
    disableAiServices = () => {
      if (aiCallServiceInstance) { aiCallServiceInstance.stop(); aiCallServiceInstance = null; }
      if (aiOutcomeServiceInstance) { aiOutcomeServiceInstance.stop(); aiOutcomeServiceInstance = null; }
    };

    // Initial state from runtime flag (initialized from env at boot)
    if (getAiModeEnabled()) {
      enableAiServices();
    } else {
      console.log("[AI] Module disabled at boot (AI_MODE_ENABLED is not 'true') — toggle on via /api/config/ai-mode");
    }

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
      // Zerodha order status changes → update the matching trade row
      onOrderUpdate: (order) => orderExecution.handleOrderUpdate(order),
    });
    ticker.connect();
    tickerDisconnect = ticker.disconnect;

    // Warm the engines from Kite's historical 5-min candles (most active first)
    // instead of waiting 15–20 min for live candles. See history-backfill.service.ts.
    if (historyBackfillInstance) historyBackfillInstance.stop();
    const historyBackfill = createHistoryBackfill({
      apiKey,
      getAccessToken: () => currentAccessToken,
      getInstrumentMaps: () => currentInstrumentMaps,
      getPrioritySymbols: () => stockFilter.getEligibleSymbols(),
      candleTracker,
      pressureEngine,
    });
    historyBackfillInstance = historyBackfill;

    console.log("Market data pipeline started");

    // Delayed full snapshot: after Kite sends initial tick burst + signal-worker computes
    // Push complete data to already-connected clients (avoids partial first load)
    // Two pushes: 8s (initial quotes loaded) + 15s (signals fully computed with S/R context)
    for (const delay of [8000, 15000]) {
      setTimeout(() => {
        if (wsManager && wsManager.clientCount() > 0) {
          const snapshot = {
            type: "snapshot" as const,
            data: wsManager.buildSnapshot(),
            market: wsManager.buildMarketContextSnapshot(),
            timestamp: Date.now(),
          };
          wsManager.broadcast(snapshot);
          console.log(`[Startup] Pushed snapshot (${snapshot.data.length} stocks) to ${wsManager.clientCount()} clients at +${delay / 1000}s`);
        }
      }, delay);
    }

    // Startup jobs (non-blocking), one after the other so they don't fight
    // over Kite's historical-data rate limit:
    //   1. history backfill — engines warm within minutes (waits 6 s so the
    //      stock filter has picked the most active symbols to load first)
    //   2. EOD job — daily S/R precomputation (as before)
    //   3. levels worker — continuous daily S/R refresh
    setTimeout(async () => {
      try {
        await historyBackfill.run();
      } catch (err) {
        console.error("[Startup] History backfill failed:", err);
      }
      try {
        console.log("[Startup] Auto-triggering EOD precomputation...");
        await eodJob.run();
      } catch (err) {
        console.error("[Startup] EOD auto-trigger failed:", err);
      } finally {
        //   3. continuous daily-S/R refresh (only if this is still the current pipeline)
        if (levelsWorkerInstance === levelsWorker) levelsWorker.start();
      }
    }, 6000);
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
    getCachedLevels: () => cachedLevels,
    getEodJob: () => eodJobInstance,
    getMomentum: (s: string) => currentMomentumMap?.get(s) ?? null,
    getAccuracyService: () => accuracyServiceInstance,
    getTrackingService: () => trackingServiceInstance,
    // AI verdict module wiring — provides null when AI_MODE_ENABLED=false
    getAiCallService: () => aiCallServiceInstance,
    onAiModeEnable: () => enableAiServices?.(),
    onAiModeDisable: () => disableAiServices?.(),
    // Sections endpoint dependencies (always provided so sections endpoint
    // works even when AI mode is off — it just reads from the same in-memory
    // state the dashboard uses)
    getCachedLevelsMap: () => cachedLevels,
    getPressureSignal: (s) => currentPressureEngine?.getPressure(s) ?? null,
    getMomentumSignal: (s) => currentMomentumMap?.get(s) ?? null,
    getRecentCandles: (s, n) => currentCandleTracker?.getRecentCandles(s, n) ?? [],
    getAllSymbols: () => currentInstrumentMaps?.symbols ?? [],
    getOrderExecution: () => orderExecution,
    getAutoTrader: () => autoTrader,
    getDayLevels: todayDayLevels,
    getSessionCandles: (s) => currentCandleTracker?.getSessionCandles(s) ?? [],
  });

  await server.listen({ port: PORT, host: "0.0.0.0" });
  orderExecution.start();
  autoTrader.start();
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
    if (stockFilterInstance) stockFilterInstance.stop();
    if (signalWorkerInstance) signalWorkerInstance.stop();
    if (levelsWorkerInstance) levelsWorkerInstance.stop();
    if (accuracyServiceInstance) accuracyServiceInstance.stop();
    if (trackingServiceInstance) trackingServiceInstance.stop();
    if (aiCallServiceInstance) aiCallServiceInstance.stop();
    if (aiOutcomeServiceInstance) aiOutcomeServiceInstance.stop();
    orderExecution.stop();
    autoTrader.stop();
    if (historyBackfillInstance) historyBackfillInstance.stop();
    if (broadcastStop) broadcastStop();
    if (tickerDisconnect) tickerDisconnect();
    if (wsManager) wsManager.close();
    await redisService.close();
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
