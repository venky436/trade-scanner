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
  completed: Candle[]; // ring buffer, last 3 (for momentum/pattern)
  sessionCandles: Candle[]; // all candles for current trading day (for intraday S/R)
  sessionDate: string; // IST date string for session reset detection
  bucket: number; // Math.floor(timestamp / 300_000) — 5-min slot
  prevVolume: number;
}

const FIVE_MIN_MS = 300_000;
const MAX_SESSION_CANDLES = 75; // ~6.25 hours of 5-min candles

function getISTDate(): string {
  return new Date().toLocaleDateString("en-US", { timeZone: "Asia/Kolkata" });
}

export function createCandleTracker(config: CandleTrackerConfig) {
  const stateMap = new Map<string, SymbolState>();

  function processTick(
    symbol: string,
    price: number,
    volume: number,
    timestamp: number,
  ): void {
    const bucket = Math.floor(timestamp / FIVE_MIN_MS);
    let state = stateMap.get(symbol);

    if (!state) {
      // First tick — initialize
      stateMap.set(symbol, {
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
      });
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

      // Fire callback if we have 3+ completed candles
      if (state.completed.length >= 3) {
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

  return { processTick, getSessionCandles, getSessionCandleCount, getLastCandle };
}
