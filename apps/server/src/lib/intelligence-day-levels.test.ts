// Transformer — DAY-LEVEL path (frozen S1/S2/R1/R2). Pure unit tests.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toIntelligence, type IntelligenceInput } from "./intelligence-transformer.js";
import type { DayLevels } from "./day-levels.js";
import type { Candle, MomentumResult, PressureResult } from "./types.js";

const LV: DayLevels = {
  date: "2026-11-11",
  open: 1000,
  prevClose: 990,
  avgDailyVolume: 100_000,
  levels: [
    { name: "S1", kind: "SUPPORT", level: 990, min: 988, max: 992, strength: 2, days: 2 },
    { name: "S2", kind: "SUPPORT", level: 970, min: 968, max: 972, strength: 2, days: 2 },
    { name: "R1", kind: "RESISTANCE", level: 1010, min: 1008, max: 1012, strength: 2, days: 2 },
    { name: "R2", kind: "RESISTANCE", level: 1030, min: 1028, max: 1032, strength: 2, days: 2 },
  ],
};
const C = (o: number, h: number, l: number, c: number, v = 1000): Candle => ({ time: 0, open: o, high: h, low: l, close: c, volume: v });
const flat = Array.from({ length: 14 }, () => C(1003, 1005, 1001, 1003));
const breakout = [...flat, C(1003, 1015, 1002, 1014, 5000)]; // first close above R1 (1012), 5× volume; ATR ≈ 4.64
const mom = (value: number): MomentumResult => ({ value, signal: value > 0.6 ? "STRONG_UP" : value < -0.6 ? "STRONG_DOWN" : "FLAT", acceleration: "STABLE", accelerationRaw: 0, quality: value });
const press = (value: number): PressureResult => ({ value, signal: value > 0.6 ? "STRONG_BUY" : value < -0.6 ? "STRONG_SELL" : "NEUTRAL", trend: "mixed", confidence: Math.abs(value) });

function input(over: Partial<IntelligenceInput> = {}): IntelligenceInput {
  return {
    symbol: "TEST", price: 1014, open: 1000, high: 1015, low: 1001, close: 990, timestamp: 0,
    momentum: mom(1), pressure: press(0.9), sr: null,
    recentCandles: breakout, sessionCandles: breakout, dayLevels: LV,
    ...over,
  };
}

describe("toIntelligence — day levels", () => {
  it("BREAKOUT at R1 with momentum, buyers and a volume surge → BUY plan", () => {
    const s = toIntelligence(input());
    assert.equal(s.outlook, "BREAKOUT_LIKELY");
    assert.equal(s.context.zone, "NEAR_RESISTANCE");
    assert.equal(s.context.levelName, "R1");
    assert.equal(s.confidenceLabel, "HIGH");
    assert.equal(s.tradePlan?.action, "BUY");
    // SL 0.2 ATR below the R1 zone bottom (1008), target 2 × risk
    assert.ok(s.tradePlan!.stopLoss < 1008 && s.tradePlan!.stopLoss > 1006);
    assert.equal(s.tradePlan!.riskReward, 2);
  });
  it("no volume surge → no breakout call", () => {
    const quiet = [...flat, C(1003, 1015, 1002, 1014, 1000)];
    const s = toIntelligence(input({ recentCandles: quiet, sessionCandles: quiet }));
    assert.equal(s.outlook, "NO_CLEAR_EDGE");
    assert.equal(s.tradePlan, null);
  });
  it("too late: price already > 1 ATR beyond the line → no plan", () => {
    const s = toIntelligence(input({ price: 1020 })); // 10 above R1, ATR ≈ 4.6
    assert.equal(s.tradePlan, null);
  });
  it("confidence does not depend on distance from the line", () => {
    const near = toIntelligence(input({ price: 1014 }));
    const far = toIntelligence(input({ price: 1022 })); // 1.2 % away — old path would give 0
    assert.equal(far.confidence, near.confidence);
    assert.ok(far.confidence > 0.7);
  });
  it("lines not computed yet (null) → no call", () => {
    const s = toIntelligence(input({ dayLevels: null }));
    assert.equal(s.outlook, "NO_CLEAR_EDGE");
    assert.equal(s.tradePlan, null);
    assert.equal(s.context.zone, "MID_RANGE");
  });
  it("no event, price near an unbroken line → shown near it (watch list), no call", () => {
    const calm = [...flat];
    const s = toIntelligence(input({ price: 1005, recentCandles: calm, sessionCandles: calm, momentum: mom(0.1), pressure: press(0) }));
    assert.equal(s.context.zone, "NEAR_RESISTANCE");
    assert.equal(s.context.levelName, "R1");
    assert.equal(s.tradePlan, null);
  });
  it("after passing BOTH resistances the stock is done → no call, marked done", () => {
    const run = [...flat, C(1003, 1015, 1002, 1014, 5000), C(1014, 1035, 1013, 1034, 5000), C(1034, 1036, 1030, 1035, 5000)];
    const s = toIntelligence(input({ price: 1035, recentCandles: run, sessionCandles: run }));
    assert.equal(s.tradePlan, null);
    assert.equal(s.context.levelsDone, true);
  });
  it("without dayLevels (undefined) the old single-S/R path is used", () => {
    const s = toIntelligence(input({ dayLevels: undefined }));
    assert.equal(s.context.levelName, undefined);
    assert.equal(s.context.zone, "MID_RANGE"); // sr is null in this input
  });
});
