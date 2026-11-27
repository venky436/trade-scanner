import type {
  Bias,
  Candle,
  ConfidenceLabel,
  IndexDirection,
  IntelligenceMomentum,
  IntelligenceMomentumLabel,
  IntelligencePressure,
  IntelligencePressureLabel,
  IntelligenceSnapshot,
  IntelligenceVolatility,
  MarketCondition,
  MarketContext,
  MomentumResult,
  Outlook,
  PressureResult,
  SRZone,
  SupportResistanceResult,
  TradePlan,
  VolatilityLabel,
  Zone,
} from "./types.js";
import { isIndexSymbol } from "./index-symbols.js";
import { computeATR } from "./atr.js";
import { getFutureDisplayName } from "../services/instrument.service.js";
import { evaluateDayLevels, type DayLevel, type DayLevels, type DayLevelSetup } from "./day-levels.js";

export interface IntelligenceInput {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
  timestamp: number;
  pressure: PressureResult | null;
  momentum: MomentumResult | null;
  sr: SupportResistanceResult | null;
  // Optional rolling-window OHLC (last N five-min candles) for "current chaos"
  // volatility. When ≥ 3 candles supplied, used instead of session high/low.
  recentCandles?: Candle[];
  // DAY LEVELS (2026-11-10): the frozen S1–S3 / R1–R3 lines for today.
  //   undefined → old behaviour (single nearest S/R from `sr`) — callers that
  //               have not opted in (sections, AI, …) are unchanged.
  //   null      → opted in but today's lines are not ready yet → no call.
  dayLevels?: DayLevels | null;
  // Today's CLOSED 5-min candles, oldest first (needed with dayLevels to know
  // which lines are already broken). Falls back to recentCandles.
  sessionCandles?: Candle[];
}

const NEAR_ZONE_PERCENT = 1.0; // ≤ 1% from a level counts as "near"

const MOMENTUM_LABEL_MAP: Record<MomentumResult["signal"], IntelligenceMomentumLabel> = {
  STRONG_UP: "STRONG_UP",
  UP: "WEAK_UP",
  FLAT: "NEUTRAL",
  DOWN: "WEAK_DOWN",
  STRONG_DOWN: "STRONG_DOWN",
};

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// Derive implied signal direction from zone + raw momentum value.
// This avoids circular dependency: zone → direction → confidence → outlook.
type ImpliedDirection = "BUY" | "SELL" | "NEUTRAL";

function getImpliedDirection(zone: Zone, momentumValue: number): ImpliedDirection {
  if (zone === "MID_RANGE") return "NEUTRAL";
  // At resistance: positive momentum → breakout (BUY), negative → rejection (SELL)
  // At support: positive momentum → bounce (BUY), negative → breakdown (SELL)
  if (momentumValue > 0) return "BUY";
  if (momentumValue < 0) return "SELL";
  return "NEUTRAL";
}

// Only count the component if it aligns with the expected direction.
function getDirectionalScore(value: number, direction: ImpliedDirection): number {
  if (direction === "BUY") return Math.max(value, 0);
  if (direction === "SELL") return Math.max(-value, 0);
  return 0;
}

