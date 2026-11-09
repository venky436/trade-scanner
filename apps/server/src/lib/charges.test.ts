// Estimated Zerodha intraday charges — hand-computed expectations.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { intradayCharges } from "./charges.js";

describe("intraday charges (estimate)", () => {
  it("BUY 100 @ 500 → exit 505 (brokerage below the ₹20 cap)", () => {
    // buy 50,000 · sell 50,500 · turnover 100,500
    // brokerage 15 + 15.15 = 30.15 · STT 12.625 · exch 2.98485 · SEBI 0.1005
    // GST 18% × 33.23535 = 5.98236 · stamp 1.5 → total 53.3427
    const c = intradayCharges("BUY", 100, 500, 505);
    assert.equal(c.brokerage, 30.15);
    assert.equal(c.stt, 12.63);
    assert.equal(c.exchange, 2.98);
    assert.equal(c.stamp, 1.5);
    assert.equal(c.total, 53.34);
  });
  it("brokerage is capped at ₹20 per order", () => {
    const c = intradayCharges("BUY", 1000, 500, 500); // ₹5 lakh each side → 0.03% = 150 → capped 20
    assert.equal(c.brokerage, 40);
  });
  it("SELL (short): STT on the entry (sell) value, stamp on the exit (buy) value", () => {
    const short = intradayCharges("SELL", 100, 505, 500); // sold 50,500 first, bought back 50,000
    const long = intradayCharges("BUY", 100, 500, 505);
    assert.equal(short.stt, long.stt);
    assert.equal(short.stamp, long.stamp);
    assert.equal(short.total, long.total);
  });
  it("invalid input → zero charges (never NaN)", () => {
    assert.equal(intradayCharges("BUY", 0, 500, 505).total, 0);
    assert.equal(intradayCharges("BUY", 100, 0, 505).total, 0);
  });
  it("roughly 0.09–0.11% of one side's value for a typical ₹50k trade", () => {
    const c = intradayCharges("BUY", 100, 500, 500);
    const pct = (c.total / 50_000) * 100;
    assert.ok(pct > 0.09 && pct < 0.12, `got ${pct.toFixed(3)}%`);
  });
});
