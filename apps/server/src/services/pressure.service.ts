/**
 * PRESSURE ENGINE — are buyers or sellers more aggressive right now?
 *
 * CHANGED to 5-minute candles (was 1 minute) so every engine works on the
 * same timeframe:
 *   1. Window = 5-minute candle.
 *   2. Windows are aligned to the clock — 09:15, 09:20, 09:25 … — using the
 *      SAME bucket rule as the candle tracker: bucket = floor(time / 5 min).
 *      (The old 1-min window started at whatever tick happened to arrive, so
 *      it drifted.) A pressure candle therefore covers exactly the same ticks
 *      as the 5-min price candle that momentum / patterns / intraday S/R use.
 *   3. The first window after we start tracking a symbol is PARTIAL (we joined
 *      mid-candle, earlier ticks were missed) → thrown away, not scored.
 *   4. Volume baseline = average volume per 5-min candle so far (was per minute).
 *   5. Each closed candle's own breakdown is kept (getRecentCandles).
 *
 * CHANGED 2026-11-09: the signal uses the last 2 candles weighted 0.3 / 0.7
 * (was 3 candles 0.2 / 0.3 / 0.5).
 *
 * UNCHANGED: the tick rule, the per-candle score formula, the ×1.15
 * consistency boost, the ±0.3 dead zone, the 0.3 / 0.6
 * signal thresholds, skipping indices, and the public API
 * (processTick / getPressure / getVersion / getAllPressure / getStats / reset).
 *
 * Warm-up: after a restart the window is SEEDED with estimated candles
 * from Zerodha's historical 5-min candles (seedFromCandles, see
 * history-backfill.service.ts), so pressure is available within minutes.
 * Each live candle that closes pushes the oldest estimate out; after 3 live
 * candles it is 100 % tick-based again. Without a seed: 2 FULL live candles
 * → ~10–15 min.
 *
 * How it works ("tick rule"):
 *   - Kite's volume is cumulative for the day, so traded qty since the last
 *     tick = volume - prevVolume.
 *   - Price went UP vs previous tick  → that qty counts as BUYER volume (+delta)
 *     Price went DOWN                 → SELLER volume (-delta)
 *     Price unchanged                 → counted in volume, not in delta
 *   - When the first tick of the NEXT 5-min slot arrives, the current candle
 *     closes and gets a score:
 *       deltaStrength  = delta / (buyerVol + sellerVol)        (-1 … +1)
 *       volumeStrength = clamp(thisCandleVol / avgVolPerCandle, 0, 1)
 *       score          = deltaStrength*0.7 + volumeStrength*0.3*sign(deltaStrength)
 *   - Last 2 scores → weighted 0.3 / 0.7 (newest heaviest);
 *     ×1.15 if both agree in direction; clamp ±1; |value| < 0.3 → 0 (dead zone)
 *   - Signal: >0.6 STRONG_BUY, >0.3 BUY, <-0.6 STRONG_SELL, <-0.3 SELL, else NEUTRAL
 *   - Indices are skipped (Kite index ticks have no traded volume).
 */
import type { PressureCandle, PressureResult, PressureSignal, PressureTrend } from "../lib/types.js";
import { isIndexSymbol } from "../lib/index-symbols.js";

/**
 * 5-minute slot size. MUST stay equal to FIVE_MIN_MS in candle-tracker.service.ts
 * so pressure candles and price candles cover the same ticks. Epoch-aligned
 * 5-min slots land on 09:15, 09:20 … in IST because IST (+5:30) is a whole
 * number of 5-min steps.
 */
export const PRESSURE_CANDLE_MS = 300_000;

interface TickInput {
  last_price: number;
  volume: number; // cumulative day volume
  timestamp: number; // epoch ms
}