function computeZone(
  price: number,
  sr: SupportResistanceResult | null,
): { zone: Zone; distanceToLevel: number | null; level: number | null; srZone: SRZone | null } {
  const supportZone = sr?.supportZone ?? null;
  const resistanceZone = sr?.resistanceZone ?? null;

  const sDist = supportZone && price > 0
    ? (Math.abs(price - supportZone.level) / price) * 100
    : Infinity;
  const rDist = resistanceZone && price > 0
    ? (Math.abs(price - resistanceZone.level) / price) * 100
    : Infinity;

  const sNear = sDist <= NEAR_ZONE_PERCENT;
  const rNear = rDist <= NEAR_ZONE_PERCENT;

  if (rNear && (!sNear || rDist <= sDist)) {
    return { zone: "NEAR_RESISTANCE", distanceToLevel: round2(rDist), level: resistanceZone!.level, srZone: resistanceZone };
  }
  if (sNear) {
    return { zone: "NEAR_SUPPORT", distanceToLevel: round2(sDist), level: supportZone!.level, srZone: supportZone };
  }
  return { zone: "MID_RANGE", distanceToLevel: null, level: null, srZone: null };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildMomentum(m: MomentumResult | null): IntelligenceMomentum {
  if (!m) return { label: "NEUTRAL", score: 0 };
  const label = MOMENTUM_LABEL_MAP[m.signal] ?? "NEUTRAL";
  const score = clamp01(Math.abs(m.value));
  return { label, score };
}

function buildPressure(p: PressureResult | null): IntelligencePressure {
  if (!p) return { label: "NEUTRAL", score: 0 };
  let label: IntelligencePressureLabel;
  if (p.signal === "STRONG_BUY" || p.signal === "BUY") label = "BUY";
  else if (p.signal === "STRONG_SELL" || p.signal === "SELL") label = "SELL";
  else label = "NEUTRAL";
  return { label, score: clamp01(Math.abs(p.value)) };
}

// Volatility from intraday range. Prefers a rolling window of the last N
// five-min candles ("current chaos"); falls back to today's session high/low
// when fewer than 3 recent candles are available (cold start, fresh symbol,
// server restart). Bands match score-engine.ts for stocks; ~3× more sensitive
// for indices (typical NIFTY intraday range is 0.3–1.0%, vs stocks 1–5%).
function buildVolatility(
  price: number,
  sessionHigh: number,
  sessionLow: number,
  recentCandles?: Candle[],
  isIndex = false,
): IntelligenceVolatility {
  if (price <= 0) return { label: "LOW", score: 0.2 };

  let high: number;
  let low: number;
  if (recentCandles && recentCandles.length >= 3) {
    // Explicit 6-candle (~30 min) window. Callers may pass longer arrays
    // (e.g. 21 candles for the volume gate) — slice here so volatility's
    // effective window is unchanged regardless of caller buffer size.
    const window = recentCandles.slice(-6);
    high = -Infinity;
    low = Infinity;
    for (const c of window) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
    }
  } else if (sessionHigh > 0 && sessionLow > 0) {
    high = sessionHigh;
    low = sessionLow;
  } else {
    return { label: "LOW", score: 0.2 };
  }

  if (!Number.isFinite(high) || !Number.isFinite(low) || high <= 0 || low <= 0) {
    return { label: "LOW", score: 0.2 };
  }

  const range = (high - low) / price;
  let score: number;
  if (isIndex) {
    if (range >= 0.012) score = 1.0;       // 1.2%+
    else if (range >= 0.008) score = 0.8;  // 0.8%+
    else if (range >= 0.005) score = 0.6;  // 0.5%+
    else if (range >= 0.003) score = 0.4;  // 0.3%+
    else score = 0.2;
  } else {
    if (range >= 0.03) score = 1.0;
    else if (range >= 0.02) score = 0.8;
    else if (range >= 0.01) score = 0.6;
    else if (range >= 0.005) score = 0.4;
    else score = 0.2;
  }

  const label: VolatilityLabel = score >= 0.7 ? "HIGH" : score >= 0.4 ? "MEDIUM" : "LOW";
  return { label, score };
}

// Direction-aware confidence:
// Only count momentum/pressure that ALIGNS with the implied direction.
// Wrong-direction strength contributes 0, not inflated confidence.
// Minimum alignment check: both < 0.2 → cap at 0.1 to filter fake weak signals.
function buildConfidence(
  momentumValue: number,
  pressureValue: number,
  volatilityScore: number,
  direction: ImpliedDirection,
): { confidence: number; confidenceLabel: ConfidenceLabel } {
  const alignedMomentum = getDirectionalScore(momentumValue, direction);
  const alignedPressure = getDirectionalScore(pressureValue, direction);

  // Minimum alignment check: if both components are too weak, cap confidence
  if (alignedMomentum < 0.2 && alignedPressure < 0.2) {
    return { confidence: round2(clamp01(alignedMomentum + alignedPressure)), confidenceLabel: "LOW" };
  }

  const base = alignedMomentum * 0.5 + alignedPressure * 0.5;
  const amplifier = 1 - volatilityScore * 0.15;
  const confidence = clamp01(base * amplifier);
  const confidenceLabel: ConfidenceLabel =
    confidence > 0.7 ? "HIGH" : confidence > 0.5 ? "MEDIUM" : "LOW";
  return { confidence: round2(confidence), confidenceLabel };
}

