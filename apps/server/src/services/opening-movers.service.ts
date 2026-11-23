// OPENING MOVERS service — standalone, display only. Uses no engine.
// Everything comes straight from Zerodha:
//   1. BASELINE (once per day, as soon as Kite is connected — any time
//      before or after the open): each stock's 5-min candles of the last
//      ~10 trading days → normal 09:15-candle volume (+ a fallback
//      yesterday's close). Saved to a file, so a restart doesn't refetch.
//   2. At 09:20:20 IST (first candle closed): Zerodha quotes for all stocks
//      (official yesterday's close + today's volume so far). Volume so far
//      ≥ 2× normal is a safe pre-filter: it already includes candle 1, so a
//      stock below it can never pass. Only those stocks' OFFICIAL 09:15
//      candle is fetched and checked with lib/opening-movers.ts.
//   3. The list is frozen for the day and saved (a restart reloads it).
// A stock whose 09:15 candle isn't published yet is retried every 20 s
// until 09:45.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  firstCandle,
  openingBaseline,
  openingSignal,
  istDateOf,
  OPENING_VOLUME_MULT,
  type OpeningCandle,
  type OpeningSignal,
} from "../lib/opening-movers.js";

/** The bits of KiteConnect this service uses (injectable for tests). */
export interface OpeningKite {
  getQuote(instruments: string[]): Promise<Record<string, any>>;
  getHistoricalData(token: number, interval: string, from: string, to: string): Promise<any[]>;
}

export interface OpeningMover extends OpeningSignal {
  symbol: string;
  prevClose: number;
  c1: OpeningCandle;
}

export type OpeningStatus =
  | "WAITING_LOGIN" // Kite not connected
  | "LOADING" // fetching the baseline
  | "WAITING" // baseline ready, waiting for 09:20
  | "COMPUTING"
  | "READY" // today's list is final
  | "NO_SESSION"; // weekend / holiday / no trading today

export interface OpeningMoversState {
  date: string;
  status: OpeningStatus;
  progress: { done: number; total: number };
  computedAt: number | null;
  checked: number; // stocks whose 09:15 candle was checked
  stocks: OpeningMover[];
  rule: string;
}

export interface OpeningMoversConfig {
  getKite: () => OpeningKite | null;
  /** Stocks to scan: symbol + Zerodha instrument token (no indices / futures). */
  getStocks: () => { symbol: string; token: number }[];
  file?: string; // default data/opening-movers.json
  baselineFile?: string; // default data/opening-baseline.json
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  requestGapMs?: number; // between historical requests, default 400 (2.5/s)
  maxPerSide?: number; // default 10
}

const COMPUTE_AT = 9 * 60 * 60 + 20 * 60 + 20; // 09:20:20 IST — first candle closed, seconds since midnight
const GIVE_UP_AT = 9 * 60 * 60 + 45 * 60; // stop waiting for missing 09:15 candles
const RULE = `BUY: the 09:15 candle closes above yesterday's close with volume ≥ ${OPENING_VOLUME_MULT}× normal. SELL: closes below.`;
const BASELINE_VERSION = 2; // 2 = normal volume of the 09:15 candle alone (1 = both opening candles)

function istSeconds(ms: number): number {
  const d = new Date(ms + 330 * 60_000);
  return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
}
function istWeekday(ms: number): number {
  return new Date(ms + 330 * 60_000).getUTCDay(); // 0 = Sunday
}
/** "YYYY-MM-DD" minus n calendar days */
function minusDays(date: string, n: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() - n * 86_400_000).toISOString().slice(0, 10);
}
const toCandle = (d: any): OpeningCandle => ({
  time: Math.floor(new Date(d.date).getTime() / 1000),
  open: Number(d.open),
  high: Number(d.high),
  low: Number(d.low),
  close: Number(d.close),
  volume: Number(d.volume ?? 0),
});

