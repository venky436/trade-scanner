// Day levels — frozen S1/S2/R1/R2, events on today's candles, stocks in play. Pure unit tests.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeDayLevels, evaluateDayLevels, stockInPlay, type DayLevels } from "./day-levels.js";
import type { Candle } from "./types.js";

const D = (t: number, h: number, l: number, c: number, v = 1000): Candle => ({ time: t, open: c, high: h, low: l, close: c, volume: v });
// The worked example shown to the user (stock opening at ₹1,000), oldest first.
const DAILY = [D(1, 1012, 968, 972), D(2, 1042, 989, 994), D(3, 1038, 1006, 1033), D(4, 1021, 994, 1015), D(5, 1019, 991, 1003)];

describe("computeDayLevels", () => {
  const day = computeDayLevels(DAILY, 1000, "2026-11-11");
  const by = (n: string) => day.levels.find((l) => l.name === n);

  it("supports below the open, resistances above, named by distance", () => {
    assert.deepEqual(day.levels.map((l) => l.name), ["S1", "R1", "R2", "R3"]);
    assert.ok(by("S1")!.level < 1000 && by("R1")!.level > 1000);
    assert.ok(by("R1")!.level < by("R2")!.level, "R1 is the nearer resistance");
  });
  it("groups nearby prices: S1 ≈ 992 from 3 different days", () => {
    assert.ok(Math.abs(by("S1")!.level - 991.87) < 0.05);
    assert.equal(by("S1")!.days, 3);
    assert.ok(by("S1")!.min <= by("S1")!.level && by("S1")!.level <= by("S1")!.max);
  });
  it("drops a level whose prices all come from ONE day (968 low + 972 close)", () => {
    assert.ok(!day.levels.some((l) => l.level < 980));
  });
  it("keeps up to 3 per side: the ₹1,038 group (2 different days) is R3, the farthest", () => {
    assert.equal(day.levels.filter((l) => l.kind === "RESISTANCE").length, 3);
    assert.ok(by("R3")!.level > 1030 && by("R3")!.level > by("R2")!.level);
  });
  it("with 4 candidate lines on a side, keeps the 3 STRONGEST (not the 3 nearest)", () => {
    // 4 resistance groups ₹14 apart: ~1008 (old days → weakest), ~1022, ~1036, ~1049 (recent days → stronger)
    const d = [
      D(1, 1008, 995, 999), D(2, 1008.5, 995, 999),
      D(3, 1022, 995, 999), D(4, 1036, 995, 999), D(5, 1049, 995, 999),
      D(6, 1022.5, 995, 999), D(7, 1036.5, 995, 999), D(8, 1049.5, 995, 999),
    ];
    const lv = computeDayLevels(d, 1000, "d");
    const R = lv.levels.filter((l) => l.kind === "RESISTANCE");
    assert.equal(R.length, 3);
    assert.ok(!R.some((l) => l.level < 1015), "the weak ~1008 group (nearest!) is the one dropped");
    assert.deepEqual(R.map((l) => l.name), ["R1", "R2", "R3"]);
    assert.ok(R[0]!.level < R[1]!.level && R[1]!.level < R[2]!.level, "named nearest → farthest");
  });
  it("records prev close and average daily volume for the in-play check", () => {
    assert.equal(day.prevClose, 1003);
    assert.equal(day.avgDailyVolume, 1000);
  });
  it("ignores prices more than 5 % from the open; empty without data", () => {
    assert.equal(computeDayLevels(DAILY, 1200, "d").levels.length, 0);
    assert.equal(computeDayLevels([], 1000, "d").levels.length, 0);
    assert.equal(computeDayLevels(DAILY, 0, "d").levels.length, 0);
  });
  it("uses at most the last 10 days", () => {
    const old = Array.from({ length: 10 }, (_, i) => D(100 + i, 1100, 1090, 1095)); // far away, recent
    const lv = computeDayLevels([D(1, 1001.5, 999, 1000), D(2, 1001.6, 999.2, 1000), ...old], 1000, "d");
    assert.equal(lv.levels.length, 0, "the two old days near 1000 are outside the 10-day window");
  });
});

