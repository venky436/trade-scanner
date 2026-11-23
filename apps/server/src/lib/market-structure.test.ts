// Market structure (HH / HL / LH / LL) — pure unit tests on hand-built zigzag charts.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { marketStructure, rawSwings, cleanSwings, labelSwings, trendStage } from "./market-structure.js";
import type { Candle } from "./types.js";

/** Candles walking through the given turning points, `per` candles per leg (each candle ±0.1 wick). */
function path(points: number[], per = 4): Candle[] {
  const out: Candle[] = [];
  let prev = points[0]!, t = 1_800_000_000;
  for (let p = 1; p < points.length; p++) {
    const a = points[p - 1]!, b = points[p]!;
    for (let s = 1; s <= per; s++) {
      const close = a + ((b - a) * s) / per;
      out.push({ time: (t += 300), open: prev, high: Math.max(prev, close) + 0.1, low: Math.min(prev, close) - 0.1, close, volume: 1000 });
      prev = close;
    }
  }
  return out;
}
const labels = (cs: Candle[]) => marketStructure(cs).swings.map((s) => `${s.type[0]}${s.label ? ":" + s.label : ""}`);

describe("market structure", () => {
  it("UPTREND: higher highs and higher lows", () => {
    const cs = path([103, 100, 104, 102, 106, 104, 108, 106, 109]);
    const m = marketStructure(cs);
    assert.equal(m.trend, "UP");
    assert.deepEqual(labels(cs), ["L", "H", "L:HL", "H:HH", "L:HL", "H:HH", "L:HL"]);
    assert.equal(m.steps, 5);
    assert.equal(m.lastLow!.price, 105.9); // the 106 turning point (−0.1 wick)
    assert.equal(m.lastHigh!.price, 108.1);
  });
  it("DOWNTREND: lower highs and lower lows (mirror)", () => {
    const cs = path([97, 100, 96, 98, 94, 96, 92, 94, 91]);
    const m = marketStructure(cs);
    assert.equal(m.trend, "DOWN");
    assert.deepEqual(labels(cs), ["H", "L", "H:LH", "L:LL", "H:LH", "L:LL", "H:LH"]);
    assert.equal(m.steps, 5);
  });
  it("SIDEWAYS: mixed labels (higher high but lower low)", () => {
    const m = marketStructure(path([103, 100, 104, 101, 103, 99, 105, 102]));
    assert.equal(m.trend, "SIDEWAYS");
    assert.equal(m.steps, 0);
  });
  it("BROKEN: an uptrend whose price falls below the latest higher low", () => {
    const up = path([103, 100, 104, 102, 106, 104, 108, 106, 109]);
    const last = up.at(-1)!;
    const crash: Candle = { time: last.time + 300, open: last.close, high: last.close + 0.1, low: 104.5, close: 104.8, volume: 1000 }; // below the 105.9 HL
    const m = marketStructure([...up, crash]);
    assert.equal(m.trend, "SIDEWAYS");
    assert.equal(m.broken, true);
  });
  it("tiny wiggles inside a leg are ignored (noise filter)", () => {
    // same uptrend, but the 100→104 leg has a tiny pause (swing size 102.1→101.8 = 0.3, below 0.5 ATR ≈ 0.46)
    const clean = path([103, 100, 104, 102, 106, 104, 108, 106, 109]);
    const noisy = path([103, 100, 102, 101.9, 104, 102, 106, 104, 108, 106, 109]);
    assert.equal(marketStructure(noisy).trend, "UP");
    assert.deepEqual(labels(noisy), labels(clean));
  });
  it("swing points are found exactly at the turning candle, and only once confirmed", () => {
    const cs = path([103, 100, 104, 102], 4); // turning points at candle 3 (100), 7 (104)
    const raw = rawSwings(cs, 2);
    assert.deepEqual(raw.map((s) => [s.type, s.index]), [["LOW", 3], ["HIGH", 7]]);
    // the last turning point needs 2 candles after it → the 102 low at the very end is not yet a swing
    assert.ok(!raw.some((s) => s.index >= cs.length - 2));
  });
  it("two highs in a row keep the higher one; labels compare with the previous same-type swing", () => {
    const merged = cleanSwings(
      [{ type: "LOW", price: 100, time: 1, index: 1 }, { type: "HIGH", price: 104, time: 2, index: 2 }, { type: "HIGH", price: 105, time: 3, index: 3 }, { type: "LOW", price: 102, time: 4, index: 4 }],
      0.5,
    );
    assert.deepEqual(merged.map((s) => s.price), [100, 105, 102]);
    const l = labelSwings([...merged, { type: "HIGH", price: 104, time: 5, index: 5 }]);
    assert.equal(l.at(-1)!.label, "LH");
    assert.equal(l.at(-2)!.label, "HL");
  });
  it("a dip ABOVE the noise limit is a real swing (limit = max(1.5 × ATR, 0.4 % of price))", () => {
    // ATR ≈ 0.9 here → limit ≈ 1.4; this dip is 102.6 → 100.7 = 1.9 → a real swing low
    const m = marketStructure(path([103, 100, 102.5, 100.8, 104, 102, 106, 104, 108, 106, 109]));
    const clean = marketStructure(path([103, 100, 104, 102, 106, 104, 108, 106, 109]));
    assert.equal(clean.swings.filter((s) => s.type === "LOW").length, 4);
    assert.equal(m.swings.filter((s) => s.type === "LOW").length, 5, "the 1.9 dip adds one real swing low");
    assert.equal(m.trend, "UP");
  });
  it("…and a dip of 1.0 (below the limit) is ignored", () => {
    const m = marketStructure(path([103, 100, 102.5, 101.5, 104, 102, 106, 104, 108, 106, 109]));
    assert.equal(m.swings.filter((s) => s.type === "LOW").length, 4);
  });
  it("quiet chart: swings smaller than 0.4 % of price are ignored even if they are big in ATR terms", () => {
    // price ≈ 1000, legs of only ₹2–3 (0.2–0.3 %) → no swing passes → no trend
    const m = marketStructure(path([1003, 1000, 1003, 1001, 1004, 1002, 1005, 1003, 1006]));
    assert.equal(m.trend, "SIDEWAYS");
    // the ₹2–3 wiggles are merged away; only the overall ₹6 climb can remain (one low, one high) — no HH/HL labels
    assert.ok(m.swings.length <= 2);
    assert.ok(m.swings.every((w) => !w.label));
  });
  it("an ambiguous big candle (new high AND new low) is never used as a swing", () => {
    const cs = path([103, 100, 104, 102, 106, 104, 108]);
    const i = 13; // replace a mid-leg candle with an outside candle spanning everything near it
    cs[i] = { ...cs[i]!, high: 110, low: 98 };
    assert.ok(!rawSwings(cs).some((s) => s.index === i));
  });
  it("too few candles → SIDEWAYS, no swings (never guesses)", () => {
    const m = marketStructure(path([100, 101], 2));
    assert.equal(m.trend, "SIDEWAYS");
    assert.equal(m.swings.length, 0);
  });
});