interface TickState {
  prevPrice: number;
  prevVolume: number;
  bucket: number; // current 5-min slot = floor(timestamp / PRESSURE_CANDLE_MS)
  isPartial: boolean; // true for the first slot we see — we joined mid-candle
  // counters for the CURRENT candle (reset on every close)
  buyerVolume: number;
  sellerVolume: number;
  delta: number;
  candleVolume: number;
  // volume baseline across all scored candles (incl. the current one)
  totalVolumeProcessed: number;
  firstScoredBucket: number; // first full slot → baseline = total / slots elapsed
  closedCandles: PressureCandle[]; // ring buffer, max 3 (oldest first)
  currentPrice: number;
  firstTickTime: number;
  tickCount: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Pressure from the LAST 2 closed 5-min candles (changed 2026-11-09, was 3 ×
 * 0.2/0.3/0.5): previous × 0.3 + newest × 0.7, so the newest candle dominates
 * and a turn (buyers gone / sellers arriving) shows up one candle sooner.
 */
function getPressureForState(state: TickState): PressureResult | null {
  if (state.closedCandles.length < 2) return null;

  const scores = state.closedCandles.slice(-2).map((c) => c.score);
  let value = scores[0] * 0.3 + scores[1] * 0.7;

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

/** Zero the per-candle counters and move to the new 5-min slot. */
function startNextCandle(state: TickState, nextBucket: number): void {
  state.buyerVolume = 0;
  state.sellerVolume = 0;
  state.delta = 0;
  state.candleVolume = 0;
  state.bucket = nextBucket;
}

/**
 * Close the current 5-min candle. Returns true if a score was produced
 * (false for the discarded partial first candle).
 */
function closeCandle(symbol: string, state: TickState, nextBucket: number): boolean {
  // Joined mid-candle → its counts are incomplete. Throw it away and start the
  // volume baseline fresh from the next (first FULL) candle.
  if (state.isPartial) {
    state.isPartial = false;
    state.totalVolumeProcessed = 0;
    state.firstScoredBucket = nextBucket;
    startNextCandle(state, nextBucket);
    return false;
  }

  const totalVolume = state.buyerVolume + state.sellerVolume;
  const deltaStrength = totalVolume > 0 ? state.delta / totalVolume : 0;

  // Average volume per 5-min slot since the first full candle (slots with no
  // ticks at all count as zero-volume — same idea as the old "volume per
  // elapsed minute", just in 5-min units).
  const elapsedCandles = state.bucket - state.firstScoredBucket + 1;
  const avgCandleVolume = elapsedCandles >= 1 ? state.totalVolumeProcessed / elapsedCandles : 0;
  const volumeStrength = avgCandleVolume > 0 ? clamp(state.candleVolume / avgCandleVolume, 0, 1) : 0;

  // Pure flow score: order delta + volume confirmation. Momentum used to
  // contribute 0.3 here, but momentum is already an independent input to
  // confidence — counting it twice inflated momentum's effective weight.
  const combined = deltaStrength * 0.7 + volumeStrength * 0.3 * Math.sign(deltaStrength);

  state.closedCandles.push({
    time: (state.bucket * PRESSURE_CANDLE_MS) / 1000,
    buyerVolume: state.buyerVolume,
    sellerVolume: state.sellerVolume,
    delta: state.delta,
    volume: state.candleVolume,
    deltaStrength,
    volumeStrength,
    score: combined,
    bias: combined > 0 ? "BUY" : combined < 0 ? "SELL" : "NEUTRAL",
  });
  if (state.closedCandles.length > 3) state.closedCandles.shift();

  const candleNum = state.closedCandles.length;
  console.log(`[Pressure] ${symbol} 5-min candle #${candleNum} closed (score: ${combined.toFixed(2)}, delta: ${state.delta >= 0 ? "+" : ""}${state.delta})`);

  if (candleNum === 2) {
    const result = getPressureForState(state);
    if (result) {
      console.log(`[Pressure] ${symbol} ready — signal: ${result.signal} (${result.value.toFixed(2)})`);
    }
  }

  startNextCandle(state, nextBucket);
  return true;
}

export function createPressureEngine() {
  const stateMap = new Map<string, TickState>();
  // Bumped every time a SCORED candle closes — lets consumers skip
  // recomputation when nothing changed for a symbol.
  const versionMap = new Map<string, number>();
  // Estimated candles from the startup backfill for symbols that haven't
  // ticked yet — applied on their first tick.
  const pendingSeeds = new Map<string, PressureCandle[]>();

  /**
   * Put estimated candles in the rolling window BEHIND any live candles
   * (live ones are newer and always win). Only estimates older than the first
   * live candle and older than the slot currently forming are used.
   */
  function applySeed(state: TickState, est: PressureCandle[]): void {
    const live = state.closedCandles.filter((c) => !c.estimated);
    const firstLive = live[0]?.time ?? Infinity;
    const formingStart = (state.bucket * PRESSURE_CANDLE_MS) / 1000;
    const usable = est.filter((c) => c.time < firstLive && c.time < formingStart);
    state.closedCandles = [...usable, ...live].slice(-3);
  }

  /**
   * Seed a symbol with up to 3 ESTIMATED candles (from historical 5-min
   * candles) so pressure is available right after a restart instead of after
   * ~15–20 min. Rolling: each live candle that closes pushes an estimate out.
   */
  function seedFromCandles(symbol: string, est: PressureCandle[]): void {
    if (isIndexSymbol(symbol) || est.length === 0) return;
    const state = stateMap.get(symbol);
    if (!state) {
      pendingSeeds.set(symbol, est);
      return;
    }
    applySeed(state, est);
    versionMap.set(symbol, (versionMap.get(symbol) ?? 0) + 1);
  }

  function processTick(symbol: string, tick: TickInput): void {
    // Indices have no order-book volume — Kite index ticks carry volume=0,
    // so the engine would just accumulate empty state. Skip entirely:
    // saves cycles and prevents misleading "neutral pressure" downstream.
    if (isIndexSymbol(symbol)) return;

    const bucket = Math.floor(tick.timestamp / PRESSURE_CANDLE_MS);
    const state = stateMap.get(symbol);

    if (!state) {
      // First tick: only remember price + cumulative volume as the baseline.
      stateMap.set(symbol, {
        prevPrice: tick.last_price,
        prevVolume: tick.volume,
        bucket,
        isPartial: true,
        buyerVolume: 0,
        sellerVolume: 0,
        delta: 0,
        candleVolume: 0,
        totalVolumeProcessed: 0,
        firstScoredBucket: bucket + 1, // overwritten when the partial candle closes
        closedCandles: [],
        currentPrice: tick.last_price,
        firstTickTime: tick.timestamp,
        tickCount: 1,
      });
      const pending = pendingSeeds.get(symbol);
      if (pending) {
        applySeed(stateMap.get(symbol)!, pending);
        pendingSeeds.delete(symbol);
        versionMap.set(symbol, (versionMap.get(symbol) ?? 0) + 1);
      }
      console.log(`[Pressure] Tracking ${symbol} (${stateMap.size} symbols total)`);
      return;
    }

    state.tickCount++;
    state.currentPrice = tick.last_price;

    // Candle close check FIRST: this tick belongs to a new 5-min slot →
    // close the old candle before counting this tick into the new one.
    if (bucket !== state.bucket) {
      if (closeCandle(symbol, state, bucket)) {
        versionMap.set(symbol, (versionMap.get(symbol) ?? 0) + 1);
      }
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
    // Defensive: indices never get state populated (see processTick), but
    // guard the read path too in case any caller probes pre-existing state.
    if (isIndexSymbol(symbol)) return null;
    const state = stateMap.get(symbol);
    if (!state) return null;
    return getPressureForState(state);
  }

  /** The last ≤3 closed 5-min pressure candles, oldest first. */
  function getRecentCandles(symbol: string): PressureCandle[] {
    const state = stateMap.get(symbol);
    return state ? [...state.closedCandles] : [];
  }

  function getAllPressure(): Record<string, PressureResult> {
    const result: Record<string, PressureResult> = {};
    for (const [symbol] of stateMap) {
      const p = getPressure(symbol);
      if (p) result[symbol] = p;
    }
    return result;
  }

  // Same shape as before (admin endpoint /api/stocks/pressure-stats);
  // candleScores are now the scores of the last 3 FIVE-minute candles.
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
        candleScores: state.closedCandles.map((c) => c.score),
        totalVolume: state.totalVolumeProcessed,
        elapsedMinutes: Math.round(((Date.now() - state.firstTickTime) / 60_000) * 10) / 10,
      };
    }
    return result;
  }

  function reset(): void {
    stateMap.clear();
    pendingSeeds.clear();
  }

  function getVersion(symbol: string): number {
    return versionMap.get(symbol) ?? 0;
  }

  return { processTick, seedFromCandles, getPressure, getRecentCandles, getVersion, getAllPressure, getStats, reset };
}

export type PressureEngine = ReturnType<typeof createPressureEngine>;
