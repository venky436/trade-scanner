import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { simulate, SIM_DEFAULTS } from "./simulate.js";
import type { Setup } from "./types.js";
import { day, flat } from "./test-helpers.js";

const NO_SLIP = { ...SIM_DEFAULTS, slipPct: 0 };
const long: Setup = { strategy: "T", dir: 1, formedIdx: 0, activeFrom: 1, entry: 100, stop: 99, zoneTop: 100.5, zoneBottom: 99.5 };
const short: Setup = { strategy: "T", dir: -1, formedIdx: 0, activeFrom: 1, entry: 100, stop: 101, zoneTop: 100.5, zoneBottom: 99.5 };

describe("simulate", () => {
  it("long: fills at the limit, hits 2R target", () => {
    const c = day([[101, 101, 101, 101, 1], [100.5, 100.6, 99.8, 100.2, 1], [100.2, 102.3, 100.1, 102.2, 1]]);
    const r = simulate(c, c.length, long, NO_SLIP)!;
    assert.equal(r.fill, 100);
    assert.equal(r.fillIdx, 1);
    assert.equal(r.reason, "TARGET");
    assert.equal(r.exit, 102);
  });
  it("fill candle also touches the stop → STOP (worst case)", () => {
    const c = day([[101, 101, 101, 101, 1], [100.5, 100.6, 98.9, 99.5, 1], [99.5, 103, 99.5, 103, 1]]);
    assert.equal(simulate(c, c.length, long, NO_SLIP)!.reason, "STOP");
  });
  it("stop and target in the same later candle → STOP", () => {
    const c = day([[101, 101, 101, 101, 1], [100.5, 100.6, 99.9, 100.1, 1], [100.1, 102.5, 98.5, 100, 1]]);
    const r = simulate(c, c.length, long, NO_SLIP)!;
    assert.equal(r.reason, "STOP");
    assert.equal(r.exit, 99);
  });
  it("gap down through the limit fills at the open (better price)", () => {
    const c = day([[101, 101, 101, 101, 1], [99.6, 99.7, 99.5, 99.6, 1], ...flat(1, 99.6)]);
    assert.equal(simulate(c, c.length, long, NO_SLIP)!.fill, 99.6);
  });
  it("opens beyond the stop before any fill → cancelled", () => {
    const c = day([[101, 101, 101, 101, 1], [98.5, 98.6, 98, 98.2, 1]]);
    assert.equal(simulate(c, c.length, long, NO_SLIP), null);
  });
  it("gap through the stop after entry → exit at the open", () => {
    const c = day([[101, 101, 101, 101, 1], [100.5, 100.6, 99.9, 100.1, 1], [98.5, 98.7, 98.2, 98.4, 1]]);
    const r = simulate(c, c.length, long, NO_SLIP)!;
    assert.equal(r.reason, "STOP_GAP");
    assert.equal(r.exit, 98.5);
  });
  it("no target: holds until the 15:10 candle closes", () => {
    const rows = [[101, 101, 101, 101, 1], [100.5, 100.6, 99.9, 100.1, 1], ...flat(80, 100.5)] as [number, number, number, number, number][];
    const c = day(rows);
    const r = simulate(c, c.length, long, { ...NO_SLIP, targetR: null })!;
    assert.equal(r.reason, "EOD");
    assert.equal(r.exitIdx, 71, "09:15 + 71×5min = 15:10");
  });
  it("short is the mirror: fills when high ≥ entry, target below", () => {
    const c = day([[99, 99, 99, 99, 1], [99.5, 100.2, 99.4, 99.9, 1], [99.9, 99.95, 97.8, 97.9, 1]]);
    const r = simulate(c, c.length, short, NO_SLIP)!;
    assert.equal(r.fill, 100);
    assert.equal(r.reason, "TARGET");
    assert.equal(r.exit, 98);
  });
  it("slippage makes stop exits worse for both sides", () => {
    const c = day([[101, 101, 101, 101, 1], [100.5, 100.6, 99.9, 100.1, 1], [100, 100.1, 98.8, 99, 1]]);
    assert.ok(simulate(c, c.length, long, { ...NO_SLIP, slipPct: 0.001 })!.exit < 99);
    const s = day([[99, 99, 99, 99, 1], [99.5, 100.1, 99.4, 99.9, 1], [100, 101.2, 99.9, 101, 1]]);
    assert.ok(simulate(s, s.length, short, { ...NO_SLIP, slipPct: 0.001 })!.exit > 101);
  });
  it("no new entries after 13:55", () => {
    const rows = [...flat(60, 101), [100.5, 100.6, 99.9, 100.1, 1]] as [number, number, number, number, number][];
    const c = day(rows);
    assert.equal(simulate(c, c.length, { ...long, activeFrom: 60 }, NO_SLIP), null, "index 60 = 14:15");
  });
});
