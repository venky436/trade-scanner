// SMART ZONES service — today's Fair Value Gaps and Order Blocks that come after a
// CLEAR move, live. Standalone and display only: uses no engine, places no order.
// Detection = lib/smart-zones/smart-setups (the exact code tested and cross-checked
// in ~/Desktop/trading-scanner-v2, and checked by the user on real charts):
//   REVERSAL BUY  clear fall → bottom → turn → bullish FVG / OB
//   REVERSAL SELL clear rise → top → turn → bearish FVG / OB
//   TREND BUY / SELL  clear move still running → FVG / OB in the same direction
// Levels shown (the user's rule, lib/smart-zones/close-entry):
//   entry = close of the pattern's last candle (FVG candle 3 / OB break candle)
//   stop  = the pattern's first candle LOW (BUY) / HIGH (SELL)  (FVG candle 1 / OB block)
//   status follows the day: IN TRADE → STOP HIT, or CLOSED at the market close.
//
// Data: Zerodha's OFFICIAL 5-min candles (not the live tick tracker), so what is
// shown matches the backtest exactly.
//   • Once per day per stock: the last few days' candles (ATR warm-up).
//   • Every 5 minutes, 25 s after a candle closes (09:35:25 … 15:20:25):
//     today's candles for every stock → find the setups → update each one's status.
//   • Saved to data/smart-zones.json, so a restart shows the day's zones at once.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Candle } from "../lib/smart-zones/types.js";
import { atr } from "../lib/smart-zones/indicators.js";
import { sessionVwap } from "../lib/smart-zones/vwap.js";
import { istDate, istMin, hm } from "../lib/smart-zones/time.js";
import { findSmartSetups, type SmartSetup } from "../lib/smart-zones/smart-setups.js";
import { closeEntryTrade } from "../lib/smart-zones/close-entry.js";

export interface ZoneKite {
  getHistoricalData(token: number, interval: string, from: string, to: string): Promise<any[]>;
}

export type ZoneStatus = "IN_TRADE" | "STOPPED" | "CLOSED";

export interface SmartZone {
  id: string;
  symbol: string;
  type: "FVG" | "OB";
  kind: "REVERSAL" | "TREND";
  side: "BUY" | "SELL";
  formedAt: number; // epoch s when the pattern completed (= entry time)
  patternStartAt: number; // FVG candle 1 / OB block candle (open time, epoch s)
  zoneTop: number;
  zoneBottom: number;
  entry: number;
  stop: number;
  move: { fromAt: number; toAt: number; from: number; to: number; pct: number }; // the clear move before it
  status: ZoneStatus;
  exitAt: number | null;
  exitPrice: number | null;
  resultPct: number | null; // price move from entry, % (before charges), once closed
  resultR: number | null; // same, in units of the stop distance
}

export interface SmartZonesState {
  date: string;
  status: "WAITING_LOGIN" | "WAITING" | "SCANNING" | "LIVE" | "NO_SESSION";
  lastScanAt: number | null;
  progress: { done: number; total: number };
  zones: SmartZone[];
}

export interface SmartZonesConfig {
  getKite: () => ZoneKite | null;
  getStocks: () => { symbol: string; token: number }[];
  file?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  requestGapMs?: number;
}

const FIRST_SCAN = hm(9, 35) * 60 + 25; // seconds since IST midnight
const LAST_SCAN = hm(15, 20) * 60 + 25;
const IST_MS = 330 * 60_000;
const istSec = (ms: number) => {
  const d = new Date(ms + IST_MS);
  return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
};
const toCandle = (d: any): Candle => ({ t: Math.floor(new Date(d.date).getTime() / 1000), o: +d.open, h: +d.high, l: +d.low, c: +d.close, v: +(d.volume ?? 0) });
const minusDays = (date: string, n: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() - n * 86_400_000).toISOString().slice(0, 10);

/** One setup and its status given the candles closed so far (pure; exported for tests). */
export function zoneOf(symbol: string, c: Candle[], dayEnd: number, s: SmartSetup, nowSec: number): SmartZone | null {
  const first = s.strategy === "FVG" ? s.formedIdx - 2 : s.obIdx!;
  const t = closeEntryTrade(c, dayEnd, s.dir, s.formedIdx, first);
  if (!t) return null;
  const ctx = s.context;
  const lastMin = istMin(c[dayEnd - 1]!.t);
  // still open: no stop yet, the last closed candle is before 15:20 and the market is still open
  // (stocks whose candles end at 15:15 close with the market, not later)
  const open = t.reason === "CLOSE" && t.exitIdx === dayEnd - 1 && lastMin < hm(15, 20) && nowSec < hm(15, 25) * 60;
  const pct = Math.round(((t.dir * (t.exit - t.entry)) / t.entry) * 10_000) / 100;
  return {
    id: `${symbol}|${s.strategy}|${c[s.formedIdx]!.t}|${s.dir}`,
    symbol,
    type: s.strategy as "FVG" | "OB",
    kind: ctx.kind,
    side: s.dir === 1 ? "BUY" : "SELL",
    formedAt: c[s.formedIdx]!.t + 300,
    patternStartAt: c[first]!.t,
    zoneTop: s.zoneTop,
    zoneBottom: s.zoneBottom,
    entry: t.entry,
    stop: t.stop,
    move: { fromAt: c[ctx.legStart]!.t, toAt: c[ctx.legEnd]!.t, from: ctx.legFrom, to: ctx.legTo, pct: Math.round(ctx.movePct * 10_000) / 100 },
    status: open ? "IN_TRADE" : t.reason === "CLOSE" ? "CLOSED" : "STOPPED",
    exitAt: open ? null : t.reason === "CLOSE" ? c[t.exitIdx]!.t + 300 : c[t.exitIdx]!.t,
    exitPrice: open ? null : t.exit,
    resultPct: open ? null : pct,
    resultR: open ? null : Math.round(((t.dir * (t.exit - t.entry)) / Math.abs(t.entry - t.stop)) * 100) / 100,
  };
}

