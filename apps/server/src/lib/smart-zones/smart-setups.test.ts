import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findSmartSetups } from "./smart-setups.js";
import { CONTEXT_DEFAULTS } from "./context.js";
import { day, constAtr } from "./test-helpers.js";

type Row = [number, number, number, number, number];
const zeroVwap = (n: number) => new Array(n).fill(0);
const run = (rows: Row[], atr = 0.5, cfg = CONTEXT_DEFAULTS) => {
  const c = day(rows);
  return findSmartSetups(c, constAtr(c.length, atr), zeroVwap(c.length), 0, c.length, cfg);
};
const fvgOnly = (s: ReturnType<typeof run>) => s.filter((x) => x.strategy === "FVG");

// 10 clean falling candles 110 → 100 (bottom low 99.9 at idx 9), then a bullish FVG at idx 10-12
const fall: Row[] = Array.from({ length: 10 }, (_, k) => [110 - k, 110.1 - k, 108.9 - k, 109 - k, 1000] as Row);
const turnUpFvg: Row[] = [
  [100, 100.3, 99.95, 100.2, 1000], // c1 (no new low)
  [100.2, 101.6, 100.1, 101.5, 5000], // c2 strong green, 5× volume
  [101.5, 102, 101, 101.8, 2000], // c3 — gap 100.3 … 101.0 (0.7%)
  [101.8, 102.2, 101.6, 102, 1000],
];

describe("REVERSAL: clear fall → bottom → turn → bullish FVG = BUY", () => {
  it("is found, marked REVERSAL, stop below the bottom of the fall", () => {
    const s = fvgOnly(run([...fall, ...turnUpFvg])).filter((x) => x.dir === 1);
    assert.equal(s.length, 1);
    assert.equal(s[0]!.context.kind, "REVERSAL");
    assert.equal(s[0]!.context.legStart, 0, "fall began at the 09:15 high");
    assert.equal(s[0]!.context.legEnd, 9, "bottom candle");
    assert.equal(s[0]!.context.legTo, 99.9);
    assert.equal(s[0]!.stop, 99.9, "stop = bottom of the fall");
    assert.equal(s[0]!.zoneBottom, 100.3);
    assert.equal(s[0]!.zoneTop, 101);
  });

  it("the FVG may come several candles after the bottom, as long as the turn is still early", () => {
    const wait: Row[] = [[100, 100.3, 99.95, 100.1, 1000], [100.1, 100.4, 100, 100.2, 1000], [100.2, 100.4, 100.05, 100.25, 1000]];
    const s = fvgOnly(run([...fall, ...wait, ...turnUpFvg])).filter((x) => x.dir === 1);
    assert.equal(s.length, 1);
    assert.equal(s[0]!.context.kind, "REVERSAL");
  });

  it("zig-zag fall (big bounces on the way down, efficiency < 0.4) is NOT a clear fall → ignored", () => {
    // closes 110,107,109,106,108,105,107,104,106,103,100: net −10 but travel 26 → efficiency 0.38
    const cl = [110, 107, 109, 106, 108, 105, 107, 104, 106, 103, 100];
    const zig: Row[] = cl.map((x, k) => [k ? cl[k - 1]! : 110, Math.max(k ? cl[k - 1]! : 110, x) + 0.1, Math.min(k ? cl[k - 1]! : 110, x) - 0.1, x, 1000] as Row);
    zig[0] = [110, 110.5, 109.9, 110, 1000];
    const tail = turnUpFvg.map((r) => [r[0] - 0.05, r[1] - 0.05, r[2] - 0.05, r[3] - 0.05, r[4]] as Row);
    assert.equal(fvgOnly(run([...zig, ...tail])).filter((x) => x.dir === 1).length, 0, "rejected");
    assert.equal(fvgOnly(run([...zig, ...tail], 0.5, { ...CONTEXT_DEFAULTS, minEfficiency: 0.3 })).filter((x) => x.dir === 1).length, 1, "passes when ONLY the efficiency rule is relaxed");
  });

  it("fall too small for this stock (asked for 25 × ATR / 20% of price) → ignored", () => {
    assert.equal(fvgOnly(run([...fall, ...turnUpFvg], 0.5, { ...CONTEXT_DEFAULTS, minMoveAtr: 25 })).filter((x) => x.dir === 1).length, 0);
    assert.equal(fvgOnly(run([...fall, ...turnUpFvg], 0.5, { ...CONTEXT_DEFAULTS, minMovePct: 0.2 })).filter((x) => x.dir === 1).length, 0);
  });

  it("turn already too far along (recovered more than the limit) → ignored", () => {
    assert.equal(fvgOnly(run([...fall, ...turnUpFvg], 0.5, { ...CONTEXT_DEFAULTS, maxRecovery: 0.1 })).filter((x) => x.dir === 1).length, 0);
  });

  it("a bullish FVG with NO move before it (flat day) → ignored", () => {
    const flatRows: Row[] = Array.from({ length: 10 }, () => [100, 100.2, 99.8, 100, 1000] as Row);
    assert.equal(fvgOnly(run([...flatRows, ...turnUpFvg])).length, 0);
  });
});