// Hand-made lines: S1 990 (zone 988–992), S2 970, R1 1010 (1008–1012), R2 1030.
const LV: DayLevels = {
  date: "2026-11-11",
  open: 1000,
  prevClose: 1000,
  avgDailyVolume: 100_000,
  levels: [
    { name: "S1", kind: "SUPPORT", level: 990, min: 988, max: 992, strength: 2, days: 2 },
    { name: "S2", kind: "SUPPORT", level: 970, min: 968, max: 972, strength: 2, days: 2 },
    { name: "R1", kind: "RESISTANCE", level: 1010, min: 1008, max: 1012, strength: 2, days: 2 },
    { name: "R2", kind: "RESISTANCE", level: 1030, min: 1028, max: 1032, strength: 2, days: 2 },
  ],
};
const C = (o: number, h: number, l: number, c: number, v = 1000, t = 0): Candle => ({ time: t, open: o, high: h, low: l, close: c, volume: v });

describe("evaluateDayLevels", () => {
  it("BOUNCE: support tested, last candle closes back above it, green", () => {
    const st = evaluateDayLevels(LV, [C(1000, 1001, 995, 996), C(996, 997, 989, 991), C(991, 996, 990, 995)]);
    assert.equal(st.event?.setup, "BOUNCE");
    assert.equal(st.event?.level.name, "S1");
    assert.equal(st.event?.side, "BUY");
  });
  it("no bounce while the candle is still inside the zone", () => {
    const st = evaluateDayLevels(LV, [C(1000, 1001, 995, 996), C(996, 997, 989, 990), C(990, 992, 989, 991)]);
    assert.equal(st.event, null);
  });
  it("REJECTION: resistance tested, last candle closes back below it, red", () => {
    const st = evaluateDayLevels(LV, [C(1000, 1006, 999, 1005), C(1005, 1011, 1004, 1009), C(1009, 1010, 1003, 1004)]);
    assert.equal(st.event?.setup, "REJECTION");
    assert.equal(st.event?.level.name, "R1");
  });
  it("BREAKOUT only on the FIRST close above — later candles are not breakouts again", () => {
    const up = [C(1000, 1006, 999, 1005), C(1005, 1015, 1004, 1014)];
    assert.equal(evaluateDayLevels(LV, up).event?.setup, "BREAKOUT");
    const later = evaluateDayLevels(LV, [...up, C(1014, 1018, 1013, 1017)]);
    assert.equal(later.event, null);
    assert.deepEqual(later.broken, ["R1"]);
  });
  it("a broken line is never re-labelled: back below R1 is not a rejection", () => {
    const st = evaluateDayLevels(LV, [C(1000, 1006, 999, 1005), C(1005, 1015, 1004, 1014), C(1014, 1014, 1005, 1006)]);
    assert.equal(st.event, null);
  });
  it("BREAKDOWN on the first close below a support", () => {
    const st = evaluateDayLevels(LV, [C(1000, 1001, 993, 994), C(994, 995, 985, 986)]);
    assert.equal(st.event?.setup, "BREAKDOWN");
    assert.equal(st.event?.side, "SELL");
  });
  it("watches BOTH lines: after R1 breaks, a rejection at R2 still counts", () => {
    const st = evaluateDayLevels(LV, [C(1000, 1006, 999, 1005), C(1005, 1015, 1004, 1014), C(1014, 1025, 1013, 1024), C(1024, 1029, 1022, 1027), C(1027, 1028, 1020, 1021)]);
    assert.equal(st.event?.setup, "REJECTION");
    assert.equal(st.event?.level.name, "R2");
  });
  it("passing BOTH lines on a side → done for the day (the break itself still reported)", () => {
    const breakR2 = [C(1000, 1015, 999, 1014), C(1014, 1025, 1013, 1024), C(1024, 1035, 1023, 1034)];
    const st = evaluateDayLevels(LV, breakR2);
    assert.equal(st.done, true);
    assert.equal(st.event?.setup, "BREAKOUT");
    assert.equal(st.event?.level.name, "R2");
    // afterwards: nothing at all, even a perfect bounce at S1 later
    const after = evaluateDayLevels(LV, [...breakR2, C(1034, 1035, 995, 996), C(996, 997, 989, 991), C(991, 996, 990, 995)]);
    assert.equal(after.done, true);
    assert.equal(after.event, null);
  });
  it("with 3 lines per side: passing 2 is not done, passing all 3 is", () => {
    const LV3: DayLevels = { ...LV, levels: [...LV.levels, { name: "R3", kind: "RESISTANCE", level: 1050, min: 1048, max: 1052, strength: 2, days: 2 }] };
    const past2 = [C(1000, 1015, 999, 1014), C(1014, 1035, 1013, 1034)];
    const a = evaluateDayLevels(LV3, past2);
    assert.equal(a.done, false, "R3 is still ahead");
    assert.deepEqual(a.broken.sort(), ["R1", "R2"]);
    const b = evaluateDayLevels(LV3, [...past2, C(1034, 1056, 1033, 1055)]);
    assert.equal(b.done, true);
    assert.equal(b.event?.level.name, "R3");
  });
  it("same candles → same answer (stateless)", () => {
    const cs = [C(1000, 1001, 995, 996), C(996, 997, 989, 991), C(991, 996, 990, 995)];
    assert.deepEqual(evaluateDayLevels(LV, cs), evaluateDayLevels(LV, cs));
  });
  it("no lines / no candles → nothing", () => {
    assert.equal(evaluateDayLevels({ ...LV, levels: [] }, [C(1, 2, 0, 1)]).event, null);
    assert.equal(evaluateDayLevels(LV, []).event, null);
  });
});

