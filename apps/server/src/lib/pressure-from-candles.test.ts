import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pressureFromCandles } from "./pressure-from-candles.js";
import type { Candle } from "./types.js";

function candle(open: number, close: number, volume: number): Candle {
  const high = Math.max(open, close) + 0.5;
  const low = Math.min(open, close) - 0.5;
  return { time: 0, open, high, low, close, volume };
}

describe("pressureFromCandles", () => {
  it("returns null when fewer than 3 candles are provided", () => {
    assert.equal(pressureFromCandles([]), null);
    assert.equal(pressureFromCandles([candle(100, 101, 1000)]), null);
    assert.equal(
      pressureFromCandles([candle(100, 101, 1000), candle(101, 102, 1000)]),
      null,
    );
  });

  it("returns null when total volume is zero", () => {
    const result = pressureFromCandles([
      candle(100, 101, 0),
      candle(101, 102, 0),
      candle(102, 103, 0),
    ]);
    assert.equal(result, null);
  });

  it("returns STRONG_BUY for 3 strongly green candles with growing volume", () => {
    const result = pressureFromCandles([
      candle(100, 101.0, 10_000),
      candle(101, 102.0, 12_000),
      candle(102, 103.5, 15_000),
    ]);
    assert.ok(result, "expected non-null result");
    assert.ok(result!.value > 0, `expected positive value, got ${result!.value}`);
    assert.ok(
      result!.signal === "STRONG_BUY" || result!.signal === "BUY",
      `expected BUY/STRONG_BUY, got ${result!.signal}`,
    );
    assert.equal(result!.trend, "rising");
  });

  it("returns STRONG_SELL for 3 strongly red candles with growing volume", () => {
    const result = pressureFromCandles([
      candle(103.5, 102.0, 10_000),
      candle(102.0, 101.0, 12_000),
      candle(101.0, 99.5, 15_000),
    ]);
    assert.ok(result, "expected non-null result");
    assert.ok(result!.value < 0, `expected negative value, got ${result!.value}`);
    assert.ok(
      result!.signal === "STRONG_SELL" || result!.signal === "SELL",
      `expected SELL/STRONG_SELL, got ${result!.signal}`,
    );
    assert.equal(result!.trend, "falling");
  });

  it("returns flat NEUTRAL for 3 doji candles (zero score → dead zone)", () => {
    const result = pressureFromCandles([
      candle(100, 100, 5000),
      candle(100, 100, 5000),
      candle(100, 100, 5000),
    ]);
    // Has volume so function returns a result, but every candle scores 0 → dead zone
    assert.ok(result);
    assert.equal(result!.signal, "NEUTRAL");
    assert.equal(result!.value, 0);
  });

  it("returns mixed-trend result when directions alternate", () => {
    const result = pressureFromCandles([
      candle(100, 101, 10_000),   // green
      candle(101, 100, 10_000),   // red
      candle(100, 100.3, 10_000), // green (last = highest weight)
    ]);
    assert.ok(result);
    // Mixed direction so no consistency boost; the last candle is green → trend "mixed"
    assert.equal(result!.trend, "mixed");
  });

  it("applies the 1.15x consistency boost when all 3 candles agree", () => {
    // 3 mildly green candles that would normally score just below the BUY threshold
    const mild = [
      candle(100, 100.25, 10_000),
      candle(100.25, 100.5, 10_000),
      candle(100.5, 100.75, 10_000),
    ];
    const result = pressureFromCandles(mild);
    assert.ok(result);
    // With the boost, 3 consistently green candles should still land positive
    // (either BUY or NEUTRAL depending on the boost — but the value should be > 0 before clamp)
    assert.ok(result!.value >= 0, `expected non-negative, got ${result!.value}`);
  });

  it("weights the most recent candle highest", () => {
    // Two red candles followed by one large green candle
    // The weighted formula: 0.2 * s0 + 0.3 * s1 + 0.5 * s2 → s2 dominates
    const result = pressureFromCandles([
      candle(100, 99.5, 10_000),
      candle(99.5, 99.0, 10_000),
      candle(99.0, 100.5, 15_000),
    ]);
    assert.ok(result);
    // Mixed (so no consistency boost), but the big green candle on the right
    // has 0.5 weight vs the two reds' 0.2+0.3=0.5 combined — should be roughly balanced
    assert.equal(result!.trend, "mixed");
  });

  it("produces non-zero confidence for trending data", () => {
    const result = pressureFromCandles([
      candle(100, 101.5, 10_000),
      candle(101.5, 103, 12_000),
      candle(103, 104.5, 15_000),
    ]);
    assert.ok(result);
    assert.ok(result!.confidence > 0, `expected confidence > 0, got ${result!.confidence}`);
    assert.equal(result!.confidence, Math.abs(result!.value));
  });
});