export function createOpeningMoversService(config: OpeningMoversConfig) {
  const file = config.file ?? "data/opening-movers.json";
  const baselineFile = config.baselineFile ?? "data/opening-baseline.json";
  const now = config.now ?? (() => Date.now());
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const gap = config.requestGapMs ?? 400;
  const maxPerSide = config.maxPerSide ?? 10;

  let state: OpeningMoversState = blank(istDateOf(now() / 1000));
  let baseline: { v?: number; date: string; map: Record<string, { prevClose: number; normalVolume: number }> } | null = null;
  let busy = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  function blank(date: string): OpeningMoversState {
    return { date, status: "WAITING_LOGIN", progress: { done: 0, total: 0 }, computedAt: null, checked: 0, stocks: [], rule: RULE };
  }
  function readJson<T>(path: string): T | null {
    try {
      return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
    } catch {
      return null;
    }
  }
  function writeJson(path: string, data: unknown) {
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(data));
    } catch (e) {
      console.error(`[Opening] could not save ${path}:`, (e as Error).message);
    }
  }

  async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (attempt < 6 && /too many requests/i.test(String((e as Error)?.message ?? e))) {
          await sleep(1000 * attempt);
          continue;
        }
        throw e;
      }
    }
  }

  async function loadBaseline(kite: OpeningKite, date: string) {
    const saved = readJson<typeof baseline>(baselineFile);
    if (saved && saved.v === BASELINE_VERSION && saved.date === date && Object.keys(saved.map).length > 0) {
      baseline = saved;
      return;
    }
    const stocks = config.getStocks();
    state.status = "LOADING";
    state.progress = { done: 0, total: stocks.length };
    const map: Record<string, { prevClose: number; normalVolume: number }> = {};
    const from = `${minusDays(date, 16)} 09:00:00`, to = `${minusDays(date, 1)} 15:30:00`;
    for (const s of stocks) {
      if (state.date !== date) return; // day changed mid-way
      try {
        const rows = await withRetry(() => kite.getHistoricalData(s.token, "5minute", from, to));
        const b = openingBaseline(rows.map(toCandle), date);
        if (b) map[s.symbol] = { prevClose: b.prevClose, normalVolume: b.normalVolume };
      } catch {
        // skipped for today (delisted / no data)
      }
      state.progress.done++;
      await sleep(gap);
    }
    baseline = { v: BASELINE_VERSION, date, map };
    writeJson(baselineFile, baseline);
    console.log(`[Opening] baseline ready: ${Object.keys(map).length}/${stocks.length} stocks`);
  }

  /** One pass at/after 09:20:20. Returns true when the day's list is final. */
  async function compute(kite: OpeningKite, date: string): Promise<boolean> {
    const base = baseline!.map;
    const stocks = config.getStocks().filter((s) => base[s.symbol]);
    state.status = "COMPUTING";
    // 1) quotes (≤ 250 per request): official yesterday's close + volume so far
    const quotes: Record<string, any> = {};
    for (let i = 0; i < stocks.length; i += 250) {
      const chunk = stocks.slice(i, i + 250).map((s) => `NSE:${s.symbol}`);
      Object.assign(quotes, await withRetry(() => kite.getQuote(chunk)));
      await sleep(1100);
    }
    const tradedToday = (q: any) => q?.last_trade_time && istDateOf(new Date(q.last_trade_time).getTime() / 1000) === date;
    const candidates = stocks.filter((s) => {
      const q = quotes[`NSE:${s.symbol}`];
      return tradedToday(q) && Number(q.volume ?? q.volume_traded ?? 0) >= OPENING_VOLUME_MULT * base[s.symbol]!.normalVolume;
    });
    if (candidates.length === 0 && !stocks.some((s) => tradedToday(quotes[`NSE:${s.symbol}`]))) {
      finish(date, "NO_SESSION", []);
      return true;
    }
    // 2) official 09:15 candle for the candidates
    const movers: OpeningMover[] = [];
    let missing = 0, checked = 0;
    for (const s of candidates) {
      try {
        const rows = await withRetry(() => kite.getHistoricalData(s.token, "5minute", `${date} 09:15:00`, `${date} 09:25:00`));
        const c1 = firstCandle(rows.map(toCandle), date);
        if (!c1) {
          missing++;
          continue;
        }
        checked++;
        const q = quotes[`NSE:${s.symbol}`];
        const prevClose = Number(q?.ohlc?.close) > 0 ? Number(q.ohlc.close) : base[s.symbol]!.prevClose;
        const sig = openingSignal(prevClose, base[s.symbol]!.normalVolume, c1);
        if (sig) movers.push({ symbol: s.symbol, prevClose, c1, ...sig });
      } catch {
        missing++;
      }
      await sleep(gap);
    }
    state.checked = checked;
    if (missing > 0 && istSeconds(now()) < GIVE_UP_AT) {
      state.status = "WAITING"; // some 09:15 candles not published yet → try again
      return false;
    }
    const pick = (side: "BUY" | "SELL") => movers.filter((m) => m.side === side).sort((a, b) => b.volumeX - a.volumeX).slice(0, maxPerSide);
    finish(date, "READY", [...pick("BUY"), ...pick("SELL")]);
    return true;
  }

  function finish(date: string, status: OpeningStatus, stocks: OpeningMover[]) {
    state = { ...state, date, status, computedAt: now(), stocks };
    writeJson(file, state);
    console.log(`[Opening] ${status}: ${stocks.filter((s) => s.side === "BUY").length} BUY, ${stocks.filter((s) => s.side === "SELL").length} SELL (checked ${state.checked})`);
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const t = now(), date = istDateOf(t / 1000);
      if (state.date !== date) state = blank(date);
      if (state.status === "READY" || state.status === "NO_SESSION") return;
      const saved = readJson<OpeningMoversState>(file);
      if (saved && saved.date === date && (saved.status === "READY" || saved.status === "NO_SESSION")) {
        state = { ...saved, rule: RULE };
        return;
      }
      const wd = istWeekday(t);
      if (wd === 0 || wd === 6) {
        state.status = "NO_SESSION";
        return;
      }
      const kite = config.getKite();
      if (!kite || config.getStocks().length === 0) {
        state.status = "WAITING_LOGIN";
        return;
      }
      if (!baseline || baseline.date !== date) await loadBaseline(kite, date);
      if (!baseline || baseline.date !== date) return;
      if (istSeconds(now()) < COMPUTE_AT) {
        state.status = "WAITING";
        return;
      }
      await compute(kite, date);
    } catch (e) {
      console.error("[Opening] failed (will retry):", (e as Error).message);
      if (state.status === "COMPUTING" || state.status === "LOADING") state.status = "WAITING";
    } finally {
      busy = false;
    }
  }

  return {
    start(everyMs = 20_000) {
      if (timer) return;
      void tick();
      timer = setInterval(() => void tick(), everyMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    tick,
    getState: (): OpeningMoversState => state,
  };
}

export type OpeningMoversService = ReturnType<typeof createOpeningMoversService>;