describe("trend stage (watch list: EARLY / CONFIRMED)", () => {
  const read = (pts: number[], price?: number) => { const cs = path(pts); return trendStage(marketStructure(cs), price ?? cs.at(-1)!.close); };
  it("CONFIRMED: 3+ agreeing swings and moved ≥ 1 %", () => {
    const r = read([103, 100, 104, 102, 106, 104, 108, 106, 109])!;
    assert.equal(r.stage, "CONFIRMED");
    assert.equal(r.trend, "UP");
  });
  it("EARLY: the first higher high + higher low (2 agreeing swings)", () => {
    const r = read([103, 100, 104, 102, 106, 105])!;
    assert.equal(r.stage, "EARLY");
    assert.equal(r.steps, 2);
  });
  it("EARLY (forming): higher low, and price breaking above the last swing high right now", () => {
    const r = read([103, 100, 104, 102, 104.6])!;
    assert.equal(r.stage, "EARLY");
    assert.equal(r.trend, "UP");
    assert.equal(r.steps, 1);
  });
  it("…not forming while price is still below the last swing high", () => assert.equal(read([103, 100, 104, 102, 103.8]), null));
  it("DOWN mirror of the forming case", () => {
    const r = read([97, 100, 96, 98, 95.4])!;
    assert.equal(r.trend, "DOWN");
    assert.equal(r.stage, "EARLY");
  });
  it("a broken trend gives nothing", () => {
    const up = path([103, 100, 104, 102, 106, 104, 108, 106, 109]);
    assert.equal(trendStage(marketStructure(up), 104.8), null);
  });
  it("too small a move (< 0.5 % since the trend began) gives nothing", () => {
    const cs = path([103, 100, 104, 102, 106, 105]);
    const m = marketStructure(cs);
    const start = m.swings[m.swings.length - m.steps]!;
    assert.equal(trendStage(m, start.price * 1.003), null);
  });
});