export function createSmartZonesService(config: SmartZonesConfig) {
  const file = config.file ?? "data/smart-zones.json";
  const now = config.now ?? (() => Date.now());
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const gap = config.requestGapMs ?? 350;

  const blank = (date: string): SmartZonesState => ({ date, status: "WAITING_LOGIN", lastScanAt: null, progress: { done: 0, total: 0 }, zones: [] });
  let state = blank(istDate(now() / 1000));
  const history = new Map<string, Candle[]>(); // symbol → candles BEFORE today (for ATR)
  let historyDate = "";
  let lastSlot = -1; // 5-min slot of the last finished scan
  let busy = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  try {
    const saved = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as SmartZonesState) : null;
    if (saved && saved.date === state.date) state = { ...saved, status: saved.zones.length ? "LIVE" : "WAITING" };
  } catch {
    /* start fresh */
  }

  async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (attempt < 5 && /too many requests/i.test(String((e as Error)?.message ?? e))) {
          await sleep(1000 * attempt);
          continue;
        }
        throw e;
      }
    }
  }

  async function scan(kite: ZoneKite, date: string) {
    const stocks = config.getStocks();
    if (historyDate !== date) {
      history.clear();
      historyDate = date;
    }
    state.status = "SCANNING";
    state.progress = { done: 0, total: stocks.length };
    const zones: SmartZone[] = [];
    let anyToday = false;
    for (const s of stocks) {
      try {
        if (!history.has(s.symbol)) {
          const rows = await withRetry(() => kite.getHistoricalData(s.token, "5minute", `${minusDays(date, 7)} 09:15:00`, `${minusDays(date, 1)} 15:30:00`));
          history.set(s.symbol, rows.map(toCandle).filter((x) => istDate(x.t) < date));
          await sleep(gap);
        }
        const rows = await withRetry(() => kite.getHistoricalData(s.token, "5minute", `${date} 09:15:00`, `${date} 15:30:00`));
        await sleep(gap);
        const cutoff = now() / 1000;
        const today = rows.map(toCandle).filter((x) => istDate(x.t) === date && x.t + 300 <= cutoff); // closed candles only
        if (today.length) anyToday = true;
        if (today.length < 3) continue;
        const c = [...history.get(s.symbol)!, ...today];
        const a = c.length - today.length, b = c.length;
        const at = atr(c, 14);
        const vw = sessionVwap(c, a, b);
        for (const st of findSmartSetups(c, at, vw, a, b)) {
          const z = zoneOf(s.symbol, c, b, st, istSec(now()));
          if (z) zones.push(z);
        }
      } catch {
        /* skip this stock for this scan */
      }
      state.progress.done++;
    }
    if (!anyToday && istSec(now()) > FIRST_SCAN + 600) {
      state = { ...blank(date), status: "NO_SESSION" };
      return;
    }
    state = { date, status: "LIVE", lastScanAt: now(), progress: state.progress, zones: zones.sort((x, y) => y.formedAt - x.formedAt) };
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(state));
    } catch (e) {
      console.error("[Zones] could not save:", (e as Error).message);
    }
    const n = (st: ZoneStatus) => zones.filter((z) => z.status === st).length;
    console.log(`[Zones] ${zones.length} setups (${zones.filter((z) => z.kind === "REVERSAL").length} reversal, ${zones.filter((z) => z.kind === "TREND").length} trend; ${n("IN_TRADE")} in trade, ${n("STOPPED")} stopped, ${n("CLOSED")} closed)`);
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const t = now(), date = istDate(t / 1000);
      if (state.date !== date) {
        state = blank(date);
        lastSlot = -1;
      }
      const wd = new Date(t + IST_MS).getUTCDay();
      if (wd === 0 || wd === 6) {
        state.status = "NO_SESSION";
        return;
      }
      if (state.status === "NO_SESSION") return;
      const kite = config.getKite();
      if (!kite || config.getStocks().length === 0) {
        if (state.zones.length === 0) state.status = "WAITING_LOGIN";
        return;
      }
      const sec = istSec(t);
      if (sec < FIRST_SCAN) {
        state.status = "WAITING";
        return;
      }
      if (sec > LAST_SCAN + 300) return; // day finished — keep the final list
      const slot = Math.floor((sec - 25) / 300); // the slot whose candle just closed
      if (slot === lastSlot) return;
      await scan(kite, date);
      lastSlot = slot;
    } catch (e) {
      console.error("[Zones] scan failed (will retry):", (e as Error).message);
      if (state.status === "SCANNING") state.status = state.zones.length ? "LIVE" : "WAITING";
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
    getState: (): SmartZonesState => state,
  };
}

export type SmartZonesService = ReturnType<typeof createSmartZonesService>;