// ── Outlook: a call only AFTER the level gives its answer ───────────────────
//
// Changed 2026-11-09 (user rule): never call while price is merely AT
// support / resistance — strong buying INTO resistance (or selling into
// support) is a test, not a signal. Wait for the LAST CLOSED 5-min candle to
// show the answer, and require momentum + pressure to agree:
//
//   at RESISTANCE
//     BREAKOUT  → BUY   last candle CLOSED ABOVE the zone (zone.max)
//                       + momentum up + pressure buying + volume surge
//     REJECTION → SELL  price tested the zone (high ≥ zone.min in the last
//                       2 candles), last candle CLOSED BACK BELOW it (zone.min)
//                       as a red candle + momentum down + pressure selling
//   at SUPPORT
//     BREAKDOWN → SELL  last candle CLOSED BELOW the zone (zone.min)
//                       + momentum down + pressure selling + volume surge
//     BOUNCE    → BUY   price tested the zone (low ≤ zone.max in the last 2
//                       candles), last candle CLOSED BACK ABOVE it (zone.max)
//                       as a green candle + momentum up + pressure buying
//   anything else (still inside the zone, no closed candle, engines disagree)
//     → NO_CLEAR_EDGE = WAIT
//
// One closed candle is enough (user's choice). The HIGH-confidence floor and
// the volume surge gate on breakouts / breakdowns are kept from before.
// Indices: no breakout / breakdown (no traded volume) — as before.
//
// Volume surge: last closed candle ≥ 1.5 × MEDIAN volume of the 5 before it
// (median, not mean: one earlier spike must not inflate the baseline).

const VOLUME_SURGE_MULTIPLIER = 1.5;
const VOLUME_LOOKBACK = 5;

function passesVolumeGate(recentCandles?: Candle[]): boolean {
  if (!recentCandles || recentCandles.length < VOLUME_LOOKBACK + 1) return false;
  const current = recentCandles[recentCandles.length - 1];
  const prior = recentCandles.slice(-(VOLUME_LOOKBACK + 1), -1);
  const sortedVols = prior.map((c) => c.volume).sort((a, b) => a - b);
  const median = sortedVols[Math.floor(sortedVols.length / 2)];
  if (median <= 0) return false;
  return current.volume >= median * VOLUME_SURGE_MULTIPLIER;
}

function buildOutlook(
  zone: Zone,
  srZone: SRZone | null,
  momentumLabel: IntelligenceMomentumLabel,
  pressureLabel: IntelligencePressureLabel,
  confidenceLabel: ConfidenceLabel,
  isIndex: boolean,
  recentCandles: Candle[] | undefined,
): Outlook {
  if (zone === "MID_RANGE" || !srZone) return "NO_CLEAR_EDGE";
  if (confidenceLabel !== "HIGH") return "NO_CLEAR_EDGE";

  const last = recentCandles?.[recentCandles.length - 1];
  const prev = recentCandles && recentCandles.length >= 2 ? recentCandles[recentCandles.length - 2] : undefined;
  if (!last) return "NO_CLEAR_EDGE"; // no closed candle → nothing confirmed yet

  const momentumUp = momentumLabel === "STRONG_UP" || momentumLabel === "WEAK_UP";
  const momentumDown = momentumLabel === "STRONG_DOWN" || momentumLabel === "WEAK_DOWN";
  const buyers = pressureLabel === "BUY";
  const sellers = pressureLabel === "SELL";

  if (zone === "NEAR_RESISTANCE") {
    // Breakout: closed above the resistance zone
    if (last.close > srZone.max) {
      if (isIndex) return "NO_CLEAR_EDGE";
      return momentumUp && buyers && passesVolumeGate(recentCandles) ? "BREAKOUT_LIKELY" : "NO_CLEAR_EDGE";
    }
    // Rejection: tested the zone, then closed back below it as a red candle
    const tested = Math.max(last.high, prev?.high ?? -Infinity) >= srZone.min;
    if (tested && last.close < srZone.min && last.close < last.open && momentumDown && sellers) {
      return "REJECTION_POSSIBLE";
    }
    return "NO_CLEAR_EDGE"; // still testing the level → WAIT
  }

  // NEAR_SUPPORT
  // Breakdown: closed below the support zone
  if (last.close < srZone.min) {
    if (isIndex) return "NO_CLEAR_EDGE";
    return momentumDown && sellers && passesVolumeGate(recentCandles) ? "BREAKDOWN_RISK" : "NO_CLEAR_EDGE";
  }
  // Bounce: tested the zone, then closed back above it as a green candle
  const tested = Math.min(last.low, prev?.low ?? Infinity) <= srZone.max;
  if (tested && last.close > srZone.max && last.close > last.open && momentumUp && buyers) {
    return "BOUNCE_EXPECTED";
  }
  return "NO_CLEAR_EDGE"; // still testing the level → WAIT
}

