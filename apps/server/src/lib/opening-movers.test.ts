// Opening movers — pure rule tests (first 5-min candle only).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openingSignal, openingBaseline, firstCandle, type OpeningCandle } from "./opening-movers.js";

// epoch seconds for an IST wall-clock time
const at = (date: string, hhmm: string) => Math.floor(new Date(`${date}T${hhmm}:00+05:30`).getTime() / 1000);
const C = (time: number, close: number, volume = 1000, open = close): OpeningCandle => ({ time, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume });

describe("openingSignal (candle 1 only)", () => {
  it("BUY: candle 1 closes above yesterday's close with volume ≥ 2× normal", () => {
    const s = openingSignal(100, 1000, C(at("2026-11-13", "09:15"), 102, 2500, 100))!;
    assert.equal(s.side, "BUY");
    assert.equal(s.movePct, 2);
    assert.equal(s.volumeX, 2.5);
  });
  it("SELL: candle 1 closes below yesterday's close with volume ≥ 2× normal", () => {
    const s = openingSignal(100, 1000, C(at("2026-11-13", "09:15"), 97, 3000, 100))!;
    assert.equal(s.side, "SELL");
    assert.equal(s.movePct, -3);
    assert.equal(s.volumeX, 3);
  });
  it("no signal when candle 1 closes exactly at yesterday's close", () => {
    assert.equal(openingSignal(100, 1000, C(at("2026-11-13", "09:15"), 100, 5000)), null);
  });
  it("no signal when volume < 2× normal", () => {
    assert.equal(openingSignal(100, 1000, C(at("2026-11-13", "09:15"), 103, 1999)), null);
  });
  it("bad inputs → null", () => {
    const c = C(at("2026-11-13", "09:15"), 102, 5000);
    assert.equal(openingSignal(0, 1000, c), null);
    assert.equal(openingSignal(100, 0, c), null);
  });
});

describe("firstCandle / openingBaseline", () => {
  const day = (date: string, v1: number, close: number) => [
    C(at(date, "09:15"), close, v1),
    C(at(date, "09:20"), close, 77_777),
    C(at(date, "15:25"), close + 1, 50),
  ];
  it("finds the day's 09:15 candle by IST time, not by position", () => {
    const cs = [...day("2026-11-12", 10, 50), C(at("2026-11-13", "09:20"), 7, 2), C(at("2026-11-13", "09:15"), 6, 1)];
    assert.equal(firstCandle(cs, "2026-11-13")!.close, 6);
    assert.equal(firstCandle([C(at("2026-11-13", "09:20"), 6)], "2026-11-13"), null, "09:15 not there");
  });
  it("normal volume = average 09:15-candle volume of earlier days (09:20 ignored); prevClose = last candle of yesterday; today ignored", () => {
    const cs = [...day("2026-11-10", 100, 40), ...day("2026-11-11", 300, 45), ...day("2026-11-12", 200, 50), ...day("2026-11-13", 9999, 60)];
    const b = openingBaseline(cs, "2026-11-13")!;
    assert.equal(b.normalVolume, 200);
    assert.equal(b.prevClose, 51);
    assert.equal(b.days, 3);
  });
  it("uses only the last 10 trading days", () => {
    const cs: OpeningCandle[] = [];
    for (let d = 1; d <= 12; d++) cs.push(...day(`2026-10-${String(d).padStart(2, "0")}`, d <= 2 ? 100_000 : 100, 10));
    assert.equal(openingBaseline(cs, "2026-11-13")!.normalVolume, 100);
  });
  it("no earlier days → null", () => assert.equal(openingBaseline(day("2026-11-13", 1, 1), "2026-11-13"), null));
});
