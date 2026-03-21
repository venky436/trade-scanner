import { KiteConnect } from "kiteconnect";
import type { Candle, InstrumentMaps, SupportResistanceResult, MomentumResult, PatternSignal } from "../lib/types.js";
import { getSupportResistance } from "./levels.service.js";
import { getMomentum } from "../lib/momentum-engine.js";
import { detectPattern } from "../lib/pattern-engine.js";
import { redisService } from "./redis.service.js";

interface EodJobConfig {
  apiKey: string;
  getAccessToken: () => string | null;
  getInstrumentMaps: () => InstrumentMaps | null;
  onLevelComputed: (symbol: string, sr: SupportResistanceResult) => void;
  onMomentumComputed?: (symbol: string, result: MomentumResult) => void;
  onPatternComputed?: (symbol: string, result: PatternSignal) => void;
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

const BANNER = "════════════════════════════════════════════════════════";

export function createEodJob(config: EodJobConfig) {
  let isRunning = false;

  async function run(): Promise<{ levelsCount: number; avgVolCount: number; duration: number }> {
    if (isRunning) {
      console.log("[EOD JOB] Already running, skipping duplicate trigger");
      return { levelsCount: 0, avgVolCount: 0, duration: 0 };
    }

    const accessToken = config.getAccessToken();
    const maps = config.getInstrumentMaps();
    if (!accessToken || !maps) {
      throw new Error("Market data not initialized — cannot run EOD job");
    }

    isRunning = true;
    const startTime = Date.now();
    const symbols = maps.symbols;
    const symbolCount = symbols.length;

    // ── Banner: START ──
    console.log(BANNER);
    console.log(`[EOD JOB] STARTED at ${formatTime(startTime)}`);
    console.log(`[EOD JOB] Symbols to process: ${symbolCount} (already pre-filtered)`);
    console.log(`[EOD JOB] Redis: ${redisService.isAvailable() ? "connected" : "not available (in-memory only)"}`);
    console.log(BANNER);

    const kc = new KiteConnect({ api_key: config.apiKey });
    kc.setAccessToken(accessToken);

    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 25);

    let levelsCount = 0;
    let avgVolCount = 0;
    let failedCount = 0;
    let redisWritten = 0;

    const BATCH_SIZE = 10;

    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);

      const promises = batch.map(async (symbol) => {
        const token = maps.symbolToToken.get(symbol);
        if (token === undefined) return;

        try {
          const data = await kc.getHistoricalData(
            token, "day" as any,
            formatDate(from), formatDate(to),
          );

          const candles: Candle[] = data.map((d: any) => ({
            time: Math.floor(new Date(d.date).getTime() / 1000),
            open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume,
          }));

          if (candles.length < 2) return;

          const price = candles[candles.length - 1].close;

          if (price <= 0) return;

          // S/R levels
          const sr = getSupportResistance(candles, price);
          levelsCount++;
          config.onLevelComputed(symbol, sr);
          const saved = await redisService.setLevel(symbol, sr);
          if (saved) redisWritten++;

          // Momentum from last 3 daily candles
          if (candles.length >= 3) {
            const mom = getMomentum(candles.slice(-3));
            if (mom) config.onMomentumComputed?.(symbol, mom);
          }

          // Pattern from last 3 daily candles + S/R
          if (candles.length >= 3) {
            const pat = detectPattern({
              candles: candles.slice(-3),
              currentPrice: price,
              supportZone: sr.supportZone,
              resistanceZone: sr.resistanceZone,
              pressure: null,
            });
            if (pat) config.onPatternComputed?.(symbol, pat);
          }

          // Avg volume
          const recentCandles = candles.slice(-20);
          if (recentCandles.length > 0) {
            const totalVol = recentCandles.reduce((sum, c) => sum + c.volume, 0);
            const avgVol = Math.round(totalVol / recentCandles.length);
            avgVolCount++;
            await redisService.setAvgVolume(symbol, avgVol);
          }
        } catch {
          failedCount++;
        }
      });

      await Promise.allSettled(promises);

      const done = Math.min(i + BATCH_SIZE, symbols.length);
      if (done % 100 === 0 || done === symbols.length) {
        const pct = Math.round((done / symbolCount) * 100);
        console.log(`[EOD] Progress: ${done}/${symbolCount} (${pct}%)`);
      }
    }

    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);

    await redisService.setMeta({ timestamp: endTime, levelsCount, duration });

    // ── Banner: COMPLETE ──
    console.log(BANNER);
    console.log(`[EOD JOB] COMPLETED at ${formatTime(endTime)}`);
    console.log(`[EOD JOB] Duration: ${duration} seconds`);
    console.log(`[EOD JOB] Levels computed: ${levelsCount}/${symbolCount}`);
    console.log(`[EOD JOB] AvgVolumes computed: ${avgVolCount}/${symbolCount}`);
    console.log(`[EOD JOB] Failed: ${failedCount}`);
    console.log(`[EOD JOB] Redis: ${redisWritten > 0 ? `updated ${redisWritten} symbols` : "not available"}`);
    console.log(BANNER);

    isRunning = false;
    return { levelsCount, avgVolCount, duration };
  }

  return { run, isRunning: () => isRunning };
}

export type EodJob = ReturnType<typeof createEodJob>;
