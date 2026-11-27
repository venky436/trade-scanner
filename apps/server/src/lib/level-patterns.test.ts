// Candlestick pattern at a support / resistance line — pure unit tests.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { patternAtLine } from "./level-patterns.js";
import type { DayLevels } from "./day-levels.js";
import type { Candle } from "./types.js";

const C = (o: number, h: number, l: number, c: number, v = 1000): Candle => ({ time: 0, open: o, high: h, low: l, close: c, volume: v });
const quiet = Array.from({ length: 22 }, (_, i) => (i % 2 ? C(100, 101.25, 99.25, 100.5) : C(100.5, 101.25, 99.25, 99.5)));
const decline = [C(100, 100.3, 98.8, 99), C(99, 99.2, 97.8, 98), C(98, 98.2, 96.8, 97)];
const hammer = C(96.6, 97.05, 95.6, 97.0);
const timed = (cs: Candle[]) => cs.map((c, i) => ({ ...c, time: 1_800_000_000 + i * 300 }));
const M = (x: Candle): Candle => ({ ...x, open: 200 - x.open, close: 200 - x.close, high: 200 - x.low, low: 200 - x.high });
const lines = (lv: DayLevels["levels"]): DayLevels => ({ date: "2026-11-11", open: 100, prevClose: 100, avgDailyVolume: 1e6, levels: lv });

describe("patternAtLine", () => {
  const atS1 = lines([{ name: "S1", kind: "SUPPORT", level: 95.8, min: 95.6, max: 96.0, strength: 2, days: 2 }]);
  it("HAMMER that tests S1 and closes above it → reported at S1", () => {
    const p = patternAtLine(atS1, timed([...quiet, ...decline, hammer]))!;
    assert.equal(p.pattern, "HAMMER");
    assert.equal(p.side, "BULLISH");
    assert.equal(p.line, "S1");
  });
  it("the same hammer far from any line → nothing", () => {
    const far = lines([{ name: "S1", kind: "SUPPORT", level: 90, min: 89.8, max: 90.2, strength: 2, days: 2 }]);
    assert.equal(patternAtLine(far, timed([...quiet, ...decline, hammer])), null);
  });
  it("a bullish pattern is never reported at a RESISTANCE line", () => {
    const r = lines([{ name: "R1", kind: "RESISTANCE", level: 95.8, min: 95.6, max: 96.0, strength: 2, days: 2 }]);
    assert.equal(patternAtLine(r, timed([...quiet, ...decline, hammer])), null);
  });
  it("SHOOTING STAR at a resistance line (mirror) → reported at R1", () => {
    const r1 = lines([{ name: "R1", kind: "RESISTANCE", level: 104.2, min: 104.0, max: 104.4, strength: 2, days: 2 }]);
    const p = patternAtLine(r1, timed([...quiet, ...decline, hammer].map(M)))!;
    assert.equal(p.pattern, "SHOOTING_STAR");
    assert.equal(p.side, "BEARISH");
    assert.equal(p.line, "R1");
  });
  it("older than 3 candles (15 min) → no longer shown", () => {
    const later = [C(97, 97.4, 96.9, 97.3), C(97.3, 97.6, 97.2, 97.5), C(97.5, 97.8, 97.4, 97.6)];
    assert.equal(patternAtLine(atS1, timed([...quiet, ...decline, hammer, ...later])), null);
    assert.ok(patternAtLine(atS1, timed([...quiet, ...decline, hammer, ...later.slice(0, 2)])));
  });
  it("no lines yet → nothing", () => assert.equal(patternAtLine(null, timed([...quiet, ...decline, hammer])), null));
});
