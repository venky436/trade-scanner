// Call window + volume rule for trade setups (pure helpers, no DB).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inCallWindow, passesCallVolume, istMinutes } from "./trade-setups.js";
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
