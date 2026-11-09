import type { Candle } from "../lib/types.js";

interface CandleTrackerConfig {
  onCandleClose: (symbol: string, completedCandles: Candle[]) => void;
}

interface SymbolState {
  currentCandle: {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    openTime: number;
  };
  completed: Candle[]; // ring buffer, last 3 (momentum/pressure use the last 2, patterns up to 3) — may include previous days after a backfill
  sessionCandles: Candle[]; // candles of the CURRENT trading day only (for intraday S/R, RVOL)
  sessionDate: string; // IST date string for session reset detection
  bucket: number; // Math.floor(timestamp / 300_000) — 5-min slot
  prevVolume: number;
  /** true while the candle forming now started mid-slot (first tick after a (re)start) */
  currentPartial: boolean;
  /** slot of the live candle that closed partial (prefer Zerodha's complete version of it) */
  partialSlot: number | null;
}

const FIVE_MIN_MS = 300_000;
const MAX_SESSION_CANDLES = 75; // ~6.25 hours of 5-min candles

function getISTDate(): string {
  return new Date().toLocaleDateString("en-US", { timeZone: "Asia/Kolkata" });
}

function istDateOf(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { timeZone: "Asia/Kolkata" });
}

/** 5-min slot of a candle (candle.time is unix SECONDS). */
function slotOf(c: Candle): number {
  return Math.floor((c.time * 1000) / FIVE_MIN_MS);
}

export function createCandleTracker(config: CandleTrackerConfig) {
  const stateMap = new Map<string, SymbolState>();
  // Historical candles for symbols that haven't ticked yet — applied on their first tick.
  const pendingHistory = new Map<string, Candle[]>();

  function processTick(
    symbol: string,
    price: number,
    volume: number,
    timestamp: number,
  ): void {
    const bucket = Math.floor(timestamp / FIVE_MIN_MS);
    let state = stateMap.get(symbol);

    if (!state) {
      // First tick — initialize (this candle started mid-slot → partial)
      state = {
        currentCandle: {
          open: price,
          high: price,
          low: price,
          close: price,
          volume: 0,
          openTime: timestamp,
        },
        completed: [],
        sessionCandles: [],
        sessionDate: getISTDate(),
        bucket,
        prevVolume: volume,
        currentPartial: true,
        partialSlot: null,
      };
      stateMap.set(symbol, state);
      const pending = pendingHistory.get(symbol);
      if (pending) {
        pendingHistory.delete(symbol);
        applyHistory(symbol, state, pending);
      }
      return;
    }

    // Volume diff (cumulative from Kite)
    const volumeDiff = volume > state.prevVolume ? volume - state.prevVolume : 0;
    state.prevVolume = volume;

    if (bucket !== state.bucket) {
      // Bucket changed — close current candle
      const closed: Candle = {
        time: Math.floor(state.currentCandle.openTime / 1000),
        open: state.currentCandle.open,
        high: state.currentCandle.high,
        low: state.currentCandle.low,
        close: state.currentCandle.close,
        volume: state.currentCandle.volume,
      };
      if (state.currentPartial) {
        state.partialSlot = state.bucket;
        state.currentPartial = false;
      }

      state.completed.push(closed);
      if (state.completed.length > 3) state.completed.shift();

      // Session candles: reset if new trading day, then append
      const today = getISTDate();
      if (state.sessionDate !== today) {
        state.sessionCandles = [];
        state.sessionDate = today;
      }
      state.sessionCandles.push(closed);
      if (state.sessionCandles.length > MAX_SESSION_CANDLES) state.sessionCandles.shift();

      // Fire callback once 2+ completed candles exist (momentum + pressure use the last 2)
      if (state.completed.length >= 2) {
        config.onCandleClose(symbol, [...state.completed]);
      }

      // Start new candle
      state.currentCandle = {
        open: price,
        high: price,
        low: price,
        close: price,
        volume: volumeDiff,
        openTime: timestamp,
      };
      state.bucket = bucket;
    } else {
      // Same bucket — update current candle
      state.currentCandle.high = Math.max(state.currentCandle.high, price);
      state.currentCandle.low = Math.min(state.currentCandle.low, price);
      state.currentCandle.close = price;
      state.currentCandle.volume += volumeDiff;
    }
  }

  /**
   * Merge Zerodha's historical 5-min candles into a symbol's state.
   *   - Closed candles: history + live, one per 5-min slot. Live candles win,
   *     EXCEPT the live candle that started mid-slot (partial) when history
   *     has that slot complete.
   *   - completed (momentum / patterns): last 3 — MAY be previous days; each
   *     new live candle pushes the oldest out (rolling).
   *   - sessionCandles (intraday S/R, RVOL): TODAY's candles only.
   *   - The candle forming right now: take its real open/high/low/volume from
   *     Zerodha (we only saw part of it).
   *   - Then fire onCandleClose so momentum / patterns / intraday S/R
   *     recompute immediately.
   */
  function applyHistory(symbol: string, state: SymbolState, history: Candle[]): void {
    const forming = state.bucket;
    const bySlot = new Map<number, Candle>();
    for (const c of history) {
      if (slotOf(c) < forming) bySlot.set(slotOf(c), c);
    }
    for (const c of [...state.sessionCandles, ...state.completed]) {
      const slot = slotOf(c);
      // the live candle that started mid-slot is incomplete → keep Zerodha's complete one
      if (slot === state.partialSlot && bySlot.has(slot)) continue;
      bySlot.set(slot, c);
    }
    const merged = [...bySlot.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);

    state.completed = merged.slice(-3);
    const today = getISTDate();
    state.sessionCandles = merged.filter((c) => istDateOf(c.time * 1000) === today).slice(-MAX_SESSION_CANDLES);
    state.sessionDate = today;

    const formingHist = history.find((c) => slotOf(c) === forming);
    if (formingHist && state.currentPartial) {
      const cur = state.currentCandle;
      cur.open = formingHist.open;
      cur.high = Math.max(cur.high, formingHist.high);
      cur.low = Math.min(cur.low, formingHist.low);
      cur.volume = Math.max(cur.volume, formingHist.volume);
      cur.openTime = formingHist.time * 1000;
      state.currentPartial = false;
    }

    if (state.completed.length >= 2) {
      config.onCandleClose(symbol, [...state.completed]);
    }
  }

  /**
   * Load historical 5-min candles (oldest first, from Kite) — used after a
   * (re)start so engines don't wait 15+ minutes for live candles.
   */
  function seedHistory(symbol: string, history: Candle[]): void {
    if (history.length === 0) return;
    const state = stateMap.get(symbol);
    if (!state) {
      pendingHistory.set(symbol, history);
      return;
    }
    applyHistory(symbol, state, history);
  }

  function getSessionCandles(symbol: string): Candle[] {
    const state = stateMap.get(symbol);
    if (!state) return [];
    // Reset check: if date changed, return empty
    const today = getISTDate();
    if (state.sessionDate !== today) return [];
    return state.sessionCandles;
  }

  function getSessionCandleCount(symbol: string): number {
    return getSessionCandles(symbol).length;
  }

  function getLastCandle(symbol: string): Candle | null {
    const candles = getSessionCandles(symbol);
    return candles.length > 0 ? candles[candles.length - 1] : null;
  }

  function getRecentCandles(symbol: string, n: number): Candle[] {
    const all = getSessionCandles(symbol);
    if (n <= 0 || all.length === 0) return [];
    return all.slice(-n);
  }

  return { processTick, seedHistory, getSessionCandles, getSessionCandleCount, getLastCandle, getRecentCandles };
}

export type CandleTracker = ReturnType<typeof createCandleTracker>;
