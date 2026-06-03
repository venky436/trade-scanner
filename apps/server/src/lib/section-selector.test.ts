import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ZONE_SECTION_CAP,
  ZONE_SECTION_CONF_FLOOR,
  STRONG_ALIGNMENT_CAP,
  STRONG_ALIGNMENT_FLOOR,
  selectNearSupport,
  selectNearResistance,
  selectStrongAlignment,
  selectAiTargets,
} from "./section-selector.js";
import type { IntelligenceSnapshot, Zone, Outlook } from "./types.js";

function snap(opts: {
  symbol: string;
  zone?: Zone;
  outlook?: Outlook;
  confidence?: number;
}): IntelligenceSnapshot {
  return {
    symbol: opts.symbol,
    price: 100,
    change: 0,
    timestamp: 0,
    context: { zone: opts.zone ?? "MID_RANGE", distanceToLevel: null, level: null },
    momentum: { label: "NEUTRAL", score: 0 },
    pressure: { label: "NEUTRAL", score: 0 },
    volatility: { label: "LOW", score: 0.2 },
    outlook: opts.outlook ?? "NO_CLEAR_EDGE",
    bias: "NEUTRAL",
    confidence: opts.confidence ?? 0,
    confidenceLabel: "LOW",
    tradePlan: null,
  };
}

describe("section-selector — selectNearSupport", () => {
  it("returns stocks in NEAR_SUPPORT zone above the confidence floor, sorted by confidence DESC", () => {
    const result = selectNearSupport([
      snap({ symbol: "A", zone: "NEAR_SUPPORT", confidence: 0.7 }),
      snap({ symbol: "B", zone: "NEAR_SUPPORT", confidence: 0.9 }),
      snap({ symbol: "C", zone: "NEAR_SUPPORT", confidence: 0.8 }),
    ]);
    assert.deepEqual(result.map((s) => s.symbol), ["B", "C", "A"]);
  });

  it("excludes stocks below the confidence floor", () => {
    const result = selectNearSupport([
      snap({ symbol: "LOW", zone: "NEAR_SUPPORT", confidence: 0.5 }),
      snap({ symbol: "JUST_OVER", zone: "NEAR_SUPPORT", confidence: 0.66 }),
    ]);
    assert.deepEqual(result.map((s) => s.symbol), ["JUST_OVER"]);
  });

  it("excludes stocks with the floor as a strict-less-than (boundary at exactly floor passes)", () => {
    const result = selectNearSupport([
      snap({ symbol: "EQUAL", zone: "NEAR_SUPPORT", confidence: ZONE_SECTION_CONF_FLOOR }),
    ]);
    assert.equal(result.length, 1, "≥ floor should pass");
  });

  it("excludes stocks in other zones", () => {
    const result = selectNearSupport([
      snap({ symbol: "SUP", zone: "NEAR_SUPPORT", confidence: 0.9 }),
      snap({ symbol: "RES", zone: "NEAR_RESISTANCE", confidence: 0.9 }),
      snap({ symbol: "MID", zone: "MID_RANGE", confidence: 0.9 }),
    ]);
    assert.deepEqual(result.map((s) => s.symbol), ["SUP"]);
  });

  it("caps at ZONE_SECTION_CAP", () => {
    const candidates = Array.from({ length: 20 }, (_, i) =>
      snap({ symbol: `S${i}`, zone: "NEAR_SUPPORT", confidence: 0.7 + i * 0.01 }),
    );
    const result = selectNearSupport(candidates);
    assert.equal(result.length, ZONE_SECTION_CAP);
  });

  it("excludes index symbols", () => {
    const result = selectNearSupport([
      snap({ symbol: "NIFTY 50", zone: "NEAR_SUPPORT", confidence: 0.95 }),
      snap({ symbol: "NIFTY BANK", zone: "NEAR_SUPPORT", confidence: 0.92 }),
      snap({ symbol: "RELIANCE", zone: "NEAR_SUPPORT", confidence: 0.7 }),
    ]);
    assert.deepEqual(result.map((s) => s.symbol), ["RELIANCE"]);
  });

  it("does not mutate the input array", () => {
    const input = [
      snap({ symbol: "A", zone: "NEAR_SUPPORT", confidence: 0.7 }),
      snap({ symbol: "B", zone: "NEAR_SUPPORT", confidence: 0.9 }),
    ];
    const inputCopy = [...input];
    selectNearSupport(input);
    assert.deepEqual(input, inputCopy);
  });
});

