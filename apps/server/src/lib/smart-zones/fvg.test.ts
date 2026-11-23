import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findFvgSetups, FVG_DEFAULTS, hasImbalance } from "./fvg.js";
import { day, flat, constAtr } from "./test-helpers.js";

// 3 quiet candles (09:15–09:25), then c1 09:30, c2 09:35, c3 09:40. ATR = 0.5.
// Bullish: c1 high 100.2, big green c2 100→102 (body 2 = 4×ATR, vol 5000 = 5×), c3 low 101 > 100.2.
// Gap = 0.8 (0.8% of price, 1.6×ATR) → valid.
const bull = (over: Partial<Record<"c2v" | "c3l" | "c2o" | "c2h", number>> = {}) =>
  day([
    ...flat(3),
    [100, 100.2, 99.8, 100, 1000], // c1
    [over.c2o ?? 100, over.c2h ?? 102.1, 99.9, 102, over.c2v ?? 5000], // c2
    [102, 102.5, over.c3l ?? 101, 102.3, 2000], // c3
  ]);
const NO_VWAP = { ...FVG_DEFAULTS, vwapFilter: false };
const run = (c: ReturnType<typeof day>, cfg = NO_VWAP) => findFvgSetups(c, constAtr(c.length, 0.5), new Array(c.length).fill(0), 0, c.length, cfg);

describe("FVG detection", () => {
  it("finds a strong bullish FVG: zone c1.high…c3.low, entry at the middle, stop below c1/c2", () => {
    const s = run(bull());
    assert.equal(s.length, 1);
    assert.equal(s[0]!.dir, 1);
    assert.equal(s[0]!.zoneBottom, 100.2);
    assert.equal(s[0]!.zoneTop, 101);
    assert.equal(s[0]!.entry, 100.6);
    assert.equal(s[0]!.stop, 99.8);
    assert.equal(s[0]!.formedIdx, 5);
    assert.equal(s[0]!.activeFrom, 6, "only a LATER candle can fill");
  });

  it("SMALL gap is ignored: gap 0.2 (0.2% of price, below the 0.25% minimum)", () => {
    assert.equal(run(bull({ c3l: 100.4 })).length, 0);
  });
  it("gap must also be ≥ 0.5 × ATR", () => {
    const c = bull();
    assert.equal(findFvgSetups(c, constAtr(c.length, 2), new Array(c.length).fill(0), 0, c.length, { ...NO_VWAP, dispAtr: 0.5 }).length, 0, "gap 0.8 < 0.5 × ATR 2");
  });
  it("no gap when c3.low touches c1.high", () => assert.equal(run(bull({ c3l: 100.2 })).length, 0));
  it("weak displacement candle (body < 1 × ATR) → no FVG", () => assert.equal(run(bull({ c2o: 101.7 })).length, 0));
  it("long-wick c2 (body < 60% of its range) → no FVG", () => assert.equal(run(bull({ c2h: 104 })).length, 0));
  it("low volume on c2 (< 1.5 × average) → no FVG", () => assert.equal(run(bull({ c2v: 1400 })).length, 0));

  it("bearish FVG is the exact mirror", () => {
    const c = day([...flat(3), [100, 100.2, 99.8, 100, 1000], [100, 100.1, 97.9, 98, 5000], [98, 99, 97.5, 97.7, 2000]]);
    const s = run(c);
    assert.equal(s.length, 1);
    assert.equal(s[0]!.dir, -1);
    assert.equal(s[0]!.zoneTop, 99.8);
    assert.equal(s[0]!.zoneBottom, 99);
    assert.equal(s[0]!.entry, 99.4);
    assert.equal(s[0]!.stop, 100.2);
  });

  it("VWAP filter: a bullish FVG below VWAP is skipped", () => {
    const c = bull();
    assert.equal(findFvgSetups(c, constAtr(c.length, 0.5), new Array(c.length).fill(200), 0, c.length, FVG_DEFAULTS).length, 0);
    assert.equal(findFvgSetups(c, constAtr(c.length, 0.5), new Array(c.length).fill(50), 0, c.length, FVG_DEFAULTS).length, 1);
  });

  it("time window: a pattern that starts on the 09:15 auction candle (c3 = 09:25) is not used", () => {
    const c = day([[100, 100.2, 99.8, 100, 1000], [100, 102.1, 99.9, 102, 5000], [102, 102.5, 101, 102.3, 2000]]);
    assert.equal(run(c).length, 0);
  });

  it("hasImbalance finds any 3-candle gap in a range", () => {
    const c = bull({ c3l: 100.4 });
    assert.equal(hasImbalance(c, 3, 5, 1), true);
    assert.equal(hasImbalance(c, 3, 5, -1), false);
  });
});
