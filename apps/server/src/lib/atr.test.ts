import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeATR } from "./atr.js";
import type { Candle } from "./types.js";

function c(open: number, high: number, low: number, close: number, volume = 1000): Candle {
  return { time: 0, open, high, low, close, volume };
}

describe("computeATR", () => {
  it("returns null for undefined", () => {
    assert.equal(computeATR(undefined), null);
  });

  it("returns null for empty array", () => {
    assert.equal(computeATR([]), null);
  });

  it("returns null for a single candle (no prior close to compute TR)", () => {
    assert.equal(computeATR([c(100, 102, 99, 101)]), null);
  });

  it("computes a known 2-candle ATR (simple inside-bar)", () => {
    // Prev close 100, current high 105, low 95 → TR = max(10, 5, 5) = 10
    const atr = computeATR([c(99, 101, 98, 100), c(101, 105, 95, 102)]);
    assert.equal(atr, 10);
  });

  it("uses |high - prevClose| as the dominant TR when there is a gap up", () => {
    // Prev close 100, gap-open to 110, intracandle low 108, high 112
    // TR = max(112-108=4, |112-100|=12, |108-100|=8) = 12
    const atr = computeATR([c(99, 101, 99, 100), c(110, 112, 108, 111)]);
    assert.equal(atr, 12);
  });

  it("uses |low - prevClose| as the dominant TR when there is a gap down", () => {
    // Prev close 100, gap-down low 88, high 92
    // TR = max(92-88=4, |92-100|=8, |88-100|=12) = 12
    const atr = computeATR([c(101, 102, 99, 100), c(90, 92, 88, 91)]);
    assert.equal(atr, 12);
  });

  it("averages TR across multiple candles", () => {
    // 3 candles → 2 TR values
    //   c1→c2: prev close 100, hi 105, lo 99 → TR = max(6, 5, 1) = 6
    //   c2→c3: prev close 104, hi 110, lo 103 → TR = max(7, 6, 1) = 7
    //   ATR = (6 + 7) / 2 = 6.5
    const atr = computeATR([c(99, 102, 99, 100), c(101, 105, 99, 104), c(105, 110, 103, 108)]);
    assert.equal(atr, 6.5);
  });

  it("respects the period arg (slices to last period+1 candles)", () => {
    // Build 20 candles each with TR ≈ 5; ATR(14) and ATR(7) should both ≈ 5
    const candles: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      candles.push(c(100 + i, 103 + i, 98 + i, 101 + i));
    }
    const atr14 = computeATR(candles, 14);
    const atr7 = computeATR(candles, 7);
    assert.ok(atr14 != null && atr14 > 4 && atr14 < 6, `atr14=${atr14}`);
    assert.ok(atr7 != null && atr7 > 4 && atr7 < 6, `atr7=${atr7}`);
  });

  it("falls back to all available candles when fewer than period+1 are provided", () => {
    // 3 candles + period=14 → still computes from the 2 TRs we can get
    const atr = computeATR([c(99, 102, 99, 100), c(101, 105, 99, 104)], 14);
    assert.notEqual(atr, null);
    assert.ok((atr as number) > 0);
  });
});