describe("section-selector — selectNearResistance", () => {
  it("mirrors selectNearSupport but on the resistance zone", () => {
    const result = selectNearResistance([
      snap({ symbol: "SUP", zone: "NEAR_SUPPORT", confidence: 0.9 }),
      snap({ symbol: "RES", zone: "NEAR_RESISTANCE", confidence: 0.9 }),
    ]);
    assert.deepEqual(result.map((s) => s.symbol), ["RES"]);
  });

  it("respects the confidence floor + cap", () => {
    const candidates = [
      ...Array.from({ length: 10 }, (_, i) =>
        snap({ symbol: `R${i}`, zone: "NEAR_RESISTANCE", confidence: 0.7 + i * 0.01 }),
      ),
      snap({ symbol: "BELOW", zone: "NEAR_RESISTANCE", confidence: 0.5 }),
    ];
    const result = selectNearResistance(candidates);
    assert.equal(result.length, ZONE_SECTION_CAP);
    assert.ok(result.every((s) => s.symbol !== "BELOW"));
  });
});

describe("section-selector — selectStrongAlignment", () => {
  it("requires confidence ≥ 0.85 AND directional outlook", () => {
    const result = selectStrongAlignment([
      snap({ symbol: "HIGH_DIR", zone: "NEAR_SUPPORT", confidence: 0.9, outlook: "BOUNCE_EXPECTED" }),
      snap({ symbol: "HIGH_NODIR", zone: "MID_RANGE", confidence: 0.9, outlook: "NO_CLEAR_EDGE" }),
      snap({ symbol: "LOW_DIR", zone: "NEAR_SUPPORT", confidence: 0.7, outlook: "BOUNCE_EXPECTED" }),
    ]);
    assert.deepEqual(result.map((s) => s.symbol), ["HIGH_DIR"]);
  });

  it("accepts all four directional outlooks", () => {
    const outlooks: Outlook[] = ["BOUNCE_EXPECTED", "REJECTION_POSSIBLE", "BREAKOUT_LIKELY", "BREAKDOWN_RISK"];
    const result = selectStrongAlignment(
      outlooks.map((o, i) =>
        snap({ symbol: o, zone: "NEAR_SUPPORT", confidence: 0.9 - i * 0.01, outlook: o }),
      ),
    );
    assert.deepEqual(result.map((s) => s.symbol), outlooks);
  });

  it("rejects NO_CLEAR_EDGE even at maximum confidence", () => {
    const result = selectStrongAlignment([
      snap({ symbol: "PERFECT_NULL", zone: "NEAR_SUPPORT", confidence: 1.0, outlook: "NO_CLEAR_EDGE" }),
    ]);
    assert.equal(result.length, 0);
  });

  it("caps at STRONG_ALIGNMENT_CAP", () => {
    const candidates = Array.from({ length: 12 }, (_, i) =>
      snap({ symbol: `S${i}`, zone: "NEAR_SUPPORT", confidence: 0.86 + i * 0.005, outlook: "BOUNCE_EXPECTED" }),
    );
    const result = selectStrongAlignment(candidates);
    assert.equal(result.length, STRONG_ALIGNMENT_CAP);
  });

  it("boundary: confidence exactly at STRONG_ALIGNMENT_FLOOR passes", () => {
    const result = selectStrongAlignment([
      snap({
        symbol: "EXACT",
        zone: "NEAR_SUPPORT",
        confidence: STRONG_ALIGNMENT_FLOOR,
        outlook: "BOUNCE_EXPECTED",
      }),
    ]);
    assert.equal(result.length, 1);
  });

  it("excludes index symbols regardless of confidence", () => {
    const result = selectStrongAlignment([
      snap({ symbol: "NIFTY 50", zone: "NEAR_SUPPORT", confidence: 0.95, outlook: "BOUNCE_EXPECTED" }),
    ]);
    assert.equal(result.length, 0);
  });
});

