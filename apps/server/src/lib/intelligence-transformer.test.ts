import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMarketContext, toIntelligence, type IntelligenceInput } from "./intelligence-transformer.js";
import { getMomentum } from "./momentum-engine.js";
import type { Candle, MomentumResult, PressureResult, SupportResistanceResult, SRZone } from "./types.js";

function makeZone(level: number, distancePercent: number): SRZone {
  return {
    min: level - 1,
    max: level + 1,
    level,
    touches: 3,
    strength: 1,
    confidence: 1,
    distancePercent,
    proximity: distancePercent <= 0.5 ? "VERY_CLOSE" : distancePercent <= 1 ? "NEAR" : "FAR",
    reaction: "NEUTRAL",
    zoneScore: 1,
    isActionable: distancePercent <= 1,
    directionHint: "NEUTRAL",
  };
}

function makeSr(opts: { support?: { level: number; dist: number }; resistance?: { level: number; dist: number } }): SupportResistanceResult {
  return {
    support: opts.support ? opts.support.level : null,
    resistance: opts.resistance ? opts.resistance.level : null,
    supportZone: opts.support ? makeZone(opts.support.level, opts.support.dist) : null,
    resistanceZone: opts.resistance ? makeZone(opts.resistance.level, opts.resistance.dist) : null,
    summary: { hasNearbySupport: !!opts.support, hasNearbyResistance: !!opts.resistance },
  };
}

function makeMomentum(signal: MomentumResult["signal"], value: number): MomentumResult {
  return {
    value,
    signal,
    acceleration: "STABLE",
    accelerationRaw: 0,
    quality: value,
  };
}

function makePressure(signal: PressureResult["signal"], value: number): PressureResult {
  return { value, signal, trend: "mixed", confidence: Math.abs(value) };
}

function baseInput(overrides: Partial<IntelligenceInput> = {}): IntelligenceInput {
  return {
    symbol: "TEST",
    price: 1000,
    open: 990,
    high: 1010,
    low: 985,
    close: 988,
    timestamp: Date.now(),
    pressure: null,
    momentum: null,
    sr: null,
    ...overrides,
  };
}

describe("toIntelligence — zone classification", () => {
  it("detects NEAR_RESISTANCE when price is within 1% below resistance", () => {
    const result = toIntelligence(baseInput({
      sr: makeSr({ resistance: { level: 1005, dist: 0.5 }, support: { level: 950, dist: 5.0 } }),
    }));
    assert.equal(result.context.zone, "NEAR_RESISTANCE");
    assert.equal(result.context.level, 1005);
  });

  it("detects NEAR_SUPPORT when price is within 1% above support", () => {
    const result = toIntelligence(baseInput({
      sr: makeSr({ support: { level: 995, dist: 0.5 }, resistance: { level: 1100, dist: 10 } }),
    }));
    assert.equal(result.context.zone, "NEAR_SUPPORT");
    assert.equal(result.context.level, 995);
  });

  it("returns MID_RANGE when both levels are >1% away", () => {
    const result = toIntelligence(baseInput({
      sr: makeSr({ support: { level: 950, dist: 5 }, resistance: { level: 1100, dist: 10 } }),
    }));
    assert.equal(result.context.zone, "MID_RANGE");
    assert.equal(result.context.level, null);
    assert.equal(result.context.distanceToLevel, null);
  });

  it("picks the closer side when both are near", () => {
    const result = toIntelligence(baseInput({
      sr: makeSr({ support: { level: 998, dist: 0.2 }, resistance: { level: 1005, dist: 0.5 } }),
    }));
    assert.equal(result.context.zone, "NEAR_SUPPORT");
    assert.equal(result.context.level, 998);
  });

  it("falls back to MID_RANGE when sr is null", () => {
    const result = toIntelligence(baseInput({ sr: null }));
    assert.equal(result.context.zone, "MID_RANGE");
  });
});

describe("toIntelligence — momentum label mapping", () => {
  it("maps STRONG_UP -> STRONG_UP", () => {
    const r = toIntelligence(baseInput({ momentum: makeMomentum("STRONG_UP", 0.8) }));
    assert.equal(r.momentum.label, "STRONG_UP");
    assert.equal(r.momentum.score, 0.8);
  });
  it("maps UP -> WEAK_UP", () => {
    const r = toIntelligence(baseInput({ momentum: makeMomentum("UP", 0.5) }));
    assert.equal(r.momentum.label, "WEAK_UP");
  });
  it("maps FLAT -> NEUTRAL", () => {
    const r = toIntelligence(baseInput({ momentum: makeMomentum("FLAT", 0) }));
    assert.equal(r.momentum.label, "NEUTRAL");
    assert.equal(r.momentum.score, 0);
  });
  it("maps DOWN -> WEAK_DOWN", () => {
    const r = toIntelligence(baseInput({ momentum: makeMomentum("DOWN", -0.5) }));
    assert.equal(r.momentum.label, "WEAK_DOWN");
    assert.equal(r.momentum.score, 0.5);
  });
  it("maps STRONG_DOWN -> STRONG_DOWN", () => {
    const r = toIntelligence(baseInput({ momentum: makeMomentum("STRONG_DOWN", -0.9) }));
    assert.equal(r.momentum.label, "STRONG_DOWN");
  });
});

describe("toIntelligence — pressure collapse", () => {
  it("collapses STRONG_BUY into BUY", () => {
    const r = toIntelligence(baseInput({ pressure: makePressure("STRONG_BUY", 0.8) }));
    assert.equal(r.pressure.label, "BUY");
  });
  it("collapses STRONG_SELL into SELL", () => {
    const r = toIntelligence(baseInput({ pressure: makePressure("STRONG_SELL", -0.7) }));
    assert.equal(r.pressure.label, "SELL");
    assert.equal(r.pressure.score, 0.7);
  });
  it("keeps NEUTRAL", () => {
    const r = toIntelligence(baseInput({ pressure: makePressure("NEUTRAL", 0) }));
    assert.equal(r.pressure.label, "NEUTRAL");
  });
  it("missing pressure → NEUTRAL with score 0", () => {
    const r = toIntelligence(baseInput({ pressure: null }));
    assert.equal(r.pressure.label, "NEUTRAL");
    assert.equal(r.pressure.score, 0);
  });
});

