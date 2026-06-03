import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeMarketRegime } from "./market-regime.js";
import type { MarketContext } from "./types.js";

function ctx(nifty: number, bankNifty: number): MarketContext {
  return {
    condition: Math.abs(nifty) >= 0.3 ? "TRENDING" : "SIDEWAYS",
    nifty: { direction: nifty > 0 ? "UP" : nifty < 0 ? "DOWN" : "FLAT", changePercent: nifty },
    bankNifty: { direction: bankNifty > 0 ? "UP" : bankNifty < 0 ? "DOWN" : "FLAT", changePercent: bankNifty },
  };
}

describe("computeMarketRegime", () => {
  it("RANGING for null market", () => {
    assert.equal(computeMarketRegime(null), "RANGING");
  });

  it("RANGING when both indices are within ±0.6%", () => {
    assert.equal(computeMarketRegime(ctx(0.3, 0.4)), "RANGING");
    assert.equal(computeMarketRegime(ctx(-0.5, 0.2)), "RANGING");
  });

  it("TRENDING_UP when NIFTY ≥ 0.6%", () => {
    assert.equal(computeMarketRegime(ctx(0.6, 0.3)), "TRENDING_UP");
    assert.equal(computeMarketRegime(ctx(0.9, -0.1)), "TRENDING_UP");
  });

  it("TRENDING_DOWN when NIFTY ≤ -0.6%", () => {
    assert.equal(computeMarketRegime(ctx(-0.6, 0.1)), "TRENDING_DOWN");
  });

  it("HIGH_VOLATILITY when either index ≥ 1.2% magnitude (overrides direction)", () => {
    assert.equal(computeMarketRegime(ctx(1.5, 0.1)), "HIGH_VOLATILITY");
    assert.equal(computeMarketRegime(ctx(0.1, -1.3)), "HIGH_VOLATILITY");
    assert.equal(computeMarketRegime(ctx(-1.4, -2.0)), "HIGH_VOLATILITY");
  });

  it("trending direction reflects NIFTY only — BANKNIFTY divergence ignored", () => {
    assert.equal(computeMarketRegime(ctx(0.8, -0.5)), "TRENDING_UP");
    assert.equal(computeMarketRegime(ctx(-0.8, 0.5)), "TRENDING_DOWN");
  });
});
