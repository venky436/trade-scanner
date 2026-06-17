import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeAtrPct,
  computeRvol,
  computeCandleVolMultiplier,
  computeCandleDirection,
  computeDayRangePosition,
  computeDayMovePct,
  computeDistanceToLevel,
  getLastNCandlesNewestFirst,
} from "./volatility-metrics.js";
import type { Candle } from "./types.js";

function c(
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1000,
  time = 0,
): Candle {
  return { time, open, high, low, close, volume };
}

describe("computeAtrPct", () => {
  it("returns null when atr is null", () => {
    assert.equal(computeAtrPct(null, 100), null);
  });

  it("returns null when price is zero or negative", () => {
    assert.equal(computeAtrPct(5, 0), null);
    assert.equal(computeAtrPct(5, -10), null);
  });

  it("returns null when atr is negative or non-finite", () => {
    assert.equal(computeAtrPct(-1, 100), null);
    assert.equal(computeAtrPct(Number.NaN, 100), null);
    assert.equal(computeAtrPct(Number.POSITIVE_INFINITY, 100), null);
  });

  it("computes ATR as a percentage of price", () => {
    // ATR 5 on a 250 stock → 2.0%
    assert.equal(computeAtrPct(5, 250), 2.0);
    // ATR 10 on a 2500 stock → 0.4%
    assert.equal(computeAtrPct(10, 2500), 0.4);
  });

  it("handles zero ATR (perfectly flat) → 0%", () => {
    assert.equal(computeAtrPct(0, 100), 0);
  });
});

describe("computeRvol", () => {
  it("returns null when fewer than 6 candles", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 5; i++) candles.push(c(100, 102, 99, 101, 1000));
    assert.equal(computeRvol(candles), null);
  });

  it("returns null when the most recent candle has zero volume", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 5; i++) candles.push(c(100, 102, 99, 101, 1000));
    candles.push(c(100, 102, 99, 101, 0));
    assert.equal(computeRvol(candles), null);
  });

  it("computes recent / mean(last 20 prior)", () => {
    // 6 candles, each prior volume = 1000, recent volume = 2000 → RVOL = 2.0
    const candles: Candle[] = [];
    for (let i = 0; i < 5; i++) candles.push(c(100, 102, 99, 101, 1000));
    candles.push(c(100, 102, 99, 101, 2000));
    assert.equal(computeRvol(candles), 2.0);
  });

  it("caps the sample window at the prior 20 candles", () => {
    // 50 candles: first 30 = vol 99999, next 19 = vol 1000, recent = 2000.
    // Sample should be the 19 prior candles before recent (mean = 1000) → 2.0.
    // (Implementation slices `-min(20, len-1), -1` so the cap is enforced.)
    const candles: Candle[] = [];
    for (let i = 0; i < 30; i++) candles.push(c(100, 102, 99, 101, 99999));
    for (let i = 0; i < 19; i++) candles.push(c(100, 102, 99, 101, 1000));
    candles.push(c(100, 102, 99, 101, 2000));
    assert.equal(computeRvol(candles), 2.0);
  });
});

describe("computeCandleVolMultiplier", () => {
  it("returns null when the candle volume is zero", () => {
    const target = c(100, 102, 99, 101, 0);
    const window = [c(100, 102, 99, 101, 1000), c(100, 102, 99, 101, 1000), target];
    assert.equal(computeCandleVolMultiplier(target, window), null);
  });

  it("returns null when no other candle has positive volume", () => {
    const target = c(100, 102, 99, 101, 5000);
    assert.equal(computeCandleVolMultiplier(target, [target]), null);
  });

  it("computes candle vol vs mean of other candles in window", () => {
    const target = c(100, 102, 99, 101, 2000);
    const window = [
      c(100, 102, 99, 101, 1000),
      c(100, 102, 99, 101, 1000),
      target,
    ];
    // others avg = 1000, target = 2000 → 2.0
    assert.equal(computeCandleVolMultiplier(target, window), 2.0);
  });

  it("ignores zero-volume candles when averaging others", () => {
    const target = c(100, 102, 99, 101, 1500);
    const window = [
      c(100, 102, 99, 101, 1000),
      c(100, 102, 99, 101, 0),    // ignored
      c(100, 102, 99, 101, 500),
      target,
    ];
    // others (excluding zero) = (1000 + 500) / 2 = 750; 1500 / 750 = 2.0
    assert.equal(computeCandleVolMultiplier(target, window), 2.0);
  });
});

