import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bullish, bearish, marubozu, twoStrong } from "./candle-patterns.js";
import type { Candle } from "./types.js";

const C = (o: number, h: number, l: number, c: number, v = 1000): Candle => ({ time: 0, open: o, high: h, low: l, close: c, volume: v });
// 22 quiet candles around 100 (range 2, body 1, volume 1000) + a 3-candle decline to 97
const quiet = Array.from({ length: 22 }, (_, i) => (i % 2 ? C(100, 101.25, 99.25, 100.5) : C(100.5, 101.25, 99.25, 99.5)));
const decline = [C(100, 100.3, 98.8, 99), C(99, 99.2, 97.8, 98), C(98, 98.2, 96.8, 97)];
const base = [...quiet, ...decline];
// mirror: price → 200 − price (a bullish setup becomes its bearish twin)
const M = (x: Candle): Candle => ({ ...x, open: 200 - x.open, close: 200 - x.close, high: 200 - x.low, low: 200 - x.high });
const mirror = (cs: Candle[]) => cs.map(M);
const has = (list: string[], p: string) => list.includes(p);

describe("bullish patterns (after a decline, at the low)", () => {
  it("HAMMER: long lower wick, tiny upper wick, body on top", () => assert.ok(has(bullish([...base, C(96.6, 97.05, 95.6, 97.0)]), "HAMMER")));
  it("…not a hammer when the upper wick is long", () => assert.ok(!has(bullish([...base, C(96.6, 97.6, 95.6, 97.0)]), "HAMMER")));
  it("…not a hammer without a prior decline (in an uptrend)", () => {
    const up = [...quiet, C(100, 101.2, 99.8, 101), C(101, 102.2, 100.8, 102), C(102, 103.2, 101.8, 103)];
    assert.ok(!has(bullish([...up, C(102.6, 103.05, 101.6, 103.0)]), "HAMMER"));
  });
  it("…not a hammer when the candle is too small (noise)", () => assert.ok(!has(bullish([...base, C(96.95, 97.02, 96.6, 97.0)]), "HAMMER")));
  it("INVERTED HAMMER: long upper wick after a decline", () => assert.ok(has(bullish([...base, C(96.6, 97.8, 96.55, 96.9)]), "INVERTED_HAMMER")));
  it("DRAGONFLY DOJI: open ≈ close ≈ high, long lower wick", () => assert.ok(has(bullish([...base, C(97.0, 97.05, 95.5, 97.03)]), "DRAGONFLY_DOJI")));
  it("…not dragonfly when the body is a real body", () => assert.ok(!has(bullish([...base, C(96.7, 97.05, 95.5, 97.03)]), "DRAGONFLY_DOJI")));
  it("BULLISH ENGULFING: green body swallows the red body", () => assert.ok(has(bullish([...base, C(96.98, 98.4, 96.9, 98.3)]), "BULLISH_ENGULFING")));
  it("…not engulfing when it closes below the red candle's open", () => assert.ok(!has(bullish([...base, C(96.98, 98.0, 96.9, 97.9)]), "BULLISH_ENGULFING")));
  const bigRed = [...quiet, C(100, 100.3, 98.8, 99), C(99, 99.2, 97.8, 98), C(98, 98.2, 96.4, 96.5)];
  it("PIERCING LINE: closes above the middle of a long red body", () => assert.ok(has(bullish([...bigRed, C(96.5, 97.5, 96.3, 97.4)]), "PIERCING_LINE")));
  it("…not piercing when it closes below the middle", () => assert.ok(!has(bullish([...bigRed, C(96.5, 97.3, 96.3, 97.1)]), "PIERCING_LINE")));
  it("TWEEZER BOTTOM: red then green with the same low", () => assert.ok(has(bullish([...quiet, C(100, 100.3, 98.8, 99), C(99, 99.2, 97.8, 98), C(98, 98.1, 96.6, 96.8), C(96.8, 98.0, 96.62, 97.8)]), "TWEEZER_BOTTOM")));
  it("…not tweezer when the lows differ", () => assert.ok(!has(bullish([...quiet, C(100, 100.3, 98.8, 99), C(99, 99.2, 97.8, 98), C(98, 98.1, 96.6, 96.8), C(96.8, 98.0, 96.0, 97.8)]), "TWEEZER_BOTTOM")));
  const ms = [...quiet, C(100, 100.3, 98.8, 99), C(99, 99.2, 97.8, 98), C(98, 98.1, 96.3, 96.4), C(96.3, 96.6, 95.9, 96.2)];
  it("MORNING STAR: long red, small candle, green closing above the red's middle", () => assert.ok(has(bullish([...ms, C(96.3, 97.6, 96.2, 97.5)]), "MORNING_STAR")));
  it("…not a morning star when the green candle is weak", () => assert.ok(!has(bullish([...ms, C(96.3, 96.9, 96.2, 96.8)]), "MORNING_STAR")));
  it("TWO STRONG GREEN: two full-body green candles on high volume", () => assert.ok(has(bullish([...base, C(97, 98.1, 96.9, 98.0, 2000), C(98, 99.1, 97.95, 99.0, 2200)]), "TWO_STRONG_GREEN")));
  it("…not when the volume is normal", () => assert.ok(!has(bullish([...base, C(97, 98.1, 96.9, 98.0, 1000), C(98, 99.1, 97.95, 99.0, 1000)]), "TWO_STRONG_GREEN")));
});