describe("section-selector — selectAiTargets (union, deduped)", () => {
  it("returns the union of all three lanes, deduped by symbol", () => {
    const stocks: IntelligenceSnapshot[] = [
      // Will appear in NEAR_SUPPORT + Strong Alignment (deduped)
      snap({ symbol: "DUAL", zone: "NEAR_SUPPORT", confidence: 0.9, outlook: "BOUNCE_EXPECTED" }),
      // NEAR_SUPPORT only
      snap({ symbol: "SUP_ONLY", zone: "NEAR_SUPPORT", confidence: 0.7, outlook: "NO_CLEAR_EDGE" }),
      // NEAR_RESISTANCE only
      snap({ symbol: "RES_ONLY", zone: "NEAR_RESISTANCE", confidence: 0.75, outlook: "NO_CLEAR_EDGE" }),
      // Strong Alignment only (MID_RANGE — doesn't qualify for Strong Alignment because directional needs a zone; but the function doesn't enforce that)
      // Actually directional outlooks come from zone-aware logic, so MID_RANGE + directional is unlikely in practice but
      // selectStrongAlignment doesn't filter on zone — let it through if AI thinks so.
      snap({ symbol: "STRONG_MID", zone: "MID_RANGE", confidence: 0.9, outlook: "BREAKOUT_LIKELY" }),
    ];
    const result = selectAiTargets(stocks);
    const symbols = result.map((s) => s.symbol);
    assert.ok(symbols.includes("DUAL"));
    assert.ok(symbols.includes("SUP_ONLY"));
    assert.ok(symbols.includes("RES_ONLY"));
    assert.ok(symbols.includes("STRONG_MID"));
    // DUAL must appear exactly once (dedup)
    assert.equal(symbols.filter((s) => s === "DUAL").length, 1);
  });

  it("preserves first-lane order — NEAR_SUPPORT symbols come before NEAR_RESISTANCE before Strong Alignment", () => {
    const stocks: IntelligenceSnapshot[] = [
      snap({ symbol: "S1", zone: "NEAR_SUPPORT", confidence: 0.8 }),
      snap({ symbol: "R1", zone: "NEAR_RESISTANCE", confidence: 0.8 }),
      snap({ symbol: "SA1", zone: "MID_RANGE", confidence: 0.9, outlook: "BREAKOUT_LIKELY" }),
    ];
    const result = selectAiTargets(stocks);
    assert.deepEqual(result.map((s) => s.symbol), ["S1", "R1", "SA1"]);
  });

  it("returns empty list when nothing qualifies", () => {
    const result = selectAiTargets([
      snap({ symbol: "WEAK", zone: "NEAR_SUPPORT", confidence: 0.1 }),
      snap({ symbol: "MID", zone: "MID_RANGE", confidence: 0.5 }),
    ]);
    assert.equal(result.length, 0);
  });

  it("hard cap: union never exceeds 2 × ZONE_SECTION_CAP + STRONG_ALIGNMENT_CAP", () => {
    const candidates: IntelligenceSnapshot[] = [];
    // Flood every lane with distinct symbols
    for (let i = 0; i < 30; i++) {
      candidates.push(
        snap({ symbol: `SUP_${i}`, zone: "NEAR_SUPPORT", confidence: 0.7 + (i % 10) * 0.01 }),
      );
      candidates.push(
        snap({ symbol: `RES_${i}`, zone: "NEAR_RESISTANCE", confidence: 0.7 + (i % 10) * 0.01 }),
      );
      candidates.push(
        snap({
          symbol: `SA_${i}`,
          zone: "MID_RANGE",
          confidence: 0.86 + (i % 10) * 0.001,
          outlook: "BREAKOUT_LIKELY",
        }),
      );
    }
    const result = selectAiTargets(candidates);
    const maxExpected = ZONE_SECTION_CAP * 2 + STRONG_ALIGNMENT_CAP;
    assert.ok(result.length <= maxExpected, `expected ≤ ${maxExpected}, got ${result.length}`);
  });
});
