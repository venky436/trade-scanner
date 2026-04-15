import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMarketContext, toIntelligence, type IntelligenceInput } from "./intelligence-transformer.js";
import type { MomentumResult, PressureResult, SupportResistanceResult, SRZone } from "./types.js";

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

  it("high aligned momentum + pressure near support + LOW volatility → MEDIUM confidence", () => {
    const r = toIntelligence(baseInput({
      sr: makeSr({ support: { level: 995, dist: 0.5 }, resistance: { level: 1100, dist: 10 } }),
      momentum: makeMomentum("STRONG_UP", 0.9),
      pressure: makePressure("STRONG_BUY", 0.9),
      high: 1003, low: 1000, // 0.3% range -> volatility 0.2
    }));
    // direction=BUY, aligned m=0.9, aligned p=0.9
    // 0.9 * (0.7 + 0.2*0.3) = 0.9 * 0.76 = 0.684
    assert.ok(r.confidence > 0.5 && r.confidence <= 0.7, `expected MEDIUM, got ${r.confidence}`);
    assert.equal(r.confidenceLabel, "MEDIUM");
  });

  it("wrong-direction pressure near support → LOW confidence", () => {
    const r = toIntelligence(baseInput({
      sr: makeSr({ support: { level: 995, dist: 0.5 }, resistance: { level: 1100, dist: 10 } }),
      momentum: makeMomentum("WEAK_UP", 0.2),
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
      momentum: makeMomentum("WEAK_UP", 0.1),
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

  it("NEAR_RESISTANCE + STRONG_UP + HIGH conf → BREAKOUT_LIKELY", () => {
    const r = toIntelligence(baseInput({
      sr: nearRes,
      momentum: makeMomentum("STRONG_UP", 0.95),
      pressure: makePressure("STRONG_BUY", 0.95),
      high: 1030, low: 1000,
    }));
    assert.equal(r.outlook, "BREAKOUT_LIKELY");
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

  it("NEAR_RESISTANCE + STRONG_DOWN → REJECTION_POSSIBLE", () => {
    const r = toIntelligence(baseInput({
      sr: nearRes,
      momentum: makeMomentum("STRONG_DOWN", -0.7),
      pressure: makePressure("STRONG_SELL", -0.7),
    }));
    assert.equal(r.outlook, "REJECTION_POSSIBLE");
  });

  it("NEAR_RESISTANCE + WEAK_DOWN → REJECTION_POSSIBLE", () => {
    const r = toIntelligence(baseInput({
      sr: nearRes,
      momentum: makeMomentum("DOWN", -0.4),
      pressure: makePressure("SELL", -0.4),
    }));
    assert.equal(r.outlook, "REJECTION_POSSIBLE");
  });

  it("NEAR_RESISTANCE + NEUTRAL momentum → NO_CLEAR_EDGE (not REJECTION)", () => {
    const r = toIntelligence(baseInput({
      sr: nearRes,
      momentum: makeMomentum("FLAT", 0),
      pressure: makePressure("NEUTRAL", 0),
    }));
    assert.equal(r.outlook, "NO_CLEAR_EDGE");
  });

  it("NEAR_SUPPORT + STRONG_DOWN + HIGH conf → BREAKDOWN_RISK", () => {
    const r = toIntelligence(baseInput({
      sr: nearSup,
      momentum: makeMomentum("STRONG_DOWN", -0.95),
      pressure: makePressure("STRONG_SELL", -0.95),
      high: 1030, low: 1000,
    }));
    assert.equal(r.outlook, "BREAKDOWN_RISK");
  });

  it("NEAR_SUPPORT + STRONG_UP → BOUNCE_EXPECTED", () => {
    const r = toIntelligence(baseInput({
      sr: nearSup,
      momentum: makeMomentum("STRONG_UP", 0.7),
      pressure: makePressure("STRONG_BUY", 0.7),
    }));
    assert.equal(r.outlook, "BOUNCE_EXPECTED");
  });

  it("NEAR_SUPPORT + WEAK_UP → BOUNCE_EXPECTED", () => {
    const r = toIntelligence(baseInput({
      sr: nearSup,
      momentum: makeMomentum("UP", 0.4),
      pressure: makePressure("BUY", 0.4),
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