// ── Trade plan ──────────────────────────────────────────────────────────────
// Translate the Outlook into an explicit BUY/SELL with entry / stop-loss /
// target, anchored to the support/resistance LEVEL the call is about.
// The outlook already encodes the confirmed level answer, direction, the
// HIGH-confidence floor and (for Breakout / Breakdown) the volume gate.
//
// Two level rules (replay 154 stocks × 14 days, 2026-11-09):
//   Fix 1 — "near" means really near: price must be within
//           NEAR_LEVEL_MAX_ATR typical 5-min candles (ATR) of the level,
//           otherwise the move already happened → no plan (no late calls).
//   Fix 3 — stop-loss just beyond the level zone (BUY: below the zone's
//           bottom, SELL: above its top) by LEVEL_SL_BUFFER_ATR × ATR;
//           target = 2 × that risk (2:1 reward:risk).
// "Level" = the zone the call is about: support for Bounce / Breakdown,
// resistance for Rejection / Breakout (the zone computeZone picked).

export const NEAR_LEVEL_MAX_ATR = 1.5;
export const LEVEL_SL_BUFFER_ATR = 0.2;
const REWARD_RISK = 2;
const TRADE_PLAN_MIN_CONFIDENCE = 0.7;

function outlookToAction(outlook: Outlook): "BUY" | "SELL" | null {
  if (outlook === "BOUNCE_EXPECTED" || outlook === "BREAKOUT_LIKELY") return "BUY";
  if (outlook === "REJECTION_POSSIBLE" || outlook === "BREAKDOWN_RISK") return "SELL";
  return null;
}

// Resolve an ATR figure with fallback chain. Always returns a positive number
// for positive prices — the final fallback is 0.5% of price so the caller
// never has to handle null. Fallback chain:
//   1. 14-period ATR (≥ 15 candles)
//   2. 7-period ATR (≥ 8 candles)
//   3. volatility-score derived (price × score × 0.01, ≈ 0.2%–1% of price)
//   4. Hard floor of 0.5% of price
function resolveAtr(price: number, recentCandles: Candle[] | undefined, volatilityScore: number): number {
  if (price <= 0) return 0;
  const atr14 = computeATR(recentCandles, 14);
  if (atr14 != null && atr14 > 0) return atr14;
  const atr7 = computeATR(recentCandles, 7);
  if (atr7 != null && atr7 > 0) return atr7;
  // Volatility score sits in [0.2, 1.0]. Multiplying by 0.01 gives 0.2%-1% of
  // price — same order of magnitude as a real ATR.
  const fromScore = price * volatilityScore * 0.01;
  if (fromScore > 0) return fromScore;
  return price * 0.005;
}

function buildTradePlan(
  price: number,
  outlook: Outlook,
  confidence: number,
  recentCandles: Candle[] | undefined,
  volatilityScore: number,
  srZone: Pick<SRZone, "level" | "min" | "max"> | null,
  nearMaxAtr: number = NEAR_LEVEL_MAX_ATR,
): TradePlan | null {
  const action = outlookToAction(outlook);
  if (!action) return null;
  if (confidence < TRADE_PLAN_MIN_CONFIDENCE) return null;
  if (price <= 0 || !srZone) return null;

  const atr = resolveAtr(price, recentCandles, volatilityScore);
  if (atr <= 0) return null;

  // Fix 1 — too far from the level → the move already happened, no call
  if (Math.abs(price - srZone.level) > nearMaxAtr * atr) return null;

  // Fix 3 — stop just beyond the level zone, target 2 × risk
  const stopLoss = action === "BUY" ? srZone.min - LEVEL_SL_BUFFER_ATR * atr : srZone.max + LEVEL_SL_BUFFER_ATR * atr;
  const stopDist = action === "BUY" ? price - stopLoss : stopLoss - price;
  if (!(stopDist > 0)) return null; // price already beyond the stop → no valid plan
  const targetDist = stopDist * REWARD_RISK;

  return {
    action,
    entry: round2(price),
    stopLoss: round2(stopLoss),
    target: round2(action === "BUY" ? price + targetDist : price - targetDist),
    riskPercent: round2((stopDist / price) * 100),
    rewardPercent: round2((targetDist / price) * 100),
    riskReward: REWARD_RISK,
    atr: round2(atr),
  };
}

