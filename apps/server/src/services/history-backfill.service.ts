/**
 * HISTORY BACKFILL — warm the engines right after Kite connects / the server
 * restarts, instead of waiting 15–20 minutes for live 5-min candles.
 *
 * For every tracked symbol (most active first):
 *   Kite historical 5-min candles for the last few days (incl. the candle
 *   forming right now)
 *     → candleTracker.seedHistory()   momentum / patterns / intraday S/R / RVOL
 *     → pressureEngine.seedFromCandles()   ESTIMATED pressure for the last 2
 *                                           closed candles
 *
 * Rolling, like a chart: the "last 2 candles" may include the previous day's
 * close; every live candle that closes pushes the oldest one out, so by the
 * 3rd live candle everything is today's / tick-based. Intraday S/R and RVOL
 * only ever use TODAY's candles.
 *
 * Paced under Zerodha's historical-data limit (~3 requests/s); a "Too many
 * requests" answer is retried with back-off. Runs once per Kite connect.
 */
import { KiteConnect } from "kiteconnect";
import type { Candle, InstrumentMaps } from "../lib/types.js";
import { estimatePressureCandles } from "../lib/pressure-from-candles.js";
import type { PressureEngine } from "./pressure.service.js";

interface HistoryBackfillConfig {
  apiKey: string;
  getAccessToken: () => string | null;
  getInstrumentMaps: () => InstrumentMaps | null;
  /** Most active symbols first (e.g. the stock filter's eligible list). */
  getPrioritySymbols: () => string[];
  candleTracker: { seedHistory: (symbol: string, candles: Candle[]) => void };
  pressureEngine: Pick<PressureEngine, "seedFromCandles">;
  requestsPerSecond?: number; // default 2.5
  lookbackDays?: number; // calendar days, default 5 (covers weekends / holidays)
  maxCandles?: number; // keep the newest N per symbol, default 120
}

const FIVE_MIN_MS = 300_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "2026-11-09" (IST date) */
function istDate(d: Date): string {
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
/** "2026-11-09 10:42:00" (IST wall clock — what Kite expects) */
function istDateTime(d: Date): string {
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 19).replace("T", " ");
}

export function createHistoryBackfill(config: HistoryBackfillConfig) {
  const rps = config.requestsPerSecond ?? 2.5;
  const lookbackDays = config.lookbackDays ?? 5;
  const maxCandles = config.maxCandles ?? 120;
  let running = false;
  let stopped = false;
  let progress = { done: 0, total: 0, failed: 0 };

  async function fetchCandles(kc: InstanceType<typeof KiteConnect>, token: number): Promise<Candle[]> {
    const now = new Date();
    const from = `${istDate(new Date(now.getTime() - lookbackDays * 86_400_000))} 09:00:00`;
    const to = istDateTime(now);
    for (let attempt = 1; ; attempt++) {
      try {
        const data = (await kc.getHistoricalData(token, "5minute" as any, from, to)) as any[];
        return data
          .map((d) => ({
            time: Math.floor(new Date(d.date).getTime() / 1000),
            open: Number(d.open),
            high: Number(d.high),
            low: Number(d.low),
            close: Number(d.close),
            volume: Number(d.volume ?? 0),
          }))
          .slice(-maxCandles);
      } catch (e: any) {
        if (attempt < 5 && /too many requests/i.test(String(e?.message ?? e))) {
          await sleep(1000 * attempt);
          continue;
        }
        throw e;
      }
    }
  }

  async function run(): Promise<{ loaded: number; failed: number; seconds: number }> {
    if (running) return { loaded: 0, failed: 0, seconds: 0 };
    const token = config.getAccessToken();
    const maps = config.getInstrumentMaps();
    if (!token || !maps) throw new Error("Kite not connected — cannot backfill");
    running = true;
    stopped = false;
    const started = Date.now();

    // Most active first, then everything else (no duplicates)
    const priority = config.getPrioritySymbols().filter((s) => maps.symbolToToken.has(s));
    const ordered = [...new Set([...priority, ...maps.symbols])];
    progress = { done: 0, total: ordered.length, failed: 0 };
    console.log(`[Backfill] Loading today's 5-min candles for ${ordered.length} symbols (${priority.length} most-active first)...`);

    const kc = new KiteConnect({ api_key: config.apiKey });
    kc.setAccessToken(token);
    const gapMs = 1000 / rps;

    try {
      for (const symbol of ordered) {
        if (stopped) break;
        const instrumentToken = maps.symbolToToken.get(symbol);
        if (instrumentToken === undefined) continue;
        const t0 = Date.now();
        try {
          const candles = await fetchCandles(kc, instrumentToken);
          if (candles.length > 0) {
            config.candleTracker.seedHistory(symbol, candles);
            // pressure estimates only from CLOSED candles (not the one forming now)
            const nowSlot = Math.floor(Date.now() / FIVE_MIN_MS);
            const closed = candles.filter((c) => Math.floor((c.time * 1000) / FIVE_MIN_MS) < nowSlot);
            config.pressureEngine.seedFromCandles(symbol, estimatePressureCandles(closed));
          }
        } catch (e: any) {
          progress.failed++;
          if (progress.failed <= 5) console.warn(`[Backfill] ${symbol} failed: ${e?.message ?? e}`);
        }
        progress.done++;
        if (progress.done % 100 === 0 || progress.done === priority.length) {
          console.log(`[Backfill] ${progress.done}/${progress.total} symbols loaded`);
        }
        const wait = gapMs - (Date.now() - t0);
        if (wait > 0) await sleep(wait);
      }
    } finally {
      running = false;
    }

    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(`[Backfill] ${stopped ? "Stopped" : "Done"}: ${progress.done - progress.failed}/${progress.total} symbols in ${seconds}s (${progress.failed} failed)`);
    return { loaded: progress.done - progress.failed, failed: progress.failed, seconds };
  }

  return {
    run,
    /** Abort a running backfill (re-login / shutdown). */
    stop() {
      stopped = true;
    },
    getProgress() {
      return { ...progress, running };
    },
  };
}

export type HistoryBackfill = ReturnType<typeof createHistoryBackfill>;