describe("bearish patterns = mirror images (after a rise, at the high)", () => {
  const mb = (last: Candle[], cs = base) => bearish(mirror([...cs, ...last]));
  it("SHOOTING STAR (mirror of hammer)", () => assert.ok(has(mb([C(96.6, 97.05, 95.6, 97.0)]), "SHOOTING_STAR")));
  it("HANGING MAN (mirror of inverted hammer)", () => assert.ok(has(mb([C(96.6, 97.8, 96.55, 96.9)]), "HANGING_MAN")));
  it("GRAVESTONE DOJI (mirror of dragonfly)", () => assert.ok(has(mb([C(97.0, 97.05, 95.5, 97.03)]), "GRAVESTONE_DOJI")));
  it("BEARISH ENGULFING", () => assert.ok(has(mb([C(96.98, 98.4, 96.9, 98.3)]), "BEARISH_ENGULFING")));
  it("DARK CLOUD COVER", () => assert.ok(has(bearish(mirror([...quiet, C(100, 100.3, 98.8, 99), C(99, 99.2, 97.8, 98), C(98, 98.2, 96.4, 96.5), C(96.5, 97.5, 96.3, 97.4)])), "DARK_CLOUD_COVER")));
  it("TWEEZER TOP", () => assert.ok(has(bearish(mirror([...quiet, C(100, 100.3, 98.8, 99), C(99, 99.2, 97.8, 98), C(98, 98.1, 96.6, 96.8), C(96.8, 98.0, 96.62, 97.8)])), "TWEEZER_TOP")));
  it("EVENING STAR", () => assert.ok(has(bearish(mirror([...quiet, C(100, 100.3, 98.8, 99), C(99, 99.2, 97.8, 98), C(98, 98.1, 96.3, 96.4), C(96.3, 96.6, 95.9, 96.2), C(96.3, 97.6, 96.2, 97.5)])), "EVENING_STAR")));
  it("TWO STRONG RED", () => assert.ok(has(mb([C(97, 98.1, 96.9, 98.0, 2000), C(98, 99.1, 97.95, 99.0, 2200)]), "TWO_STRONG_RED")));
  it("a bullish hammer is NOT reported as any bearish pattern", () => assert.equal(bearish([...base, C(96.6, 97.05, 95.6, 97.0)]).length, 0));
});

describe("Marubozu and two strong candles (breakout / breakdown)", () => {
  it("BEARISH MARUBOZU: full red body, big, high volume", () => assert.ok(marubozu([...quiet, ...decline, C(97, 97.05, 94.6, 94.65, 2500)], "BEAR")));
  it("…not with normal volume", () => assert.ok(!marubozu([...quiet, ...decline, C(97, 97.05, 94.6, 94.65, 1000)], "BEAR")));
  it("…not with long wicks", () => assert.ok(!marubozu([...quiet, ...decline, C(97, 97.8, 94.0, 94.65, 2500)], "BEAR")));
  it("BULLISH MARUBOZU (mirror)", () => assert.ok(marubozu(mirror([...quiet, ...decline, C(97, 97.05, 94.6, 94.65, 2500)]), "BULL")));
  it("two strong red candles with volume", () => assert.ok(twoStrong([...quiet, ...decline, C(97, 97.05, 95.9, 96, 2000), C(96, 96.05, 94.9, 95, 2100)], "BEAR")));
  it("…not when one of them has long wicks", () => assert.ok(!twoStrong([...quiet, ...decline, C(97, 97.8, 95.2, 96, 2000), C(96, 96.05, 94.9, 95, 2100)], "BEAR")));
  it("…too few candles → never guesses", () => assert.ok(!twoStrong([C(1, 1, 1, 1), C(1, 1, 1, 1)], "BEAR")));
});
