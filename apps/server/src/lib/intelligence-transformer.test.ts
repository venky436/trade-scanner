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

describe("toIntelligence — outlook decision table", () => {
  const nearRes = makeSr({ resistance: { level: 1005, dist: 0.5 }, support: { level: 900, dist: 10 } });
  const nearSup = makeSr({ support: { level: 995, dist: 0.5 }, resistance: { level: 1100, dist: 10 } });

  // Re-enabled 2026-05-10 with strict gates. Without recentCandles the volume
  // and Donchian-style confirmation gates fail closed, so we still get
  // NO_CLEAR_EDGE — the gates only let signals through when we have candle
  // data to evaluate. See "Breakout / Breakdown gates" describe block below
  // for explicit pass/fail tests.
  it("NEAR_RESISTANCE + STRONG_UP + HIGH conf, no candles → NO_CLEAR_EDGE (gates fail closed)", () => {
    const r = toIntelligence(baseInput({
      sr: nearRes,
      momentum: makeMomentum("STRONG_UP", 0.95),
      pressure: makePressure("STRONG_BUY", 0.95),
      high: 1030, low: 1000,
    }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
  });

  it("NEAR_RESISTANCE + STRONG_UP + LOW conf → NO_CLEAR_EDGE", () => {
    const r = toIntelligence(baseInput({
      sr: nearRes,
      momentum: makeMomentum("STRONG_UP", 0.95),
      pressure: makePressure("NEUTRAL", 0),
      high: 1003, low: 1000,
    }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
  });

  it("NEAR_RESISTANCE + STRONG_DOWN + HIGH conf → REJECTION_POSSIBLE", () => {
    const r = toIntelligence(baseInput({
      sr: nearRes,
      momentum: makeMomentum("STRONG_DOWN", -0.95),
      pressure: makePressure("STRONG_SELL", -0.95),
      high: 1003, low: 1000,
    }));
    assert.equal(r.outlook, "REJECTION_POSSIBLE");
  });

  it("NEAR_RESISTANCE + STRONG_DOWN + MED/LOW conf → NO_CLEAR_EDGE (HIGH floor filters mid-grade setups)", () => {
    const r = toIntelligence(baseInput({
      sr: nearRes,
      momentum: makeMomentum("STRONG_DOWN", -0.7),
      pressure: makePressure("STRONG_SELL", -0.7),
    }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
  });

  it("NEAR_RESISTANCE + WEAK_DOWN → NO_CLEAR_EDGE (HIGH floor filters weak setups)", () => {
    const r = toIntelligence(baseInput({
      sr: nearRes,
      momentum: makeMomentum("DOWN", -0.4),
      pressure: makePressure("SELL", -0.4),
    }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
  });

  it("NEAR_RESISTANCE + NEUTRAL momentum → NO_CLEAR_EDGE (not REJECTION)", () => {
    const r = toIntelligence(baseInput({
      sr: nearRes,
      momentum: makeMomentum("FLAT", 0),
      pressure: makePressure("NEUTRAL", 0),
    }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
  });

  // Re-enabled 2026-05-10 with strict gates. Without recentCandles the gates
  // fail closed (insufficient data), so still NO_CLEAR_EDGE. Pass/fail tests
  // with real candle data are in the "Breakout / Breakdown gates" describe
  // block below.
  it("NEAR_SUPPORT + STRONG_DOWN + HIGH conf, no candles → NO_CLEAR_EDGE (gates fail closed)", () => {
    const r = toIntelligence(baseInput({
      sr: nearSup,
      momentum: makeMomentum("STRONG_DOWN", -0.95),
      pressure: makePressure("STRONG_SELL", -0.95),
      high: 1030, low: 1000,
    }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
  });

  // Post-2026-05-07: BOUNCE_EXPECTED needs HIGH confidence (>0.7).
  // Values below would land in MEDIUM (~0.6) and return NO_CLEAR_EDGE.
  it("NEAR_SUPPORT + STRONG_UP at HIGH conf → BOUNCE_EXPECTED", () => {
    const r = toIntelligence(baseInput({
      sr: nearSup,
      momentum: makeMomentum("STRONG_UP", 0.9),
      pressure: makePressure("STRONG_BUY", 0.9),
    }));
    assert.equal(r.outlook, "BOUNCE_EXPECTED");
  });

  // Post-2026-05-07 single-pool model: BOUNCE_EXPECTED requires HIGH
  // confidence (>0.7). WEAK_UP at value 0.4 with BUY pressure 0.4 produces
  // confidence ≈ 0.35 (LOW bucket) → no signal.
  it("NEAR_SUPPORT + WEAK_UP at low confidence → NO_CLEAR_EDGE", () => {
    const r = toIntelligence(baseInput({
      sr: nearSup,
      momentum: makeMomentum("UP", 0.4),
      pressure: makePressure("BUY", 0.4),
    }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
  });

  it("NEAR_SUPPORT + WEAK_UP at HIGH confidence → BOUNCE_EXPECTED", () => {
    const r = toIntelligence(baseInput({
      sr: nearSup,
      momentum: makeMomentum("UP", 0.9),
      pressure: makePressure("STRONG_BUY", 0.9),
    }));
    assert.equal(r.outlook, "BOUNCE_EXPECTED");
  });

  it("NEAR_SUPPORT + FLAT → NO_CLEAR_EDGE", () => {
    const r = toIntelligence(baseInput({
      sr: nearSup,
      momentum: makeMomentum("FLAT", 0),
      pressure: makePressure("NEUTRAL", 0),
    }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
  });

  it("MID_RANGE always → NO_CLEAR_EDGE", () => {
    const r = toIntelligence(baseInput({
      sr: makeSr({ support: { level: 900, dist: 10 }, resistance: { level: 1100, dist: 10 } }),
      momentum: makeMomentum("STRONG_UP", 0.9),
      pressure: makePressure("STRONG_BUY", 0.9),
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
// the LAST candle's volume is > 1.5× the average of the prior 20.
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
  // prior 20 vol avg = (19×1000 + 1×1500)/20 = 1025  →  current 2500 ≥ 1.5×1025 = 1537.5 ✓
  // prior 5 (candles 14-18) max-high = 1000  →  candles 19,20 close = 1006,1008 > 1000 ✓
}

function buildBreakdownCandles(): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < 19; i++) {
    candles.push({ time: 1700000000 + i * 300, open: 1003, high: 1005, low: 1000, close: 1003, volume: 1000 });
  }
  candles.push({ time: 1700000000 + 19 * 300, open: 999, high: 1000, low: 990, close: 994, volume: 1500 });
  candles.push({ time: 1700000000 + 20 * 300, open: 994, high: 997, low: 988, close: 992, volume: 2500 }); // current — vol surge
  return candles;
  // prior 5 min-low = 1000  →  candles 19,20 close = 994,992 < 1000 ✓
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

  it("Breakout: confirmation fails (only 1 of 2 closes above max-high) → NO_CLEAR_EDGE", () => {
    const candles = buildBreakoutCandles();
    candles[candles.length - 2].close = 999; // pull the second-to-last close back below 1000
    const r = toIntelligence(baseInput({
      sr: nearRes,
      momentum: makeMomentum("STRONG_UP", 0.95),
      pressure: makePressure("STRONG_BUY", 0.95),
      recentCandles: candles,
    }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
  });

  it("Breakout: insufficient candles (only 6) → NO_CLEAR_EDGE", () => {
    const r = toIntelligence(baseInput({
      sr: nearRes,
      momentum: makeMomentum("STRONG_UP", 0.95),
      pressure: makePressure("STRONG_BUY", 0.95),
      recentCandles: buildBreakoutCandles().slice(-6),
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

  it("Breakdown: confirmation fails (only 1 close below min-low) → NO_CLEAR_EDGE", () => {
    const candles = buildBreakdownCandles();
    candles[candles.length - 2].close = 1001; // pull second-to-last back above min-low (1000)
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

  // Bounce / Rejection paths must remain unaffected by the candles array
  // length — they don't consult the gates at all.
  it("Bounce path unaffected by 21-candle stream", () => {
    const r = toIntelligence(baseInput({
      sr: nearSup,
      momentum: makeMomentum("STRONG_UP", 0.9),
      pressure: makePressure("STRONG_BUY", 0.9),
      recentCandles: buildBreakoutCandles(),  // 21 candles passed but Bounce ignores gates
    }));
    assert.equal(r.outlook, "BOUNCE_EXPECTED");
  });

  it("Rejection path unaffected by 21-candle stream", () => {
    const r = toIntelligence(baseInput({
      sr: nearRes,
      momentum: makeMomentum("STRONG_DOWN", -0.9),
      pressure: makePressure("STRONG_SELL", -0.9),
      recentCandles: buildBreakdownCandles(),
    }));
    assert.equal(r.outlook, "REJECTION_POSSIBLE");
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

  it("indices: 0.2% per candle reads STRONG_UP", () => {
    const c = [flatCandle(24000, 0.002), flatCandle(24048, 0.002), flatCandle(24096, 0.002)];
    const m = getMomentum(c, true);
    assert.ok(m);
    // 0.002 / 0.001 = 2.0 → clamped to 1.0 → STRONG_UP threshold (>0.6)
    assert.equal(m!.signal, "STRONG_UP");
  });
});