describe("toIntelligence — confidence formula", () => {
  it("zero momentum + zero pressure + any volatility → confidence 0", () => {
    const r = toIntelligence(baseInput({
      momentum: makeMomentum("FLAT", 0),
      pressure: makePressure("NEUTRAL", 0),
      high: 1030, low: 1000, // 3% range -> volatility 1.0
    }));
    assert.equal(r.confidence, 0);
    assert.equal(r.confidenceLabel, "LOW");
  });

  it("high aligned momentum + pressure near support + high volatility → HIGH confidence", () => {
    const r = toIntelligence(baseInput({
      sr: makeSr({ support: { level: 995, dist: 0.5 }, resistance: { level: 1100, dist: 10 } }),
      momentum: makeMomentum("STRONG_UP", 0.9),
      pressure: makePressure("STRONG_BUY", 0.9),
      high: 1030, low: 1000, // 3% range -> volatility 1.0
    }));
    // direction=BUY (support + positive momentum), aligned m=0.9, aligned p=0.9
    // (0.9*0.5 + 0.9*0.5) * (0.7 + 1.0*0.3) = 0.9 * 1.0 = 0.9
    assert.ok(r.confidence > 0.7, `expected HIGH, got ${r.confidence}`);
    assert.equal(r.confidenceLabel, "HIGH");
  });

  it("high aligned momentum + pressure near support + LOW volatility → HIGH confidence (calm stocks rewarded)", () => {
    const r = toIntelligence(baseInput({
      sr: makeSr({ support: { level: 995, dist: 0.5 }, resistance: { level: 1100, dist: 10 } }),
      momentum: makeMomentum("STRONG_UP", 0.9),
      pressure: makePressure("STRONG_BUY", 0.9),
      high: 1003, low: 1000, // 0.3% range -> volatility 0.2
    }));
    // direction=BUY, aligned m=0.9, aligned p=0.9
    // 0.9 * (1 - 0.2*0.15) = 0.9 * 0.97 = 0.873
    assert.ok(r.confidence > 0.7, `expected HIGH, got ${r.confidence}`);
    assert.equal(r.confidenceLabel, "HIGH");
  });

  it("wrong-direction pressure near support → LOW confidence", () => {
    const r = toIntelligence(baseInput({
      sr: makeSr({ support: { level: 995, dist: 0.5 }, resistance: { level: 1100, dist: 10 } }),
      momentum: makeMomentum("UP", 0.2),
      pressure: makePressure("STRONG_SELL", -0.8),
      high: 1010, low: 990,
    }));
    // direction=BUY (support + positive momentum), aligned p=max(-0.8,0)=0
    // aligned m=0.2, aligned p=0 → min alignment check: m≥0.2 passes
    // base = 0.2*0.5 + 0*0.5 = 0.1 → LOW
    assert.ok(r.confidence <= 0.5, `expected LOW, got ${r.confidence}`);
    assert.equal(r.confidenceLabel, "LOW");
  });

  it("MID_RANGE → confidence 0 regardless of magnitude", () => {
    const r = toIntelligence(baseInput({
      momentum: makeMomentum("STRONG_UP", 0.9),
      pressure: makePressure("STRONG_BUY", 0.9),
      high: 1030, low: 1000,
    }));
    // direction=NEUTRAL (MID_RANGE), all aligned scores = 0
    assert.equal(r.confidence, 0);
    assert.equal(r.confidenceLabel, "LOW");
  });

  it("both aligned < 0.2 → minimum alignment cap (LOW)", () => {
    const r = toIntelligence(baseInput({
      sr: makeSr({ support: { level: 995, dist: 0.5 }, resistance: { level: 1100, dist: 10 } }),
      momentum: makeMomentum("UP", 0.1),
      pressure: makePressure("BUY", 0.15),
      high: 1010, low: 990,
    }));
    // direction=BUY, aligned m=0.1, aligned p=0.15 → both < 0.2 → capped
    assert.ok(r.confidence <= 0.25, `expected very low, got ${r.confidence}`);
    assert.equal(r.confidenceLabel, "LOW");
  });
});

// ── Level-confirmation rules (2026-11-09) ───────────────────────────────────
// A call only after the LAST CLOSED 5-min candle shows the level's answer and
// momentum + pressure agree. makeZone(level) spans level ± 1, so:
//   resistance 1005 → zone 1004–1006      support 995 → zone 994–996
function cd(i: number, open: number, high: number, low: number, close: number, volume = 1000): Candle {
  return { time: 1700000000 + i * 300, open, high, low, close, volume };
}
// tested resistance, then closed back BELOW the zone as a red candle (CAMS case)
const rejectionCandles = (): Candle[] => [cd(0, 1002, 1006.5, 1001, 1005), cd(1, 1005, 1005.5, 1000, 1001)];
// buying INTO resistance — last close still inside the zone
const testingResistanceCandles = (): Candle[] => [cd(0, 1000, 1004, 999, 1003.5), cd(1, 1003.5, 1006, 1003, 1005)];
// tested support, then closed back ABOVE the zone as a green candle
const bounceCandles = (): Candle[] => [cd(0, 998, 999, 994.5, 995.5), cd(1, 995.5, 999.5, 995, 999)];
// selling INTO support — last close still inside the zone
const testingSupportCandles = (): Candle[] => [cd(0, 1000, 1001, 996, 996.5), cd(1, 996.5, 997, 994, 995)];
// failed breakdown: wick BELOW support, closed back, then green close above the zone (GUJALKALI case)
const failedBreakdownCandles = (): Candle[] => [cd(0, 996, 997, 991, 995.5), cd(1, 995.5, 999.5, 995, 998.5)];

