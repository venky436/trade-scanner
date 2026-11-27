// Call window + volume rule for trade setups (pure helpers, no DB).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTradeSetups, inCallWindow, passesCallVolume, istMinutes } from "./trade-setups.js";
import { marketDataService } from "../services/market-data.service.js";
import type { DayLevels } from "./day-levels.js";
import type { Candle } from "./types.js";

const ist = (hh: number, mm: number) => Date.UTC(2026, 10, 9, hh, mm) - 330 * 60_000; // IST clock → epoch ms
const c = (volume: number): Candle => ({ time: 0, open: 100, high: 101, low: 99, close: 100.5, volume });

describe("call window 09:30–14:00 IST", () => {
  it("converts to IST minutes", () => assert.equal(istMinutes(ist(9, 30)), 570));
  it("closed before 09:30", () => {
    assert.equal(inCallWindow(ist(9, 15)), false);
    assert.equal(inCallWindow(ist(9, 29)), false);
  });
  it("open 09:30 → 13:59", () => {
    assert.equal(inCallWindow(ist(9, 30)), true);
    assert.equal(inCallWindow(ist(12, 0)), true);
    assert.equal(inCallWindow(ist(13, 59)), true);
  });
  it("closed from 14:00", () => {
    assert.equal(inCallWindow(ist(14, 0)), false);
    assert.equal(inCallWindow(ist(14, 30)), false);
  });
});

describe("confirmation candle volume ≥ 1.2× average", () => {
  it("passes at exactly 1.2×, fails just below", () => {
    assert.equal(passesCallVolume([c(1000), c(1000), c(1000), c(1200)]), true);
    assert.equal(passesCallVolume([c(1000), c(1000), c(1000), c(1199)]), false);
  });
  it("average uses up to 20 candles before the last one", () => {
    const old = Array.from({ length: 10 }, () => c(100_000)); // outside the 20-candle window
    const recent = Array.from({ length: 20 }, () => c(1000));
    assert.equal(passesCallVolume([...old, ...recent, c(1300)]), true);
  });
  it("needs at least 2 earlier candles for a baseline", () => {
    assert.equal(passesCallVolume([c(1000), c(5000)]), false);
    assert.equal(passesCallVolume([]), false);
  });
  it("zero-volume baseline → no", () => assert.equal(passesCallVolume([c(0), c(0), c(500)]), false));
});

// ── Day levels + stocks in play (2026-11-10) ────────────────────────────────

describe("Ready list with day levels: only stocks in play", () => {
  const C = (o: number, h: number, l: number, cl: number, v: number): Candle => ({ time: 0, open: o, high: h, low: l, close: cl, volume: v });
  // 14 calm candles then a breakout through R1 (1012) on 5× volume
  const session = [...Array.from({ length: 14 }, () => C(1003, 1005, 1001, 1003, 1000)), C(1003, 1015, 1002, 1014, 5000)];
  const lines = (prevClose: number, avgDailyVolume: number): DayLevels => ({
    date: "2026-11-11", open: 1000, prevClose, avgDailyVolume,
    levels: [{ name: "R1", kind: "RESISTANCE", level: 1010, min: 1008, max: 1012, strength: 2, days: 2 }],
  });
  const deps = (dl: DayLevels | null) => ({
    getCachedLevels: () => ({}),
    getPressure: () => ({ value: 0.9, signal: "STRONG_BUY" as const, trend: "rising" as const, confidence: 0.9 }),
    getMomentum: () => ({ value: 1, signal: "STRONG_UP" as const, acceleration: "STABLE" as const, accelerationRaw: 0, quality: 1 }),
    getRecentCandles: () => session,
    getSessionCandles: () => session,
    getAllSymbols: () => ["INPLAY"],
    getDayLevels: () => dl,
  });
  marketDataService.updateQuote("INPLAY", { lastPrice: 1014, open: 1000, high: 1015, low: 1001, close: 990, volume: 1, timestamp: 0 });
  const noon = ist(12, 0);

  it("gap ≥ 0.7 % → in play → READY", () => {
    const r = buildTradeSetups(deps(lines(985, 10_000_000)), 10, noon); // gap +1.5 %
    assert.deepEqual(r.ready.map((s) => s.symbol), ["INPLAY"]);
    assert.equal(r.rules.dayLevels, true);
    assert.match(r.rules.inPlay!, /gap ≥ 0\.7%/);
    const small = buildTradeSetups(deps(lines(992, 10_000_000)), 10, noon); // gap +0.8 %
    assert.deepEqual(small.ready.map((s) => s.symbol), ["INPLAY"]);
  });
  it("gap 0.6 % and normal volume → not ready", () => {
    const r = buildTradeSetups(deps(lines(994, 10_000_000)), 10, noon); // gap +0.6 %
    assert.equal(r.ready.length, 0);
  });
  it("first 15 min volume ≥ 2× normal → in play → READY", () => {
    // first 3 candles = 3,000 shares; normal = 8 % of 15,000 = 1,200 → 2.5×
    const r = buildTradeSetups(deps(lines(1000, 15_000)), 10, noon);
    assert.deepEqual(r.ready.map((s) => s.symbol), ["INPLAY"]);
  });
  it("not in play (no gap, normal volume) → not ready, same setup", () => {
    const r = buildTradeSetups(deps(lines(1000, 10_000_000)), 10, noon);
    assert.equal(r.ready.length, 0);
  });
  it("lines not computed yet → no call", () => {
    const r = buildTradeSetups(deps(null), 10, noon);
    assert.equal(r.ready.length, 0);
  });
});
