import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractUnderlying,
  formatFutureDisplayName,
  isFutureSymbol,
  isMonthlyContract,
  FUTURES_EXPIRY_MODE,
  INDEX_FUTURE_UNDERLYINGS,
  INDEX_FUTURES_EXCHANGE,
  INDEX_FUTURES_SEGMENT,
  MONTHLY_EXPIRY_DOW,
} from "./index-futures-config.js";

describe("isFutureSymbol", () => {
  it("returns true for monthly futures shape", () => {
    assert.equal(isFutureSymbol("NIFTY25JUNFUT"), true);
    assert.equal(isFutureSymbol("BANKNIFTY25DECFUT"), true);
    assert.equal(isFutureSymbol("FINNIFTY25JANFUT"), true);
  });

  it("returns false for stocks", () => {
    assert.equal(isFutureSymbol("RELIANCE"), false);
    assert.equal(isFutureSymbol("HDFCBANK"), false);
    assert.equal(isFutureSymbol("TCS"), false);
  });

  it("returns false for index spot symbols", () => {
    assert.equal(isFutureSymbol("NIFTY 50"), false);
    assert.equal(isFutureSymbol("NIFTY BANK"), false);
  });

  it("returns false for empty / partial / odd inputs", () => {
    assert.equal(isFutureSymbol(""), false);
    assert.equal(isFutureSymbol("FUT"), false);
    assert.equal(isFutureSymbol("NIFTYFUT"), false);
    // Options would be NIFTY25JUN24000CE — not FUT
    assert.equal(isFutureSymbol("NIFTY25JUN24000CE"), false);
  });
});

describe("extractUnderlying", () => {
  it("pulls the underlying name out of a futures symbol", () => {
    assert.equal(extractUnderlying("NIFTY25JUNFUT"), "NIFTY");
    assert.equal(extractUnderlying("BANKNIFTY25DECFUT"), "BANKNIFTY");
    assert.equal(extractUnderlying("FINNIFTY25JANFUT"), "FINNIFTY");
  });

  it("returns null for non-futures symbols", () => {
    assert.equal(extractUnderlying("RELIANCE"), null);
    assert.equal(extractUnderlying("NIFTY 50"), null);
    assert.equal(extractUnderlying(""), null);
  });
});

describe("formatFutureDisplayName", () => {
  it("formats a NIFTY monthly future (last Thursday)", () => {
    const expiry = new Date("2026-06-25T00:00:00Z"); // Thursday
    assert.equal(
      formatFutureDisplayName("NIFTY25JUNFUT", expiry),
      "NIFTY 25-Jun FUT",
    );
  });

  it("formats a NIFTY weekly future (Tuesday) — distinguishable from monthly by the day", () => {
    const expiry = new Date("2026-06-23T00:00:00Z"); // Tuesday
    assert.equal(
      formatFutureDisplayName("NIFTY25JUNFUT", expiry),
      "NIFTY 23-Jun FUT",
    );
  });

  it("formats a BANKNIFTY December future correctly", () => {
    const expiry = new Date("2026-12-31T00:00:00Z");
    assert.equal(
      formatFutureDisplayName("BANKNIFTY25DECFUT", expiry),
      "BANKNIFTY 31-Dec FUT",
    );
  });

  it("accepts a YYYY-MM-DD string for expiry", () => {
    assert.equal(
      formatFutureDisplayName("NIFTY25JUNFUT", "2026-06-25"),
      "NIFTY 25-Jun FUT",
    );
  });

  it("falls back to raw trading symbol when expiry is missing", () => {
    assert.equal(
      formatFutureDisplayName("NIFTY25JUNFUT", null),
      "NIFTY25JUNFUT",
    );
    assert.equal(
      formatFutureDisplayName("NIFTY25JUNFUT", undefined),
      "NIFTY25JUNFUT",
    );
    assert.equal(
      formatFutureDisplayName("NIFTY25JUNFUT", ""),
      "NIFTY25JUNFUT",
    );
  });

  it("falls back to raw trading symbol when expiry is invalid", () => {
    assert.equal(
      formatFutureDisplayName("NIFTY25JUNFUT", "not-a-date"),
      "NIFTY25JUNFUT",
    );
  });

  it("falls back to raw symbol when the symbol isn't a recognised future shape", () => {
    assert.equal(formatFutureDisplayName("RELIANCE", "2026-06-25"), "RELIANCE");
    assert.equal(formatFutureDisplayName("NIFTY 50", "2026-06-25"), "NIFTY 50");
  });

  it("handles every month label correctly (Jan..Dec)", () => {
    for (let m = 0; m < 12; m++) {
      const expiry = new Date(Date.UTC(2026, m, 15));
      const expected = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m];
      assert.equal(
        formatFutureDisplayName("NIFTY25XXXFUT", expiry),
        `NIFTY 15-${expected} FUT`,
      );
    }
  });
});

describe("isMonthlyContract", () => {
  it("returns true for a Thursday expiry (NIFTY monthly convention)", () => {
    // 2026-06-25 is a Thursday
    assert.equal(isMonthlyContract(new Date("2026-06-25T00:00:00Z")), true);
    assert.equal(isMonthlyContract("2026-06-25"), true);
  });

  it("returns false for a Tuesday expiry (NIFTY weekly convention)", () => {
    // 2026-06-23 is a Tuesday
    assert.equal(isMonthlyContract(new Date("2026-06-23T00:00:00Z")), false);
  });

  it("returns false for any other day of week", () => {
    // 2026-06-22 Mon, 24 Wed, 26 Fri, 27 Sat, 28 Sun
    assert.equal(isMonthlyContract("2026-06-22"), false);
    assert.equal(isMonthlyContract("2026-06-24"), false);
    assert.equal(isMonthlyContract("2026-06-26"), false);
    assert.equal(isMonthlyContract("2026-06-27"), false);
    assert.equal(isMonthlyContract("2026-06-28"), false);
  });

  it("returns false for invalid / missing input", () => {
    assert.equal(isMonthlyContract(null), false);
    assert.equal(isMonthlyContract(undefined), false);
    assert.equal(isMonthlyContract(""), false);
    assert.equal(isMonthlyContract("not-a-date"), false);
  });
});

describe("config constants", () => {
  it("v1 tracks NIFTY only — single source of truth", () => {
    assert.deepEqual([...INDEX_FUTURE_UNDERLYINGS], ["NIFTY"]);
  });

  it("uses the correct Kite exchange + segment for NSE F&O futures", () => {
    assert.equal(INDEX_FUTURES_EXCHANGE, "NFO");
    assert.equal(INDEX_FUTURES_SEGMENT, "NFO-FUT");
  });

  it("monthly-expiry day-of-week is Thursday (NSE convention)", () => {
    assert.equal(MONTHLY_EXPIRY_DOW, 4);
  });

  it("default expiry mode is weekly (user picks where volume concentrates)", () => {
    assert.equal(FUTURES_EXPIRY_MODE, "weekly");
  });
});