describe("stockInPlay", () => {
  const base = { ...LV, prevClose: 1000, avgDailyVolume: 100_000 }; // normal first 15 min = 8 % = 8,000
  it("gap ≥ 0.7 % (up or down) → in play", () => {
    assert.equal(stockInPlay({ ...base, open: 1012 }, []).inPlay, true);
    assert.equal(stockInPlay({ ...base, open: 988 }, []).inPlay, true);
    assert.equal(stockInPlay({ ...base, open: 1008 }, []).inPlay, true); // +0.8 %
    assert.equal(stockInPlay({ ...base, open: 1007 }, []).inPlay, true); // exactly 0.7 %
  });
  it("gap below 0.7 % alone → not in play", () => {
    assert.equal(stockInPlay({ ...base, open: 1006 }, []).inPlay, false); // +0.6 %
    assert.equal(stockInPlay({ ...base, open: 994 }, []).inPlay, false); // −0.6 %
  });
  it("first 15 min volume ≥ 2× normal → in play", () => {
    const s = [C(1000, 1, 1, 1, 6000), C(1, 1, 1, 1, 6000), C(1, 1, 1, 1, 5000)]; // 17,000 ≥ 16,000
    const r = stockInPlay({ ...base, open: 1001 }, s);
    assert.equal(r.inPlay, true);
    assert.equal(r.first15VolumeX, 2.13);
  });
  it("small gap and normal volume → not in play", () => {
    const s = [C(1000, 1, 1, 1, 3000), C(1, 1, 1, 1, 3000), C(1, 1, 1, 1, 3000)];
    assert.equal(stockInPlay({ ...base, open: 1005 }, s).inPlay, false);
  });
  it("volume test waits for the first 3 candles (09:30)", () => {
    assert.equal(stockInPlay({ ...base, open: 1001 }, [C(1000, 1, 1, 1, 50_000)]).first15VolumeX, null);
  });
});
