import { KiteConnect } from "kiteconnect";
import type { Candle, InstrumentMaps, SupportResistanceResult } from "../lib/types.js";
import { getSupportResistance } from "./levels.service.js";
import { computeDayLevels, istDate, type DayLevels } from "../lib/day-levels.js";
import { marketDataService } from "./market-data.service.js";

interface LevelsWorkerConfig {
  apiKey: string;
  batchSize: number;
  intervalMs: number;
  getAccessToken: () => string | null;
  getInstrumentMaps: () => InstrumentMaps | null;
  onLevelsUpdate: (symbol: string, result: SupportResistanceResult) => void;
  /**
   * DAY LEVELS (2026-11-10): called ONCE per stock per trading day, as soon as
   * today's daily candle exists (i.e. after the 09:15 open) — the frozen
   * S1–S3 / R1–R3 lines. `getDayLevelsDate` tells the worker which day a stock
   * already has, so it never recomputes the same day.
   */
  onDayLevels?: (symbol: string, levels: DayLevels) => void;
  getDayLevelsDate?: (symbol: string) => string | null;
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

export function createLevelsWorker(config: LevelsWorkerConfig) {
  let symbolQueue: string[] = [];
  let queueIndex = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let isProcessing = false;
  let computedCount = 0;

  function buildPriorityQueue(symbols: string[]): string[] {
    // Priority ordering is already done by instrument.service.ts
    // (NIFTY_50 → NIFTY_NEXT_50 → EXTRA_STOCKS → rest)
    return symbols;
  }

  async function processBatch(): Promise<void> {
    if (isProcessing) return;
    isProcessing = true;

    try {
      const accessToken = config.getAccessToken();
      const maps = config.getInstrumentMaps();
      if (!accessToken || !maps) return;

      if (symbolQueue.length === 0) {
        symbolQueue = buildPriorityQueue([...maps.symbols]);
        queueIndex = 0;
        computedCount = 0;
      }

      const kc = new KiteConnect({ api_key: config.apiKey });
      kc.setAccessToken(accessToken);

      const to = new Date();
      const from = new Date();
      // 25 calendar days → ≥ 10 trading days BEFORE today even across holidays
      // (day levels need 10; the old S/R still uses only its last 10 candles)
      from.setDate(from.getDate() - 25);
      const today = istDate(Date.now());

      const end = Math.min(queueIndex + config.batchSize, symbolQueue.length);
      const batch = symbolQueue.slice(queueIndex, end);

      const promises = batch.map(async (symbol) => {
        const token = maps.symbolToToken.get(symbol);
        if (token === undefined) return;

        try {
          const data = await kc.getHistoricalData(
            token,
            "day" as any,
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
            const result = getSupportResistance(candles, price);
            config.onLevelsUpdate(symbol, result);
            computedCount++;
          }

          // Day levels: once per trading day, from the days BEFORE today,
          // around today's official open. No candle for today yet (before
          // 09:15, holiday, weekend) → nothing; tried again next cycle.
          if (config.onDayLevels && config.getDayLevelsDate?.(symbol) !== today) {
            const todayCandle = candles.find((c) => istDate(c.time * 1000) === today);
            if (todayCandle && todayCandle.open > 0) {
              const before = candles.filter((c) => istDate(c.time * 1000) < today);
              config.onDayLevels(symbol, computeDayLevels(before, todayCandle.open, today));
            }
          }
        } catch {
          // Symbol will be retried next cycle
        }
      });

      await Promise.allSettled(promises);

      queueIndex = end;

      // Log progress periodically
      if (computedCount > 0 && computedCount % 50 === 0) {
        console.log(`[Levels] Progress: ${computedCount}/${symbolQueue.length} computed`);
      }

      // Reset for next cycle
      if (queueIndex >= symbolQueue.length) {
        console.log(`[Levels] Full cycle complete: ${computedCount}/${symbolQueue.length} symbols`);
        queueIndex = 0;
        computedCount = 0;
      }
    } finally {
      isProcessing = false;
    }
  }

  return {
    start() {
      timer = setInterval(processBatch, config.intervalMs);
      timer.unref();
      console.log(`Levels worker started (batch: ${config.batchSize}, interval: ${config.intervalMs}ms)`);
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        console.log("Levels worker stopped");
      }
    },

    getCoverage(): { computed: number; total: number } {
      return { computed: computedCount, total: symbolQueue.length };
    },
  };
}

export type LevelsWorker = ReturnType<typeof createLevelsWorker>;