function buildBias(momentumLabel: IntelligenceMomentumLabel, pressureLabel: IntelligencePressureLabel): Bias {
  const momentumUp = momentumLabel === "STRONG_UP" || momentumLabel === "WEAK_UP";
  const momentumDown = momentumLabel === "STRONG_DOWN" || momentumLabel === "WEAK_DOWN";
  if (momentumUp && pressureLabel === "BUY") return "BULLISH";
  if (momentumDown && pressureLabel === "SELL") return "BEARISH";
  return "NEUTRAL";
}

// ── Day-level path (frozen S1–S3 / R1–R3, user decision 2026-11-10) ─────────
// The LINE decides WHAT happened (lib/day-levels.ts: bounce / rejection /
// breakout / breakdown on the last closed candle, broken lines, stock done).
// CONFIDENCE only measures how strong the move is (aligned momentum +
// pressure, as before) — distance from the line is NOT part of it.
// A separate "too late" rule: price must still be within DAY_LEVEL_LATE_ATR
// typical 5-min candles (ATR) of the line, otherwise no plan.
export const DAY_LEVEL_LATE_ATR = 1.0;

const SETUP_OUTLOOK: Record<DayLevelSetup, Outlook> = {
  BOUNCE: "BOUNCE_EXPECTED",
  REJECTION: "REJECTION_POSSIBLE",
  BREAKOUT: "BREAKOUT_LIKELY",
  BREAKDOWN: "BREAKDOWN_RISK",
};

function dayLevelView(input: IntelligenceInput, dayLevels: DayLevels | null) {
  const empty = { zone: "MID_RANGE" as Zone, distanceToLevel: null as number | null, level: null as DayLevel | null, setup: null as DayLevelSetup | null, side: null as "BUY" | "SELL" | null, done: false };
  if (!dayLevels || dayLevels.levels.length === 0 || input.price <= 0) return empty;
  const state = evaluateDayLevels(dayLevels, input.sessionCandles ?? input.recentCandles ?? []);
  const zoneOf = (l: DayLevel): Zone => (l.kind === "SUPPORT" ? "NEAR_SUPPORT" : "NEAR_RESISTANCE");
  const dist = (l: DayLevel) => round2((Math.abs(input.price - l.level) / input.price) * 100);
  if (state.event) {
    const l = state.event.level;
    return { zone: zoneOf(l), distanceToLevel: dist(l), level: l, setup: state.event.setup, side: state.event.side, done: state.done };
  }
  if (state.done) return { ...empty, done: true };
  // no event: show the nearest UNBROKEN line within 1 % (for the watch list)
  const near = dayLevels.levels
    .filter((l) => !state.broken.includes(l.name) && dist(l) <= NEAR_ZONE_PERCENT)
    .sort((a, b) => dist(a) - dist(b))[0];
  return near ? { ...empty, zone: zoneOf(near), distanceToLevel: dist(near), level: near } : empty;
}

export function toIntelligence(input: IntelligenceInput): IntelligenceSnapshot {
  if (input.dayLevels !== undefined) return toIntelligenceDayLevels(input, input.dayLevels);
  const isIndex = isIndexSymbol(input.symbol);
  const { zone, distanceToLevel, level, srZone } = computeZone(input.price, input.sr);
  const momentum = buildMomentum(input.momentum);
  // Pressure is structurally unmeasurable for indices (Kite index ticks
  // carry volume=0). Show NOT_APPLICABLE so the UI renders an honest "N/A"
  // instead of fake-neutral readings. Stocks use the volume-weighted
  // pressure engine as before.
  const pressure: IntelligencePressure = isIndex
    ? { label: "NOT_APPLICABLE", score: 0 }
    : buildPressure(input.pressure);
  const volatility = buildVolatility(input.price, input.high, input.low, input.recentCandles, isIndex);

  // Direction-aware pipeline: zone → direction → confidence → outlook
  const direction = getImpliedDirection(zone, input.momentum?.value ?? 0);
  const { confidence, confidenceLabel } = buildConfidence(
    input.momentum?.value ?? 0,
    input.pressure?.value ?? 0,
    volatility.score,
    direction,
  );
  const outlook = buildOutlook(zone, srZone, momentum.label, pressure.label, confidenceLabel, isIndex, input.recentCandles);
  const bias = buildBias(momentum.label, pressure.label);
  const tradePlan = buildTradePlan(input.price, outlook, confidence, input.recentCandles, volatility.score, srZone);

  const change = input.close !== 0 ? ((input.price - input.close) / input.close) * 100 : 0;

  // Display name override — only populated for index-futures contracts
  // (the instrument loader populated futuresDisplayNames at server boot).
  const displayName = getFutureDisplayName(input.symbol);

  return {
    symbol: input.symbol,
    ...(displayName ? { displayName } : {}),
    price: input.price,
    change: round2(change),
    timestamp: input.timestamp,
    context: { zone, distanceToLevel, level },
    momentum,
    pressure,
    volatility,
    outlook,
    bias,
    confidence,
    confidenceLabel,
    tradePlan,
  };
}