describe("TREND: clear fall still running → bearish FVG = SELL (e.g. no gap for 7 candles, gap at the 8th)", () => {
  const down: Row[] = Array.from({ length: 7 }, (_, k) => [110 - k, 110.1 - k, 108.9 - k, 109 - k, 1000] as Row);
  const gapDown: Row[] = [
    [103, 103.2, 102.6, 102.8, 1000], // c1
    [102.8, 102.9, 101.2, 101.3, 5000], // c2 strong red
    [101.3, 101.9, 100.9, 101, 2000], // c3 — gap 101.9 … 102.6
    [101, 101.1, 100, 100.2, 1000],
  ];
  it("is found, marked TREND, SELL", () => {
    const s = fvgOnly(run([...down, ...gapDown])).filter((x) => x.dir === -1);
    assert.equal(s.length, 1);
    assert.equal(s[0]!.context.kind, "TREND");
    assert.equal(s[0]!.context.legFrom, 110.1, "the fall began at the 09:15 high");
    assert.equal(s[0]!.stop, 103.2, "trend trade keeps the FVG's own stop");
  });

  it("after a deep bounce (> 50% of the fall) the trend is not intact → ignored", () => {
    const after: Row[] = [
      [103, 103.1, 102.6, 102.8, 1000], // new low 102.6
      [102.8, 107.3, 102.7, 107.2, 1000], // bounce candle
      [107.2, 107.4, 107, 107.1, 1000], // c1 (pullback 64% of the fall)
      [107.1, 107.2, 105.6, 105.7, 5000], // c2
      [105.7, 106.4, 105.3, 105.4, 2000], // c3 — gap 106.4 … 107.0
    ];
    const trendSell = (cfg = CONTEXT_DEFAULTS) => fvgOnly(run([...down, ...after], 0.5, cfg)).filter((x) => x.dir === -1 && x.context.kind === "TREND").length;
    assert.equal(trendSell(), 0, "rejected");
    assert.equal(trendSell({ ...CONTEXT_DEFAULTS, maxPullback: 0.7 }), 1, "passes when ONLY the pullback rule is relaxed");
  });
});

describe("mirror: clear RISE → top → turn down → bearish FVG = SELL (REVERSAL)", () => {
  it("is found with the stop above the top", () => {
    const m = (r: Row): Row => [200 - r[0], 200 - r[2], 200 - r[1], 200 - r[3], r[4]];
    const s = fvgOnly(run([...fall, ...turnUpFvg].map(m))).filter((x) => x.dir === -1);
    assert.equal(s.length, 1);
    assert.equal(s[0]!.context.kind, "REVERSAL");
    assert.equal(s[0]!.stop, 200 - 99.9);
  });
});

describe("FRESH: the pattern must come soon after the move", () => {
  it("a 7-candle fall, then a long sideways wait (> 2 × 7 candles), then a bearish FVG → ignored", () => {
    const down: Row[] = Array.from({ length: 7 }, (_, k) => [110 - k, 110.1 - k, 108.9 - k, 109 - k, 1000] as Row);
    const wait: Row[] = Array.from({ length: 16 }, () => [103.1, 103.3, 102.95, 103.1, 1000] as Row);
    const gap: Row[] = [[103, 103.2, 102.9, 102.95, 1000], [102.95, 103, 101.3, 101.4, 5000], [101.4, 102.2, 101, 101.1, 2000]];
    const sells = (cfg = CONTEXT_DEFAULTS) => fvgOnly(run([...down, ...wait, ...gap], 0.5, cfg)).filter((x) => x.dir === -1).length;
    assert.equal(sells(), 0, "rejected");
    assert.equal(sells({ ...CONTEXT_DEFAULTS, maxPauseRatio: 5 }), 1, "passes when ONLY the freshness rule is relaxed");
  });
});
