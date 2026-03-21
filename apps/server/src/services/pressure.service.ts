import type { PressureResult, PressureSignal, PressureTrend } from "../lib/types.js";

interface TickInput {
  last_price: number;
  volume: number;
  timestamp: number;
}

interface TickState {
  prevPrice: number;
  prevVolume: number;
  buyerVolume: number;
  sellerVolume: number;
  delta: number;
  candleVolume: number;
  candleOpenPrice: number;
  candleOpenTime: number;
  currentPrice: number;
  totalVolumeProcessed: number;
  firstTickTime: number;
  candleScores: number[]; // ring buffer, max 3
  tickCount: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getPressureForState(state: TickState): PressureResult | null {
  if (state.candleScores.length < 3) return null;

  const scores = state.candleScores;
  let value =
    scores[0] * 0.2 +
    scores[1] * 0.3 +
    scores[2] * 0.5;

  const allPositive = scores.every((s) => s > 0);
  const allNegative = scores.every((s) => s < 0);
  if (allPositive || allNegative) value *= 1.15;

  value = clamp(value, -1, 1);

  if (Math.abs(value) < 0.3) value = 0;

  let signal: PressureSignal;
  if (value > 0.6) signal = "STRONG_BUY";
  else if (value > 0.3) signal = "BUY";
  else if (value < -0.6) signal = "STRONG_SELL";
  else if (value < -0.3) signal = "SELL";
  else signal = "NEUTRAL";

  let trend: PressureTrend;
  if (allPositive) trend = "rising";
  else if (allNegative) trend = "falling";
  else trend = "mixed";

  return {
    value,
    signal,
    trend,
    confidence: Math.abs(value),
  };
}

function closeCandle(symbol: string, state: TickState, timestamp: number): void {
  const totalVolume = state.buyerVolume + state.sellerVolume;
  const deltaStrength = totalVolume > 0 ? state.delta / totalVolume : 0;

  const priceDiff = state.candleOpenPrice !== 0
    ? (state.currentPrice - state.candleOpenPrice) / state.candleOpenPrice
    : 0;
  const momentum = clamp(priceDiff / 0.003, -1, 1);

  const elapsedMinutes = (timestamp - state.firstTickTime) / 60_000;
  const avgCandleVolume = elapsedMinutes >= 1 ? state.totalVolumeProcessed / elapsedMinutes : 0;
  const volumeStrength = avgCandleVolume > 0 ? clamp(state.candleVolume / avgCandleVolume, 0, 1) : 0;

  const combined =
    deltaStrength * 0.5 +
    momentum * 0.3 +
    volumeStrength * 0.2 * Math.sign(deltaStrength);

  state.candleScores.push(combined);
  if (state.candleScores.length > 3) state.candleScores.shift();

  const candleNum = state.candleScores.length;
  console.log(`[Pressure] ${symbol} candle #${candleNum} closed (score: ${combined.toFixed(2)}, delta: ${state.delta >= 0 ? "+" : ""}${state.delta})`);

  if (candleNum === 3) {
    const result = getPressureForState(state);
    if (result) {
      console.log(`[Pressure] ${symbol} ready — signal: ${result.signal} (${result.value.toFixed(2)})`);
    }
  }

  // Reset for next candle
  state.buyerVolume = 0;
  state.sellerVolume = 0;
  state.delta = 0;
  state.candleVolume = 0;
  state.candleOpenPrice = state.currentPrice;
  state.candleOpenTime = timestamp;
}

export function createPressureEngine() {
  const stateMap = new Map<string, TickState>();
  const versionMap = new Map<string, number>();

  function processTick(symbol: string, tick: TickInput): void {
    let state = stateMap.get(symbol);

    if (!state) {
      stateMap.set(symbol, {
        prevPrice: tick.last_price,
        prevVolume: tick.volume,
        buyerVolume: 0,
        sellerVolume: 0,
        delta: 0,
        candleVolume: 0,
        candleOpenPrice: tick.last_price,
        candleOpenTime: tick.timestamp,
        currentPrice: tick.last_price,
        totalVolumeProcessed: 0,
        firstTickTime: tick.timestamp,
        candleScores: [],
        tickCount: 1,
      });
      console.log(`[Pressure] Tracking ${symbol} (${stateMap.size} symbols total)`);
      return;
    }

    state.tickCount++;
    state.currentPrice = tick.last_price;

    // Check candle close FIRST — must fire on every tick
    if (tick.timestamp - state.candleOpenTime >= 60_000) {
      closeCandle(symbol, state, tick.timestamp);
      versionMap.set(symbol, (versionMap.get(symbol) ?? 0) + 1);
    }

    const volumeDiff = tick.volume - state.prevVolume;
    if (volumeDiff <= 0) {
      // Volume reset or duplicate — just update price tracking
      state.prevPrice = tick.last_price;
      state.prevVolume = tick.volume;
      return;
    }

    // Classify volume by price direction
    if (tick.last_price > state.prevPrice) {
      state.buyerVolume += volumeDiff;
      state.delta += volumeDiff;
    } else if (tick.last_price < state.prevPrice) {
      state.sellerVolume += volumeDiff;
      state.delta -= volumeDiff;
    }

    state.candleVolume += volumeDiff;
    state.totalVolumeProcessed += volumeDiff;

    state.prevPrice = tick.last_price;
    state.prevVolume = tick.volume;
  }

  function getPressure(symbol: string): PressureResult | null {
    const state = stateMap.get(symbol);
    if (!state) return null;
    return getPressureForState(state);
  }

  function getAllPressure(): Record<string, PressureResult> {
    const result: Record<string, PressureResult> = {};
    for (const [symbol] of stateMap) {
      const p = getPressure(symbol);
      if (p) result[symbol] = p;
    }
    return result;
  }

  function getStats(): Record<string, {
    ticksSeen: number;
    candleScores: number[];
    totalVolume: number;
    elapsedMinutes: number;
  }> {
    const result: Record<string, {
      ticksSeen: number;
      candleScores: number[];
      totalVolume: number;
      elapsedMinutes: number;
    }> = {};
    for (const [symbol, state] of stateMap) {
      result[symbol] = {
        ticksSeen: state.tickCount,
        candleScores: [...state.candleScores],
        totalVolume: state.totalVolumeProcessed,
        elapsedMinutes: Math.round((Date.now() - state.firstTickTime) / 60_000 * 10) / 10,
      };
    }
    return result;
  }

  function reset(): void {
    stateMap.clear();
  }

  function getVersion(symbol: string): number {
    return versionMap.get(symbol) ?? 0;
  }

  return { processTick, getPressure, getVersion, getAllPressure, getStats, reset };
}

export type PressureEngine = ReturnType<typeof createPressureEngine>;