describe("toIntelligence — outlook: wait for the level's answer", () => {
  const nearRes = makeSr({ resistance: { level: 1005, dist: 0.5 }, support: { level: 900, dist: 10 } });
  const nearSup = makeSr({ support: { level: 995, dist: 0.5 }, resistance: { level: 1100, dist: 10 } });

  it("no closed candle yet → WAIT, even with strong aligned engines", () => {
    const r = toIntelligence(baseInput({ sr: nearRes, momentum: makeMomentum("STRONG_DOWN", -0.95), pressure: makePressure("STRONG_SELL", -0.95) }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
  });

  it("strong buying INTO resistance (close still in the zone) → WAIT, not a call", () => {
    const r = toIntelligence(baseInput({ sr: nearRes, momentum: makeMomentum("STRONG_UP", 0.95), pressure: makePressure("STRONG_BUY", 0.95), recentCandles: testingResistanceCandles() }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
    assert.equal(r.tradePlan, null);
  });

  it("rejection confirmed: tested, closed back below, red + momentum down + sellers → REJECTION_POSSIBLE", () => {
    const r = toIntelligence(baseInput({ sr: nearRes, momentum: makeMomentum("STRONG_DOWN", -0.95), pressure: makePressure("STRONG_SELL", -0.95), recentCandles: rejectionCandles() }));
    assert.equal(r.outlook, "REJECTION_POSSIBLE");
  });

  it("rejection candle but pressure still buying → WAIT (engines must agree)", () => {
    const r = toIntelligence(baseInput({ sr: nearRes, momentum: makeMomentum("STRONG_DOWN", -0.95), pressure: makePressure("STRONG_BUY", 0.95), recentCandles: rejectionCandles() }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
  });

  it("closed below the zone but as a GREEN candle → WAIT (not a rejection candle)", () => {
    const r = toIntelligence(baseInput({ sr: nearRes, momentum: makeMomentum("STRONG_DOWN", -0.95), pressure: makePressure("STRONG_SELL", -0.95), recentCandles: [cd(0, 1002, 1006.5, 1001, 1005), cd(1, 1000, 1004.5, 999, 1002)] }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
  });

  it("selling INTO support (close still in the zone) → WAIT, no breakdown call", () => {
    const r = toIntelligence(baseInput({ sr: nearSup, momentum: makeMomentum("STRONG_DOWN", -0.95), pressure: makePressure("STRONG_SELL", -0.95), recentCandles: testingSupportCandles() }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
  });

  it("bounce confirmed: tested, closed back above, green + momentum up + buyers → BOUNCE_EXPECTED", () => {
    const r = toIntelligence(baseInput({ sr: nearSup, momentum: makeMomentum("STRONG_UP", 0.9), pressure: makePressure("STRONG_BUY", 0.9), recentCandles: bounceCandles() }));
    assert.equal(r.outlook, "BOUNCE_EXPECTED");
  });

  it("failed breakdown (wick below support, closes back above) + buyers → BOUNCE_EXPECTED", () => {
    const r = toIntelligence(baseInput({ sr: nearSup, momentum: makeMomentum("STRONG_UP", 0.9), pressure: makePressure("STRONG_BUY", 0.9), recentCandles: failedBreakdownCandles() }));
    assert.equal(r.outlook, "BOUNCE_EXPECTED");
  });

  it("bounce candles but momentum down → WAIT", () => {
    const r = toIntelligence(baseInput({ sr: nearSup, momentum: makeMomentum("STRONG_DOWN", -0.9), pressure: makePressure("STRONG_BUY", 0.9), recentCandles: bounceCandles() }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
  });

  it("confirmed bounce but LOW confidence → WAIT (HIGH floor kept)", () => {
    const r = toIntelligence(baseInput({ sr: nearSup, momentum: makeMomentum("UP", 0.4), pressure: makePressure("BUY", 0.4), recentCandles: bounceCandles() }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
  });

  it("FLAT momentum → WAIT", () => {
    const r = toIntelligence(baseInput({ sr: nearSup, momentum: makeMomentum("FLAT", 0), pressure: makePressure("NEUTRAL", 0), recentCandles: bounceCandles() }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
  });

  it("MID_RANGE always → NO_CLEAR_EDGE", () => {
    const r = toIntelligence(baseInput({
      sr: makeSr({ support: { level: 900, dist: 10 }, resistance: { level: 1100, dist: 10 } }),
      momentum: makeMomentum("STRONG_UP", 0.9),
      pressure: makePressure("STRONG_BUY", 0.9),
      recentCandles: bounceCandles(),
    }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
  });
});

describe("toIntelligence — bias logic", () => {
  it("up momentum + buy pressure → BULLISH", () => {
    const r = toIntelligence(baseInput({
      momentum: makeMomentum("STRONG_UP", 0.7),
      pressure: makePressure("BUY", 0.4),
    }));
    assert.equal(r.bias, "BULLISH");
  });

  it("down momentum + sell pressure → BEARISH", () => {
    const r = toIntelligence(baseInput({
      momentum: makeMomentum("DOWN", -0.5),
      pressure: makePressure("STRONG_SELL", -0.7),
    }));
    assert.equal(r.bias, "BEARISH");
  });

  it("conflicting momentum + pressure → NEUTRAL", () => {
    const r = toIntelligence(baseInput({
      momentum: makeMomentum("STRONG_UP", 0.7),
      pressure: makePressure("SELL", -0.4),
    }));
    assert.equal(r.bias, "NEUTRAL");
  });

  it("flat momentum → NEUTRAL", () => {
    const r = toIntelligence(baseInput({
      momentum: makeMomentum("FLAT", 0),
      pressure: makePressure("BUY", 0.5),
    }));
    assert.equal(r.bias, "NEUTRAL");
  });
});

describe("toIntelligence — volatility labels", () => {
  it("3% range → HIGH", () => {
    const r = toIntelligence(baseInput({ high: 1030, low: 1000 }));
    assert.equal(r.volatility.label, "HIGH");
    assert.equal(r.volatility.score, 1.0);
  });
  it("1% range → MEDIUM (score 0.6)", () => {
    const r = toIntelligence(baseInput({ high: 1010, low: 1000 }));
    assert.equal(r.volatility.label, "MEDIUM");
    assert.equal(r.volatility.score, 0.6);
  });
  it("0.3% range → LOW", () => {
    const r = toIntelligence(baseInput({ high: 1003, low: 1000 }));
    assert.equal(r.volatility.label, "LOW");
  });
});

function makeCandles(specs: Array<{ high: number; low: number }>): Candle[] {
  return specs.map((s, i) => ({
    time: 1700000000 + i * 300,
    open: s.low,
    high: s.high,
    low: s.low,
    close: s.high,
    volume: 1000,
  }));
}

describe("toIntelligence — rolling-window volatility", () => {
  it("uses rolling window when ≥ 3 candles supplied (overrides session high/low)", () => {
    // Session would say HIGH (3% range), but rolling window says MEDIUM (1% range).
    const r = toIntelligence(baseInput({
      high: 1030, low: 1000, // session: 3% range
      recentCandles: makeCandles([
        { high: 1005, low: 1000 },
        { high: 1008, low: 1002 },
        { high: 1010, low: 1003 },
        { high: 1009, low: 1001 },
        { high: 1010, low: 1004 },
        { high: 1010, low: 1000 }, // window: max=1010, min=1000 → 1.0% range
      ]),
    }));
    assert.equal(r.volatility.label, "MEDIUM");
    assert.equal(r.volatility.score, 0.6);
  });

  it("rolling window 0.3% range → LOW even when session high/low say HIGH", () => {
    const r = toIntelligence(baseInput({
      high: 1030, low: 1000, // session: 3% range → would be HIGH
      recentCandles: makeCandles([
        { high: 1001, low: 1000 },
        { high: 1002, low: 1000 },
        { high: 1003, low: 1000 }, // window: 0.3% range
      ]),
    }));
    assert.equal(r.volatility.label, "LOW");
  });

  it("falls back to session high/low when fewer than 3 candles supplied", () => {
    const r = toIntelligence(baseInput({
      high: 1030, low: 1000, // session: 3% range
      recentCandles: makeCandles([
        { high: 1001, low: 1000 },
        { high: 1002, low: 1000 },
      ]),
    }));
    assert.equal(r.volatility.label, "HIGH");
    assert.equal(r.volatility.score, 1.0);
  });

  it("falls back to session high/low when recentCandles is empty array", () => {
    const r = toIntelligence(baseInput({
      high: 1010, low: 1000, // session: 1% range → MEDIUM
      recentCandles: [],
    }));
    assert.equal(r.volatility.label, "MEDIUM");
    assert.equal(r.volatility.score, 0.6);
  });

  it("returns LOW safety floor when both candles and session high/low are missing", () => {
    const r = toIntelligence(baseInput({
      high: 0, low: 0, // no session OHLC
      recentCandles: [], // no candles
    }));
    assert.equal(r.volatility.label, "LOW");
    assert.equal(r.volatility.score, 0.2);
  });
});

describe("buildMarketContext", () => {
  it("declares TRENDING when |NIFTY change| ≥ 0.3%", () => {
    const ctx = buildMarketContext(
      { lastPrice: 22000, close: 21900 }, // +0.46%
      { lastPrice: 48500, close: 48000 }, // +1.04%
    );
    assert.equal(ctx.condition, "TRENDING");
    assert.equal(ctx.nifty.direction, "UP");
    assert.equal(ctx.bankNifty.direction, "UP");
  });

  it("declares SIDEWAYS when |NIFTY change| < 0.3%", () => {
    const ctx = buildMarketContext(
      { lastPrice: 22000, close: 21990 }, // +0.045%
      { lastPrice: 48500, close: 48400 },
    );
    assert.equal(ctx.condition, "SIDEWAYS");
  });

  it("FLAT direction near zero", () => {
    const ctx = buildMarketContext(
      { lastPrice: 22000, close: 22000 },
      null,
    );
    assert.equal(ctx.nifty.direction, "FLAT");
    assert.equal(ctx.bankNifty.direction, "FLAT");
  });
});

describe("toIntelligence — index symbol handling", () => {
  // Indices have no order-book volume → pressure must be NOT_APPLICABLE so
  // the UI can render an honest N/A card instead of misleading neutrals.
  it("returns NOT_APPLICABLE pressure for NIFTY 50", () => {
    const r = toIntelligence(baseInput({
      symbol: "NIFTY 50",
      pressure: makePressure("BUY", 0.5),  // even when input pressure is non-null
    }));
    assert.equal(r.pressure.label, "NOT_APPLICABLE");
    assert.equal(r.pressure.score, 0);
  });

  it("returns NOT_APPLICABLE pressure for NIFTY BANK", () => {
    const r = toIntelligence(baseInput({ symbol: "NIFTY BANK" }));
    assert.equal(r.pressure.label, "NOT_APPLICABLE");
  });

  // Stocks (non-index) keep their volume-weighted pressure as before.
  it("preserves real pressure for non-index symbols", () => {
    const r = toIntelligence(baseInput({
      symbol: "RELIANCE",
      pressure: makePressure("BUY", 0.5),
    }));
    assert.equal(r.pressure.label, "BUY");
    assert.equal(r.pressure.score, 0.5);
  });

  // Volatility bands are 3× more sensitive for indices: a 0.6% range that
  // would land at LOW (0.2) for stocks should land at MEDIUM (0.6) for indices.
  it("uses index-scaled volatility bands — 0.6% range = score 0.6 for NIFTY", () => {
    const r = toIntelligence(baseInput({
      symbol: "NIFTY 50",
      price: 24000,
      high: 24090,   // (24090 - 23945) / 24000 ≈ 0.006 → 0.6%
      low: 23945,
    }));
    // For stocks the same 0.6% range would be 0.4 (>= 0.005). For indices
    // it crosses the >= 0.005 band at score 0.6.
    assert.equal(r.volatility.score, 0.6);
    assert.equal(r.volatility.label, "MEDIUM");
  });

  it("preserves stock-scaled volatility — 0.6% range = score 0.4 for stocks", () => {
    const r = toIntelligence(baseInput({
      symbol: "RELIANCE",
      price: 2500,
      high: 2515,    // (2515 - 2500) / 2500 = 0.006 → 0.6%
      low: 2500,
    }));
    assert.equal(r.volatility.score, 0.4);
    assert.equal(r.volatility.label, "MEDIUM");
  });
});

// Helper: build a candle stream where the last 2 candles ("confirmation")
// breach the prior 5 candles' max-high (Breakout) or min-low (Breakdown), and
// the LAST candle's volume is > 1.5× the MEDIAN of the prior 5 candles' volume.
function buildBreakoutCandles(): Candle[] {
  const candles: Candle[] = [];
  // 19 baseline candles: low volume (1000), price stuck near 995-1000
  for (let i = 0; i < 19; i++) {
    candles.push({ time: 1700000000 + i * 300, open: 997, high: 1000, low: 995, close: 997, volume: 1000 });
  }
  // 2 confirmation candles: close above the prior 5's max-high (1000), high vol on the last
  candles.push({ time: 1700000000 + 19 * 300, open: 1001, high: 1010, low: 1000, close: 1006, volume: 1500 });
  candles.push({ time: 1700000000 + 20 * 300, open: 1006, high: 1012, low: 1003, close: 1008, volume: 2500 }); // current — vol surge
  return candles;
  // VOLUME_LOOKBACK=5 → prior 5 candles for current=index 20 are indices 15-19,
  //   volumes [1000,1000,1000,1000,1500] → median=1000 → 1.5×1000=1500
  //   current vol 2500 ≥ 1500 → PASS ✓
  // DONCHIAN_LOOKBACK=5 → prior 5 max-high (indices 14-18) = 1000
  //   candles 19,20 close = 1006,1008 > 1000 → PASS ✓
}

function buildBreakdownCandles(): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < 19; i++) {
    candles.push({ time: 1700000000 + i * 300, open: 1003, high: 1005, low: 1000, close: 1003, volume: 1000 });
  }
  candles.push({ time: 1700000000 + 19 * 300, open: 999, high: 1000, low: 990, close: 994, volume: 1500 });
  candles.push({ time: 1700000000 + 20 * 300, open: 994, high: 997, low: 988, close: 992, volume: 2500 }); // current — vol surge
  return candles;
  // VOLUME_LOOKBACK=5 → prior 5 vols [1000,1000,1000,1000,1500] → median=1000
  //   → 1.5×1000=1500. current 2500 ≥ 1500 → PASS ✓
  // DONCHIAN_LOOKBACK=5 → prior 5 min-low (indices 14-18) = 1000
  //   candles 19,20 close = 994,992 < 1000 → PASS ✓
}

describe("toIntelligence — Breakout / Breakdown gates", () => {
  const nearRes = makeSr({ resistance: { level: 1005, dist: 0.5 }, support: { level: 900, dist: 10 } });
  const nearSup = makeSr({ support: { level: 995, dist: 0.5 }, resistance: { level: 1100, dist: 10 } });

  it("Breakout: both gates pass + HIGH conf + STRONG_UP near resistance → BREAKOUT_LIKELY", () => {
    const r = toIntelligence(baseInput({
      sr: nearRes,
      momentum: makeMomentum("STRONG_UP", 0.95),
      pressure: makePressure("STRONG_BUY", 0.95),
      recentCandles: buildBreakoutCandles(),
    }));
    assert.equal(r.outlook, "BREAKOUT_LIKELY");
  });

  it("Breakout: volume gate fails (current vol = avg) → NO_CLEAR_EDGE", () => {
    const candles = buildBreakoutCandles();
    candles[candles.length - 1].volume = 1000; // drop the surge → equal to baseline
    const r = toIntelligence(baseInput({
      sr: nearRes,
      momentum: makeMomentum("STRONG_UP", 0.95),
      pressure: makePressure("STRONG_BUY", 0.95),
      recentCandles: candles,
    }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
  });

  it("Breakout: ONE close above the zone is enough (previous candle still inside)", () => {
    const candles = buildBreakoutCandles();
    candles[candles.length - 2].close = 999; // previous candle did not break out
    const r = toIntelligence(baseInput({
      sr: nearRes,
      momentum: makeMomentum("STRONG_UP", 0.95),
      pressure: makePressure("STRONG_BUY", 0.95),
      recentCandles: candles,
    }));
    assert.equal(r.outlook, "BREAKOUT_LIKELY");
  });

  it("Breakout: last close still inside the zone → NO_CLEAR_EDGE (still testing)", () => {
    const candles = buildBreakoutCandles();
    candles[candles.length - 1].close = 1005.5; // ≤ zone.max (1006)
    const r = toIntelligence(baseInput({
      sr: nearRes,
      momentum: makeMomentum("STRONG_UP", 0.95),
      pressure: makePressure("STRONG_BUY", 0.95),
      recentCandles: candles,
    }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
  });

  it("Breakout: insufficient candles (only 5) → NO_CLEAR_EDGE", () => {
    // VOLUME_LOOKBACK=5 means the volume gate needs 6 candles minimum
    // (5 prior + 1 current). With only 5, the volume gate fails closed.
    // (The Donchian gate also needs 7 candles, so even 6 would short-circuit
    // there — but this test specifically validates the volume gate's
    // insufficient-data guard.)
    const r = toIntelligence(baseInput({
      sr: nearRes,
      momentum: makeMomentum("STRONG_UP", 0.95),
      pressure: makePressure("STRONG_BUY", 0.95),
      recentCandles: buildBreakoutCandles().slice(-5),
    }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
  });

  it("Breakdown: both gates pass + HIGH conf + STRONG_DOWN near support → BREAKDOWN_RISK", () => {
    const r = toIntelligence(baseInput({
      sr: nearSup,
      momentum: makeMomentum("STRONG_DOWN", -0.95),
      pressure: makePressure("STRONG_SELL", -0.95),
      recentCandles: buildBreakdownCandles(),
    }));
    assert.equal(r.outlook, "BREAKDOWN_RISK");
  });

  it("Breakdown: volume gate fails → NO_CLEAR_EDGE", () => {
    const candles = buildBreakdownCandles();
    candles[candles.length - 1].volume = 1000;
    const r = toIntelligence(baseInput({
      sr: nearSup,
      momentum: makeMomentum("STRONG_DOWN", -0.95),
      pressure: makePressure("STRONG_SELL", -0.95),
      recentCandles: candles,
    }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
  });

  it("Breakdown: ONE close below the zone is enough (previous candle still inside)", () => {
    const candles = buildBreakdownCandles();
    candles[candles.length - 2].close = 1001;
    const r = toIntelligence(baseInput({
      sr: nearSup,
      momentum: makeMomentum("STRONG_DOWN", -0.95),
      pressure: makePressure("STRONG_SELL", -0.95),
      recentCandles: candles,
    }));
    assert.equal(r.outlook, "BREAKDOWN_RISK");
  });

  it("Breakdown: last close still inside the zone → NO_CLEAR_EDGE (still testing)", () => {
    const candles = buildBreakdownCandles();
    candles[candles.length - 1].close = 994.5; // ≥ zone.min (994)
    const r = toIntelligence(baseInput({
      sr: nearSup,
      momentum: makeMomentum("STRONG_DOWN", -0.95),
      pressure: makePressure("STRONG_SELL", -0.95),
      recentCandles: candles,
    }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
  });

  it("Index symbol with all-pass Breakout setup → NO_CLEAR_EDGE (indices skip Breakout/Breakdown)", () => {
    const r = toIntelligence(baseInput({
      symbol: "NIFTY 50",
      sr: nearRes,
      momentum: makeMomentum("STRONG_UP", 0.95),
      pressure: makePressure("STRONG_BUY", 0.95),
      recentCandles: buildBreakoutCandles(),
    }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
  });

  // Regression guard for the 2026-05-12 mean→median switch. With the OLD
  // mean-of-20 logic, a single high-volume spike in the lookback window
  // inflated the threshold and caused the next REAL surge to fail — the
  // "spike then miss" failure mode that motivated the switch to median.
  // This test pins the new behaviour: outlier in the prior 5 must NOT
  // prevent the gate from passing on a moderate next-candle surge.
  it("Breakout: prior-5 contains an outlier — median ignores it, gate still passes", () => {
    const candles: Candle[] = [];
    // 14 baseline candles, low vol, price at 995-1000 (Donchian setup)
    for (let i = 0; i < 14; i++) {
      candles.push({ time: 1700000000 + i * 300, open: 997, high: 1000, low: 995, close: 997, volume: 1000 });
    }
    // Prior 5 (indices 14-18): four normal vols + one big spike (5000)
    candles.push({ time: 1700000000 + 14 * 300, open: 997, high: 1000, low: 995, close: 997, volume: 1000 });
    candles.push({ time: 1700000000 + 15 * 300, open: 997, high: 1000, low: 995, close: 997, volume: 1000 });
    candles.push({ time: 1700000000 + 16 * 300, open: 997, high: 1000, low: 995, close: 997, volume: 5000 });
    candles.push({ time: 1700000000 + 17 * 300, open: 997, high: 1000, low: 995, close: 997, volume: 1000 });
    candles.push({ time: 1700000000 + 18 * 300, open: 997, high: 1000, low: 995, close: 997, volume: 1000 });
    // 2 confirmation candles: above max-high (1000), and last has moderate surge
    candles.push({ time: 1700000000 + 19 * 300, open: 1001, high: 1010, low: 1000, close: 1006, volume: 1200 });
    candles.push({ time: 1700000000 + 20 * 300, open: 1006, high: 1012, low: 1003, close: 1008, volume: 1600 });
    // Prior 5 vols (indices 15-19): [1000,1000,5000,1000,1200] sorted = [1000,1000,1000,1200,5000]
    //   median = 1000  →  threshold = 1.5 × 1000 = 1500
    //   current vol 1600 ≥ 1500 → PASS ✓
    // Old mean-of-20 would have been ≈ (14*1000 + 1000+1000+5000+1000+1200)/19 ≈ 947 (ok pass)
    // But the canonical "spike then miss" case: median wins where mean fails when the
    // spike is in the SHORT prior window. Here we pin the median behaviour explicitly.
    const r = toIntelligence(baseInput({
      sr: nearRes,
      momentum: makeMomentum("STRONG_UP", 0.95),
      pressure: makePressure("STRONG_BUY", 0.95),
      recentCandles: candles,
    }));
    assert.equal(r.outlook, "BREAKOUT_LIKELY");
  });

  // Engines must agree with the break direction.
  it("Breakout candles but pressure selling → NO_CLEAR_EDGE", () => {
    const r = toIntelligence(baseInput({
      sr: nearRes,
      momentum: makeMomentum("STRONG_UP", 0.95),
      pressure: makePressure("STRONG_SELL", -0.95),
      recentCandles: buildBreakoutCandles(),
    }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
  });

  it("Breakdown candles but pressure buying → NO_CLEAR_EDGE", () => {
    const r = toIntelligence(baseInput({
      sr: nearSup,
      momentum: makeMomentum("STRONG_DOWN", -0.95),
      pressure: makePressure("STRONG_BUY", 0.95),
      recentCandles: buildBreakdownCandles(),
    }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
  });
});

// Volatility must use only the last 6 candles even when the caller passes a
// longer buffer (e.g. 21 for the volume gate). Without slicing, bumping the
// caller's buffer length would silently change volatility scores for every
// stock — a regression that would corrupt confidence calculations.
describe("toIntelligence — volatility window isolation", () => {
  it("21-candle buffer with calm last 6 → volatility ignores the older chaos", () => {
    const candles: Candle[] = [];
    // Wild older 15 candles (would inflate volatility if iterated)
    for (let i = 0; i < 15; i++) {
      candles.push({ time: 1700000000 + i * 300, open: 1000, high: 1100, low: 900, close: 1000, volume: 1000 });
    }
    // Calm last 6 candles — should be the entire window volatility considers
    for (let i = 15; i < 21; i++) {
      candles.push({ time: 1700000000 + i * 300, open: 1000, high: 1010, low: 1000, close: 1005, volume: 1000 });
    }
    const r = toIntelligence(baseInput({
      high: 1100, low: 900, // session high/low huge — irrelevant when ≥3 candles supplied
      recentCandles: candles,
    }));
    // Last 6 range = (1010 - 1000)/1000 = 1.0% → score 0.6 (MEDIUM)
    // If slicing were broken: range = (1100 - 900)/1000 = 20% → score 1.0 (HIGH)
    assert.equal(r.volatility.score, 0.6);
    assert.equal(r.volatility.label, "MEDIUM");
  });

  it("6-candle buffer matches 21-candle buffer score (regression check)", () => {
    const calmSix: Candle[] = [];
    for (let i = 0; i < 6; i++) {
      calmSix.push({ time: 1700000000 + i * 300, open: 1000, high: 1010, low: 1000, close: 1005, volume: 1000 });
    }
    const sixOnly = toIntelligence(baseInput({ recentCandles: calmSix }));

    const padded: Candle[] = [];
    for (let i = 0; i < 15; i++) {
      padded.push({ time: 1700000000 + i * 300, open: 1000, high: 1100, low: 900, close: 1000, volume: 1000 });
    }
    padded.push(...calmSix);
    const padded21 = toIntelligence(baseInput({ recentCandles: padded }));

    assert.equal(sixOnly.volatility.score, padded21.volatility.score);
    assert.equal(sixOnly.volatility.label, padded21.volatility.label);
  });
});

describe("getMomentum — index-aware divisor", () => {
  // The fix: indices use a 3× more sensitive divisor so smaller % moves still
  // register. Demonstrates the contrast — at 0.05% per candle, stocks read
  // FLAT (below the 0.3 threshold) while indices read UP.
  function flatCandle(price: number, returnPct: number): Candle {
    const open = price;
    const close = open * (1 + returnPct);
    return { time: 0, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 0 };
  }

  it("indices: 0.05% per candle reads UP (would be FLAT for stocks)", () => {
    const c = [flatCandle(24000, 0.0005), flatCandle(24012, 0.0005), flatCandle(24024, 0.0005)];
    const m = getMomentum(c, true);
    assert.ok(m);
    // 0.0005 / 0.001 = 0.5 → UP threshold (>0.3)
    assert.equal(m!.signal, "UP");
  });

  it("stocks: 0.05% per candle stays FLAT (threshold unchanged)", () => {
    const c = [flatCandle(2500, 0.0005), flatCandle(2501.25, 0.0005), flatCandle(2502.5, 0.0005)];
    const m = getMomentum(c);  // default isIndex = false
    assert.ok(m);
    // 0.0005 / 0.003 = 0.167 → below 0.3 threshold → FLAT
    assert.equal(m!.signal, "FLAT");
  });

  // 2026-11-09: momentum uses the LAST 2 candles, previous × 0.3 + newest × 0.7
  it("only the last 2 candles count (0.3 / 0.7) — an older big candle is ignored", () => {
    // returns: +1.0% (old), −0.1%, +0.2%  →  velocity = −0.001×0.3 + 0.002×0.7 = 0.0011 → 0.367 → UP
    // (the old 3-candle formula would have said STRONG_UP because of the +1% candle)
    const c = [flatCandle(1000, 0.01), flatCandle(1010, -0.001), flatCandle(1009, 0.002)];
    const m = getMomentum(c)!;
    assert.ok(Math.abs(m.value - 0.0011 / 0.003) < 1e-9, `value ${m.value}`);
    assert.equal(m.signal, "UP");
    assert.ok(Math.abs(m.accelerationRaw - (0.002 - -0.001)) < 1e-12, "acceleration = newest − previous");
  });

  it("2 candles are enough; 1 is not", () => {
    assert.equal(getMomentum([flatCandle(1000, 0.002)]), null);
    assert.ok(getMomentum([flatCandle(1000, 0.002), flatCandle(1002, 0.002)]));
  });

  it("indices: 0.2% per candle reads STRONG_UP", () => {
    const c = [flatCandle(24000, 0.002), flatCandle(24048, 0.002), flatCandle(24096, 0.002)];
    const m = getMomentum(c, true);
    assert.ok(m);
    // 0.002 / 0.001 = 2.0 → clamped to 1.0 → STRONG_UP threshold (>0.6)
    assert.equal(m!.signal, "STRONG_UP");
  });
});

// ── Trade plan tests ────────────────────────────────────────────────────────
// The tradePlan field is the user-facing BUY/SELL output. These tests pin:
//   1. The outlook→action mapping (BOUNCE/BREAKOUT → BUY, REJECTION/BREAKDOWN → SELL)
//   2. The HIGH-confidence floor (< 0.7 → null = WAIT)
//   3. The ATR-based SL / target math (1.2× / 2.4× → 2:1 R:R always)
//   4. The fallback chain (no candles → volatility-derived ATR → 0.5% floor)

describe("toIntelligence — tradePlan generation", () => {
  const nearRes = makeSr({ resistance: { level: 1005, dist: 0.5 }, support: { level: 900, dist: 10 } });
  const nearSup = makeSr({ support: { level: 995, dist: 0.5 }, resistance: { level: 1100, dist: 10 } });

  it("BOUNCE_EXPECTED + HIGH conf → BUY tradePlan with SL below + target above + 2:1 R:R", () => {
    const r = toIntelligence(baseInput({
      sr: nearSup,
      momentum: makeMomentum("STRONG_UP", 0.9),
      pressure: makePressure("STRONG_BUY", 0.9),
      high: 1010, low: 990,
      recentCandles: bounceCandles(),
    }));
    assert.equal(r.outlook, "BOUNCE_EXPECTED");
    assert.ok(r.tradePlan, "tradePlan should be set");
    assert.equal(r.tradePlan!.action, "BUY");
    assert.equal(r.tradePlan!.entry, 1000);
    assert.ok(r.tradePlan!.stopLoss < r.tradePlan!.entry, "SL below entry for BUY");
    assert.ok(r.tradePlan!.target > r.tradePlan!.entry, "Target above entry for BUY");
    assert.equal(r.tradePlan!.riskReward, 2.0);
    // 2:1 by construction: rewardPercent ≈ 2 × riskPercent
    const ratio = r.tradePlan!.rewardPercent / r.tradePlan!.riskPercent;
    assert.ok(Math.abs(ratio - 2.0) < 0.02, `R:R should be ≈ 2.0, got ${ratio}`);
  });

  it("REJECTION_POSSIBLE + HIGH conf → SELL tradePlan with SL above + target below", () => {
    const r = toIntelligence(baseInput({
      sr: nearRes,
      momentum: makeMomentum("STRONG_DOWN", -0.95),
      pressure: makePressure("STRONG_SELL", -0.95),
      high: 1003, low: 1000,
      recentCandles: rejectionCandles(),
    }));
    assert.equal(r.outlook, "REJECTION_POSSIBLE");
    assert.ok(r.tradePlan);
    assert.equal(r.tradePlan!.action, "SELL");
    assert.ok(r.tradePlan!.stopLoss > r.tradePlan!.entry, "SL above entry for SELL");
    assert.ok(r.tradePlan!.target < r.tradePlan!.entry, "Target below entry for SELL");
    assert.equal(r.tradePlan!.riskReward, 2.0);
  });

  it("BREAKOUT_LIKELY (gates pass) → BUY tradePlan", () => {
    const r = toIntelligence(baseInput({
      price: 1008, // live price = the breakout candle's close (above the 1004–1006 zone)
      sr: nearRes,
      momentum: makeMomentum("STRONG_UP", 0.95),
      pressure: makePressure("STRONG_BUY", 0.95),
      recentCandles: buildBreakoutCandles(),
    }));
    assert.equal(r.outlook, "BREAKOUT_LIKELY");
    assert.ok(r.tradePlan);
    assert.equal(r.tradePlan!.action, "BUY");
  });

  it("BREAKDOWN_RISK (gates pass) → SELL tradePlan", () => {
    const r = toIntelligence(baseInput({
      price: 992, // live price = the breakdown candle's close (below the 994–996 zone)
      sr: nearSup,
      momentum: makeMomentum("STRONG_DOWN", -0.95),
      pressure: makePressure("STRONG_SELL", -0.95),
      recentCandles: buildBreakdownCandles(),
    }));
    assert.equal(r.outlook, "BREAKDOWN_RISK");
    assert.ok(r.tradePlan);
    assert.equal(r.tradePlan!.action, "SELL");
  });

  it("NO_CLEAR_EDGE → tradePlan is null (WAIT)", () => {
    const r = toIntelligence(baseInput({
      sr: makeSr({ support: { level: 900, dist: 10 }, resistance: { level: 1100, dist: 10 } }),
      momentum: makeMomentum("STRONG_UP", 0.9),
      pressure: makePressure("STRONG_BUY", 0.9),
    }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
    assert.equal(r.tradePlan, null);
  });

  it("Directional outlook but confidence < 0.7 → tradePlan null", () => {
    // Hand-construct an unusual state where we somehow have a BOUNCE outlook
    // path but the confidence comes out under 0.7. The buildOutlook gate
    // requires HIGH confidence so reaching BOUNCE without HIGH is impossible
    // through the normal pipeline — this test pins buildTradePlan's defensive
    // floor check by forcing it via the inputs the real path would produce.
    // We use moderate-strength inputs that land confidence in MEDIUM range
    // → outlook becomes NO_CLEAR_EDGE → tradePlan null (the same end state).
    const r = toIntelligence(baseInput({
      sr: nearSup,
      momentum: makeMomentum("UP", 0.5),
      pressure: makePressure("BUY", 0.5),
    }));
    // Conf is below HIGH so outlook is NO_CLEAR_EDGE → tradePlan null
    assert.ok(r.confidence < 0.7);
    assert.equal(r.tradePlan, null);
  });

  it("tradePlan uses real ATR from recentCandles when available (BUY)", () => {
    // Build 15 candles with a known TR profile so we can predict the ATR.
    // Each candle: open=close=100, high=102, low=98 → TR ≈ 4 (since prevClose = 100)
    const candles: Candle[] = [];
    for (let i = 0; i < 14; i++) {
      candles.push({ time: 1700000000 + i * 300, open: 100, high: 102, low: 98, close: 100, volume: 1000 });
    }
    // last candle: tested support (zone 98.9–100.9), closed back above as green → confirmed bounce
    candles.push({ time: 1700000000 + 14 * 300, open: 100.2, high: 102, low: 98.5, close: 101.2, volume: 1000 });
    const r = toIntelligence(baseInput({
      symbol: "TEST",
      price: 100,
      open: 100, close: 100, high: 102, low: 98,
      sr: makeSr({ support: { level: 99.9, dist: 0.1 }, resistance: { level: 110, dist: 10 } }),
      momentum: makeMomentum("STRONG_UP", 0.9),
      pressure: makePressure("STRONG_BUY", 0.9),
      recentCandles: candles,
    }));
    assert.equal(r.outlook, "BOUNCE_EXPECTED");
    assert.ok(r.tradePlan);
    // ATR ≈ 4. Support zone 98.9–100.9 → SL = 98.9 − 0.2 × 4 = 98.1 (just below the zone).
    // Risk = 100 − 98.1 = 1.9 → target = 100 + 2 × 1.9 = 103.8.
    assert.ok(Math.abs(r.tradePlan!.atr - 4) < 0.5, `expected ATR ≈ 4, got ${r.tradePlan!.atr}`);
    const atr = r.tradePlan!.atr;
    const sl = 98.9 - 0.2 * atr;
    assert.ok(Math.abs(r.tradePlan!.stopLoss - sl) < 0.02, `expected SL ≈ ${sl}, got ${r.tradePlan!.stopLoss}`);
    assert.ok(Math.abs(r.tradePlan!.target - (100 + 2 * (100 - sl))) < 0.02, `expected target 2× risk, got ${r.tradePlan!.target}`);
    assert.ok(r.tradePlan!.stopLoss < 98.9, "stop sits BELOW the support zone");
  });

  // ── Fix 1 + Fix 3 (2026-11-09): plan anchored to the level ──
  const flatCandles = (n: number, base: number, range: number): Candle[] =>
    Array.from({ length: n }, (_, i) => ({ time: 1700000000 + i * 300, open: base, high: base + range / 2, low: base - range / 2, close: base, volume: 1000 }));

  it("Fix 1: price more than 1.5 ATR from the level → no plan (the move already happened)", () => {
    // ₹1000 stock: the old 1% "near" zone is ±₹10, but its 5-min ATR is only ≈ ₹2.
    // Support 995 (zone 994–996). Last candle tested 995 and closed 997.5 (green) → bounce.
    const candles = flatCandles(14, 997, 2);
    candles.push({ time: 1700000000 + 14 * 300, open: 995.5, high: 998, low: 995, close: 997.5, volume: 1000 });
    const input = (price: number) => baseInput({
      price, open: 997, close: 997, high: 1001, low: 994,
      sr: nearSup,
      momentum: makeMomentum("STRONG_UP", 0.9),
      pressure: makePressure("STRONG_BUY", 0.9),
      recentCandles: candles,
    });
    const far = toIntelligence(input(1000)); // ₹5 above the level ≈ 2.4 ATR (still inside the old 1%)
    assert.equal(far.outlook, "BOUNCE_EXPECTED", "the setup itself is still a bounce");
    assert.equal(far.tradePlan, null, "but too far from support to call — the move already happened");
    const near = toIntelligence(input(997.5)); // ₹2.5 above ≈ 1.2 ATR → fine
    assert.ok(near.tradePlan, "close to the level → plan");
    assert.ok(near.tradePlan!.stopLoss < 994, "stop below the support zone");
  });

  it("Fix 3: SELL rejection → stop just ABOVE the resistance zone, target 2× risk", () => {
    const r = toIntelligence(baseInput({
      price: 1003, sr: nearRes, momentum: makeMomentum("STRONG_DOWN", -0.95), pressure: makePressure("STRONG_SELL", -0.95), recentCandles: rejectionCandles(),
    }));
    assert.equal(r.outlook, "REJECTION_POSSIBLE");
    const p = r.tradePlan!;
    assert.equal(p.action, "SELL");
    assert.ok(Math.abs(p.stopLoss - (1006 + 0.2 * p.atr)) < 0.02, `SL just above zone top 1006, got ${p.stopLoss}`);
    const risk = p.stopLoss - 1003;
    assert.ok(Math.abs(p.target - (1003 - 2 * risk)) < 0.02, `target = 2× risk below, got ${p.target}`);
    assert.equal(p.riskReward, 2);
  });

  it("Fix 3: price already beyond where the stop would go → no plan", () => {
    // BUY breakout but price fell back below the resistance zone bottom: stop would be above price → invalid.
    const r = toIntelligence(baseInput({ price: 1000, sr: nearRes, momentum: makeMomentum("STRONG_UP", 0.95), pressure: makePressure("STRONG_BUY", 0.95), recentCandles: buildBreakoutCandles() }));
    assert.equal(r.tradePlan, null);
  });

  it("tradePlan falls back to volatility-derived ATR when too few candles for ATR", () => {
    const r = toIntelligence(baseInput({
      price: 1000,
      sr: nearSup,
      momentum: makeMomentum("STRONG_UP", 0.9),
      pressure: makePressure("STRONG_BUY", 0.9),
      high: 1010, low: 990,  // ~2% volatility range → volatility.score ≈ 0.8
      recentCandles: bounceCandles(), // 2 candles: enough to confirm, too few for ATR
    }));
    assert.ok(r.tradePlan, "tradePlan should be set");
    // fromScore = price × volatility.score × 0.01 → for score 0.8: 1000 × 0.008 = 8
    // SL distance = 1.2 × 8 = 9.6 → SL ≈ 990.4. Pretty wide guard band — just confirm it's positive.
    assert.ok(r.tradePlan!.atr > 0, "atr should be positive via fallback");
    assert.ok(r.tradePlan!.stopLoss > 0 && r.tradePlan!.stopLoss < r.tradePlan!.entry);
    assert.ok(r.tradePlan!.target > r.tradePlan!.entry);
  });

  it("tradePlan field is always present on snapshot (null when no setup)", () => {
    // Smoke test: every snapshot must have the field declared. Some readers may
    // check the property existence rather than null vs object.
    const r = toIntelligence(baseInput({}));
    assert.ok("tradePlan" in r, "tradePlan key must always exist");
    assert.equal(r.tradePlan, null);
  });
});