function toIntelligenceDayLevels(input: IntelligenceInput, dayLevels: DayLevels | null): IntelligenceSnapshot {
  const isIndex = isIndexSymbol(input.symbol);
  const view = dayLevelView(input, dayLevels);
  const momentum = buildMomentum(input.momentum);
  const pressure: IntelligencePressure = isIndex ? { label: "NOT_APPLICABLE", score: 0 } : buildPressure(input.pressure);
  const volatility = buildVolatility(input.price, input.high, input.low, input.recentCandles, isIndex);

  // direction: the event's side; otherwise (watching a line) the momentum's
  const direction: ImpliedDirection = view.side ?? getImpliedDirection(view.zone, input.momentum?.value ?? 0);
  const { confidence, confidenceLabel } = buildConfidence(input.momentum?.value ?? 0, input.pressure?.value ?? 0, volatility.score, direction);

  let outlook: Outlook = "NO_CLEAR_EDGE";
  if (view.setup && confidenceLabel === "HIGH") {
    const up = momentum.label === "STRONG_UP" || momentum.label === "WEAK_UP";
    const down = momentum.label === "STRONG_DOWN" || momentum.label === "WEAK_DOWN";
    const buyers = pressure.label === "BUY";
    const sellers = pressure.label === "SELL";
    const ok =
      view.setup === "BOUNCE" ? up && buyers
      : view.setup === "REJECTION" ? down && sellers
      : view.setup === "BREAKOUT" ? !isIndex && up && buyers && passesVolumeGate(input.recentCandles)
      : !isIndex && down && sellers && passesVolumeGate(input.recentCandles); // BREAKDOWN
    if (ok) outlook = SETUP_OUTLOOK[view.setup];
  }
  const bias = buildBias(momentum.label, pressure.label);
  const tradePlan = buildTradePlan(input.price, outlook, confidence, input.recentCandles, volatility.score, view.level, DAY_LEVEL_LATE_ATR);

  const change = input.close !== 0 ? ((input.price - input.close) / input.close) * 100 : 0;
  const displayName = getFutureDisplayName(input.symbol);
  return {
    symbol: input.symbol,
    ...(displayName ? { displayName } : {}),
    price: input.price,
    change: round2(change),
    timestamp: input.timestamp,
    context: {
      zone: view.zone,
      distanceToLevel: view.distanceToLevel,
      level: view.level?.level ?? null,
      ...(view.level ? { levelName: view.level.name } : {}),
      ...(view.done ? { levelsDone: true } : {}),
    },
    momentum,
    pressure,
    volatility,
    outlook,
    bias,
    confidence,
    confidenceLabel,
    tradePlan,
  };
}

// Market context — derived from NIFTY 50 + NIFTY BANK quotes.
// Condition: TRENDING when |NIFTY day change| ≥ 0.3%, else SIDEWAYS.
const TRENDING_THRESHOLD_PERCENT = 0.3;

interface IndexQuoteLike {
  lastPrice: number;
  close: number;
}

function indexDirection(quote: IndexQuoteLike | null): { direction: IndexDirection; changePercent: number } {
  if (!quote || quote.close <= 0) return { direction: "FLAT", changePercent: 0 };
  const changePercent = ((quote.lastPrice - quote.close) / quote.close) * 100;
  let direction: IndexDirection;
  if (changePercent > 0.05) direction = "UP";
  else if (changePercent < -0.05) direction = "DOWN";
  else direction = "FLAT";
  return { direction, changePercent: round2(changePercent) };
}

export function buildMarketContext(
  niftyQuote: IndexQuoteLike | null,
  bankNiftyQuote: IndexQuoteLike | null,
): MarketContext {
  const nifty = indexDirection(niftyQuote);
  const bankNifty = indexDirection(bankNiftyQuote);
  const condition: MarketCondition =
    Math.abs(nifty.changePercent) >= TRENDING_THRESHOLD_PERCENT ? "TRENDING" : "SIDEWAYS";
  return { condition, nifty, bankNifty };
}
