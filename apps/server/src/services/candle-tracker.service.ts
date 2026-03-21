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
  completed: Candle[]; // ring buffer, last 3
  bucket: number; // Math.floor(timestamp / 300_000) — 5-min slot
  prevVolume: number;
}

const FIVE_MIN_MS = 300_000;

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

  return { processTick };
}
