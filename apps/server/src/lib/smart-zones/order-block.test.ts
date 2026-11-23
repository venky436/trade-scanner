import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findOrderBlockSetups, findSwings, OB_DEFAULTS } from "./order-block.js";
import { day, flat, constAtr } from "./test-helpers.js";

type Row = [number, number, number, number, number];
// Bullish story (ATR 0.5):
//  idx 0-2  quiet at 100
//  idx 3    swing high 101 (09:30)
//  idx 4-5  pull back
//  idx 6    RED candle 99.9→99.4, low 99.2  ← order block (leg low)
//  idx 7    big green 99.5→100.8, high 101.0
//  idx 8    green, low 101.1 > idx6 high 99.95? (imbalance: low 101.1 > high of idx 6) and closes 101.6 > swing 101 → BOS (vol 4000)
const rows = (over: { bosV?: number; obLowLater?: number; bosClose?: number } = {}): Row[] => [
  ...flat(3),
  [100, 101, 99.9, 100.5, 1000], // 3 swing high 101
  [100.5, 100.7, 99.8, 100, 1000], // 4
  [100, 100.2, 99.5, 99.9, 1000], // 5
  [99.9, 99.95, 99.2, 99.4, 1200], // 6 red → OB (99.2 … 99.95)
  [99.5, 101, 99.45, 100.8, 3000], // 7
  [101, over.bosClose ? Math.max(101.8, over.bosClose) : 101.8, over.obLowLater ?? 101.1, over.bosClose ?? 101.6, over.bosV ?? 4000], // 8 BOS
  ...flat(3, 101.5),
];
const NO_VWAP = { ...OB_DEFAULTS, vwapFilter: false };
const run = (r: Row[], cfg = NO_VWAP) => {
  const c = day(r);
  return findOrderBlockSetups(c, constAtr(c.length, 0.5), new Array(c.length).fill(0), 0, c.length, cfg);
};

describe("swing points", () => {
  it("swing high = strictly above 2 candles each side", () => {
    const c = day(rows());
    const hs = findSwings(c, 0, c.length, 2, 1);
    assert.ok(hs.some((s) => s.idx === 3 && s.price === 101 && s.confirmedAt === 5));
  });
});

describe("Order Block detection", () => {
  it("bullish OB: last red candle at the leg low before the break of the swing high", () => {
    const s = run(rows());
    assert.equal(s.length, 1);
    const ob = s[0]!;
    assert.equal(ob.dir, 1);
    assert.equal(ob.formedIdx, 8, "found on the BOS candle");
    assert.equal(ob.zoneBottom, 99.2);
    assert.equal(ob.zoneTop, 99.95);
    assert.equal(ob.stop, 99.2);
    assert.equal(ob.entry, (99.95 + 99.2) / 2, "mean threshold");
    assert.equal(ob.activeFrom, 9);
  });
  it("entry 'edge' = top of the block", () => assert.equal(run(rows(), { ...NO_VWAP, entry: "edge" })[0]!.entry, 99.95));
  it("weak BOS volume (< 1.2 × average) → no OB", () => assert.equal(run(rows({ bosV: 1000 })).length, 0));
  it("no imbalance in the leg → no OB", () => assert.equal(run(rows({ obLowLater: 99.9 })).length, 0));
  it("move too small (< 1.5 × ATR from OB low) → no OB", () => {
    const c = day(rows());
    assert.equal(findOrderBlockSetups(c, constAtr(c.length, 2), new Array(c.length).fill(0), 0, c.length, NO_VWAP).length, 0);
  });
  it("each swing is used once: a later close above it doesn't make a second OB", () => {
    const r = rows();
    r.push([101.5, 101.6, 100.8, 100.9, 1000], [100.9, 102.5, 100.9, 102.4, 6000]);
    assert.equal(run(r).length, 1);
  });
  it("VWAP filter: BOS below VWAP is skipped", () => {
    const c = day(rows());
    assert.equal(findOrderBlockSetups(c, constAtr(c.length, 0.5), new Array(c.length).fill(500), 0, c.length, OB_DEFAULTS).length, 0);
  });
  it("bearish OB is the exact mirror (prices reflected around 200)", () => {
    const m = rows().map(([o, h, l, c, v]) => [200 - o, 200 - l, 200 - h, 200 - c, v] as Row);
    const s = run(m);
    assert.equal(s.length, 1);
    assert.equal(s[0]!.dir, -1);
    assert.equal(s[0]!.zoneTop, 200 - 99.2);
    assert.equal(s[0]!.zoneBottom, 200 - 99.95);
    assert.equal(s[0]!.stop, 200 - 99.2);
  });
});

describe("Order Block — the block must come AFTER the swing", () => {
  it("a red swing candle followed straight by the break is NOT an order block", () => {
    // idx 3 = red swing-high candle (high 101) and also the leg low; no pullback candle after it
    const r: Row[] = [
      [99, 99.4, 98.9, 99.2, 1000], [99.2, 99.6, 99.1, 99.5, 1000], [99.5, 100, 99.4, 99.9, 1000],
      [100.9, 101, 100.3, 100.4, 1000], // 3 red, swing high 101
      [100.4, 100.9, 100.35, 100.8, 1000], [100.8, 100.95, 100.5, 100.9, 1000], // lower highs
      [100.9, 100.98, 100.6, 100.95, 1000],
      [100.95, 102.2, 100.9, 102.1, 5000], // breaks 101 with a gap over idx 5's high? (low 100.9 < 100.95 → no)
      [102.1, 102.9, 101.6, 102.8, 5000],
      ...flat(3, 102.5),
    ];
    const c = day(r);
    const s = findOrderBlockSetups(c, constAtr(c.length, 0.3), new Array(c.length).fill(0), 0, c.length, { ...NO_VWAP, requireImbalance: false });
    assert.ok(s.every((x) => x.zoneTop !== 101), "the swing candle itself is never used as the block");
  });
});