describe("computeCandleDirection", () => {
  it("returns 'up' when close > open", () => {
    assert.equal(computeCandleDirection(c(100, 105, 99, 104)), "up");
  });
  it("returns 'down' when close < open", () => {
    assert.equal(computeCandleDirection(c(100, 102, 95, 96)), "down");
  });
  it("returns 'flat' when close === open", () => {
    assert.equal(computeCandleDirection(c(100, 102, 98, 100)), "flat");
  });
});

describe("computeDayRangePosition", () => {
  it("returns null when range is zero", () => {
    assert.equal(computeDayRangePosition(100, 100, 100), null);
  });

  it("returns null when range is negative (corrupt input)", () => {
    assert.equal(computeDayRangePosition(100, 90, 110), null);
  });

  it("returns 0 at the day low and 1 at the day high", () => {
    assert.equal(computeDayRangePosition(90, 100, 90), 0);
    assert.equal(computeDayRangePosition(100, 100, 90), 1);
  });

  it("returns 0.5 at the midpoint", () => {
    assert.equal(computeDayRangePosition(95, 100, 90), 0.5);
  });

  it("clamps prices that print outside the cached H/L", () => {
    assert.equal(computeDayRangePosition(89, 100, 90), 0);
    assert.equal(computeDayRangePosition(101, 100, 90), 1);
  });
});

describe("computeDayMovePct", () => {
  it("returns null when open is non-positive", () => {
    assert.equal(computeDayMovePct(100, 0), null);
    assert.equal(computeDayMovePct(100, -5), null);
  });

  it("computes +28% for the canonical example (250 → 320)", () => {
    const v = computeDayMovePct(320, 250);
    assert.ok(v !== null && Math.abs(v - 28) < 1e-9, `got ${v}`);
  });

  it("computes negative move for a falling stock (500 → 430)", () => {
    const v = computeDayMovePct(430, 500);
    assert.ok(v !== null && Math.abs(v - -14) < 1e-9, `got ${v}`);
  });

  it("returns 0 when price equals open", () => {
    assert.equal(computeDayMovePct(250, 250), 0);
  });
});

describe("computeDistanceToLevel", () => {
  it("returns null when level is null or undefined", () => {
    assert.equal(computeDistanceToLevel(100, null), null);
    assert.equal(computeDistanceToLevel(100, undefined), null);
  });

  it("computes absolute distance and percentage of price", () => {
    // Price 250, level 252.50 → 2.50 absolute, 1% of price
    const r = computeDistanceToLevel(250, 252.5);
    assert.notEqual(r, null);
    assert.equal(r!.abs, 2.5);
    assert.equal(r!.pct, 1);
  });

  it("always returns a positive distance (above or below the level)", () => {
    const above = computeDistanceToLevel(100, 105);
    const below = computeDistanceToLevel(100, 95);
    assert.equal(above!.abs, 5);
    assert.equal(below!.abs, 5);
  });
});

describe("getLastNCandlesNewestFirst", () => {
  it("returns empty array when n <= 0 or candles empty", () => {
    assert.deepEqual(getLastNCandlesNewestFirst([], 3), []);
    assert.deepEqual(getLastNCandlesNewestFirst([c(1, 2, 0, 1)], 0), []);
    assert.deepEqual(getLastNCandlesNewestFirst([c(1, 2, 0, 1)], -1), []);
  });

  it("returns the last N candles in newest-first order", () => {
    const candles = [
      c(1, 2, 0, 1, 100, 1),
      c(2, 3, 1, 2, 200, 2),
      c(3, 4, 2, 3, 300, 3),
      c(4, 5, 3, 4, 400, 4),
    ];
    const result = getLastNCandlesNewestFirst(candles, 3);
    assert.equal(result.length, 3);
    assert.equal(result[0].time, 4);
    assert.equal(result[1].time, 3);
    assert.equal(result[2].time, 2);
  });

  it("returns all candles (newest-first) when fewer than N exist", () => {
    const candles = [c(1, 2, 0, 1, 100, 1), c(2, 3, 1, 2, 200, 2)];
    const result = getLastNCandlesNewestFirst(candles, 10);
    assert.equal(result.length, 2);
    assert.equal(result[0].time, 2);
    assert.equal(result[1].time, 1);
  });

  it("does not mutate the input array", () => {
    const candles = [c(1, 2, 0, 1, 100, 1), c(2, 3, 1, 2, 200, 2)];
    const before = candles.map((x) => x.time);
    getLastNCandlesNewestFirst(candles, 5);
    const after = candles.map((x) => x.time);
    assert.deepEqual(after, before);
  });
});
