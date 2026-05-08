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

  // Post-2026-05-07: BREAKOUT_LIKELY was retired (sub-50% accuracy in prod).
  // The transformer now returns NO_CLEAR_EDGE for what would have been a
  // BREAKOUT setup, regardless of confidence.
  it("NEAR_RESISTANCE + STRONG_UP + HIGH conf → NO_CLEAR_EDGE (Breakout retired)", () => {
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

  // Post-2026-05-07: BREAKDOWN_RISK was retired (negative expectancy in prod).
  // The transformer now returns NO_CLEAR_EDGE for what would have been a
  // BREAKDOWN setup, regardless of confidence.
  it("NEAR_SUPPORT + STRONG_DOWN + HIGH conf → NO_CLEAR_EDGE (Breakdown retired)", () => {
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
