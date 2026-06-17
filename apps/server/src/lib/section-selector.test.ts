import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ZONE_SECTION_CAP,
  ZONE_SECTION_CONF_FLOOR,
  STRONG_ALIGNMENT_CAP,
  STRONG_ALIGNMENT_FLOOR,
  VOLATILE_ATR_PCT_FLOOR,
  VOLATILE_RVOL_FLOOR,
  VOLATILE_CAP,
  DAY_MOVERS_PCT_FLOOR,
  DAY_MOVERS_RVOL_FLOOR,
  DAY_MOVERS_CAP,
  selectNearSupport,
  selectNearResistance,
  selectStrongAlignment,
  selectAiTargets,
  selectVolatile,
  selectDayMovers,
} from "./section-selector.js";
import type {
  DayMover,
  IntelligenceSnapshot,
  Outlook,
  VolatileStock,
  Zone,
} from "./types.js";

function snap(opts: {
  symbol: string;
  zone?: Zone;
  outlook?: Outlook;
  confidence?: number;
}): IntelligenceSnapshot {
  return {
    symbol: opts.symbol,
    price: 100,
    change: 0,
    timestamp: 0,
    context: { zone: opts.zone ?? "MID_RANGE", distanceToLevel: null, level: null },
    momentum: { label: "NEUTRAL", score: 0 },
    pressure: { label: "NEUTRAL", score: 0 },
    volatility: { label: "LOW", score: 0.2 },
    outlook: opts.outlook ?? "NO_CLEAR_EDGE",
    bias: "NEUTRAL",
    confidence: opts.confidence ?? 0,
    confidenceLabel: "LOW",
    tradePlan: null,
  };
}

describe("section-selector — selectNearSupport", () => {
  it("returns stocks in NEAR_SUPPORT zone above the confidence floor, sorted by confidence DESC", () => {
    const result = selectNearSupport([
      snap({ symbol: "A", zone: "NEAR_SUPPORT", confidence: 0.7 }),
      snap({ symbol: "B", zone: "NEAR_SUPPORT", confidence: 0.9 }),
      snap({ symbol: "C", zone: "NEAR_SUPPORT", confidence: 0.8 }),
    ]);
    assert.deepEqual(result.map((s) => s.symbol), ["B", "C", "A"]);
  });

  it("excludes stocks below the confidence floor", () => {
    const result = selectNearSupport([
      snap({ symbol: "LOW", zone: "NEAR_SUPPORT", confidence: 0.5 }),
      snap({ symbol: "JUST_OVER", zone: "NEAR_SUPPORT", confidence: 0.66 }),
    ]);
    assert.deepEqual(result.map((s) => s.symbol), ["JUST_OVER"]);
  });

  it("excludes stocks with the floor as a strict-less-than (boundary at exactly floor passes)", () => {
    const result = selectNearSupport([
      snap({ symbol: "EQUAL", zone: "NEAR_SUPPORT", confidence: ZONE_SECTION_CONF_FLOOR }),
    ]);
    assert.equal(result.length, 1, "≥ floor should pass");
  });

  it("excludes stocks in other zones", () => {
    const result = selectNearSupport([
      snap({ symbol: "SUP", zone: "NEAR_SUPPORT", confidence: 0.9 }),
      snap({ symbol: "RES", zone: "NEAR_RESISTANCE", confidence: 0.9 }),
      snap({ symbol: "MID", zone: "MID_RANGE", confidence: 0.9 }),
    ]);
    assert.deepEqual(result.map((s) => s.symbol), ["SUP"]);
  });

  it("caps at ZONE_SECTION_CAP", () => {
    const candidates = Array.from({ length: 20 }, (_, i) =>
      snap({ symbol: `S${i}`, zone: "NEAR_SUPPORT", confidence: 0.7 + i * 0.01 }),
    );
    const result = selectNearSupport(candidates);
    assert.equal(result.length, ZONE_SECTION_CAP);
  });

  it("excludes index symbols", () => {
    const result = selectNearSupport([
      snap({ symbol: "NIFTY 50", zone: "NEAR_SUPPORT", confidence: 0.95 }),
      snap({ symbol: "NIFTY BANK", zone: "NEAR_SUPPORT", confidence: 0.92 }),
      snap({ symbol: "RELIANCE", zone: "NEAR_SUPPORT", confidence: 0.7 }),
    ]);
    assert.deepEqual(result.map((s) => s.symbol), ["RELIANCE"]);
  });

  it("does not mutate the input array", () => {
    const input = [
      snap({ symbol: "A", zone: "NEAR_SUPPORT", confidence: 0.7 }),
      snap({ symbol: "B", zone: "NEAR_SUPPORT", confidence: 0.9 }),
    ];
    const inputCopy = [...input];
    selectNearSupport(input);
    assert.deepEqual(input, inputCopy);
  });
});

describe("section-selector — selectNearResistance", () => {
  it("mirrors selectNearSupport but on the resistance zone", () => {
    const result = selectNearResistance([
      snap({ symbol: "SUP", zone: "NEAR_SUPPORT", confidence: 0.9 }),
      snap({ symbol: "RES", zone: "NEAR_RESISTANCE", confidence: 0.9 }),
    ]);
    assert.deepEqual(result.map((s) => s.symbol), ["RES"]);
  });

  it("respects the confidence floor + cap", () => {
    const candidates = [
      ...Array.from({ length: 10 }, (_, i) =>
        snap({ symbol: `R${i}`, zone: "NEAR_RESISTANCE", confidence: 0.7 + i * 0.01 }),
      ),
      snap({ symbol: "BELOW", zone: "NEAR_RESISTANCE", confidence: 0.5 }),
    ];
    const result = selectNearResistance(candidates);
    assert.equal(result.length, ZONE_SECTION_CAP);
    assert.ok(result.every((s) => s.symbol !== "BELOW"));
  });
});

describe("section-selector — selectStrongAlignment", () => {
  it("requires confidence ≥ 0.85 AND directional outlook", () => {
    const result = selectStrongAlignment([
      snap({ symbol: "HIGH_DIR", zone: "NEAR_SUPPORT", confidence: 0.9, outlook: "BOUNCE_EXPECTED" }),
      snap({ symbol: "HIGH_NODIR", zone: "MID_RANGE", confidence: 0.9, outlook: "NO_CLEAR_EDGE" }),
      snap({ symbol: "LOW_DIR", zone: "NEAR_SUPPORT", confidence: 0.7, outlook: "BOUNCE_EXPECTED" }),
    ]);
    assert.deepEqual(result.map((s) => s.symbol), ["HIGH_DIR"]);
  });

  it("accepts all four directional outlooks", () => {
    const outlooks: Outlook[] = ["BOUNCE_EXPECTED", "REJECTION_POSSIBLE", "BREAKOUT_LIKELY", "BREAKDOWN_RISK"];
    const result = selectStrongAlignment(
      outlooks.map((o, i) =>
        snap({ symbol: o, zone: "NEAR_SUPPORT", confidence: 0.9 - i * 0.01, outlook: o }),
      ),
    );
    assert.deepEqual(result.map((s) => s.symbol), outlooks);
  });

  it("rejects NO_CLEAR_EDGE even at maximum confidence", () => {
    const result = selectStrongAlignment([
      snap({ symbol: "PERFECT_NULL", zone: "NEAR_SUPPORT", confidence: 1.0, outlook: "NO_CLEAR_EDGE" }),
    ]);
    assert.equal(result.length, 0);
  });

  it("caps at STRONG_ALIGNMENT_CAP", () => {
    const candidates = Array.from({ length: 12 }, (_, i) =>
      snap({ symbol: `S${i}`, zone: "NEAR_SUPPORT", confidence: 0.86 + i * 0.005, outlook: "BOUNCE_EXPECTED" }),
    );
    const result = selectStrongAlignment(candidates);
    assert.equal(result.length, STRONG_ALIGNMENT_CAP);
  });

  it("boundary: confidence exactly at STRONG_ALIGNMENT_FLOOR passes", () => {
    const result = selectStrongAlignment([
      snap({
        symbol: "EXACT",
        zone: "NEAR_SUPPORT",
        confidence: STRONG_ALIGNMENT_FLOOR,
        outlook: "BOUNCE_EXPECTED",
      }),
    ]);
    assert.equal(result.length, 1);
  });

  it("excludes index symbols regardless of confidence", () => {
    const result = selectStrongAlignment([
      snap({ symbol: "NIFTY 50", zone: "NEAR_SUPPORT", confidence: 0.95, outlook: "BOUNCE_EXPECTED" }),
    ]);
    assert.equal(result.length, 0);
  });
});

describe("section-selector — selectAiTargets (union, deduped)", () => {
  it("returns the union of all three lanes, deduped by symbol", () => {
    const stocks: IntelligenceSnapshot[] = [
      // Will appear in NEAR_SUPPORT + Strong Alignment (deduped)
      snap({ symbol: "DUAL", zone: "NEAR_SUPPORT", confidence: 0.9, outlook: "BOUNCE_EXPECTED" }),
      // NEAR_SUPPORT only
      snap({ symbol: "SUP_ONLY", zone: "NEAR_SUPPORT", confidence: 0.7, outlook: "NO_CLEAR_EDGE" }),
      // NEAR_RESISTANCE only
      snap({ symbol: "RES_ONLY", zone: "NEAR_RESISTANCE", confidence: 0.75, outlook: "NO_CLEAR_EDGE" }),
      // Strong Alignment only (MID_RANGE — doesn't qualify for Strong Alignment because directional needs a zone; but the function doesn't enforce that)
      // Actually directional outlooks come from zone-aware logic, so MID_RANGE + directional is unlikely in practice but
      // selectStrongAlignment doesn't filter on zone — let it through if AI thinks so.
      snap({ symbol: "STRONG_MID", zone: "MID_RANGE", confidence: 0.9, outlook: "BREAKOUT_LIKELY" }),
    ];
    const result = selectAiTargets(stocks);
    const symbols = result.map((s) => s.symbol);
    assert.ok(symbols.includes("DUAL"));
    assert.ok(symbols.includes("SUP_ONLY"));
    assert.ok(symbols.includes("RES_ONLY"));
    assert.ok(symbols.includes("STRONG_MID"));
    // DUAL must appear exactly once (dedup)
    assert.equal(symbols.filter((s) => s === "DUAL").length, 1);
  });

  it("preserves first-lane order — NEAR_SUPPORT symbols come before NEAR_RESISTANCE before Strong Alignment", () => {
    const stocks: IntelligenceSnapshot[] = [
      snap({ symbol: "S1", zone: "NEAR_SUPPORT", confidence: 0.8 }),
      snap({ symbol: "R1", zone: "NEAR_RESISTANCE", confidence: 0.8 }),
      snap({ symbol: "SA1", zone: "MID_RANGE", confidence: 0.9, outlook: "BREAKOUT_LIKELY" }),
    ];
    const result = selectAiTargets(stocks);
    assert.deepEqual(result.map((s) => s.symbol), ["S1", "R1", "SA1"]);
  });

  it("returns empty list when nothing qualifies", () => {
    const result = selectAiTargets([
      snap({ symbol: "WEAK", zone: "NEAR_SUPPORT", confidence: 0.1 }),
      snap({ symbol: "MID", zone: "MID_RANGE", confidence: 0.5 }),
    ]);
    assert.equal(result.length, 0);
  });

  it("hard cap: union never exceeds 2 × ZONE_SECTION_CAP + STRONG_ALIGNMENT_CAP", () => {
    const candidates: IntelligenceSnapshot[] = [];
    // Flood every lane with distinct symbols
    for (let i = 0; i < 30; i++) {
      candidates.push(
        snap({ symbol: `SUP_${i}`, zone: "NEAR_SUPPORT", confidence: 0.7 + (i % 10) * 0.01 }),
      );
      candidates.push(
        snap({ symbol: `RES_${i}`, zone: "NEAR_RESISTANCE", confidence: 0.7 + (i % 10) * 0.01 }),
      );
      candidates.push(
        snap({
          symbol: `SA_${i}`,
          zone: "MID_RANGE",
          confidence: 0.86 + (i % 10) * 0.001,
          outlook: "BREAKOUT_LIKELY",
        }),
      );
    }
    const result = selectAiTargets(candidates);
    const maxExpected = ZONE_SECTION_CAP * 2 + STRONG_ALIGNMENT_CAP;
    assert.ok(result.length <= maxExpected, `expected ≤ ${maxExpected}, got ${result.length}`);
  });
});

// ─── selectVolatile ────────────────────────────────────────────────────────

function vol(opts: {
  symbol: string;
  price?: number;
  changePct?: number;
  atrPct?: number;
  rvol?: number;
  lastVolMultiplier?: number;
  zone?: Zone;
}): VolatileStock {
  return {
    symbol: opts.symbol,
    price: opts.price ?? 100,
    changePct: opts.changePct ?? 0,
    atrPct: opts.atrPct ?? 2.0,
    rvol: opts.rvol ?? 2.0,
    dayHigh: 105,
    dayLow: 95,
    dayRangePosition: 0.5,
    nearestLevel: null,
    recentCandles: [
      {
        time: 0,
        direction: "up",
        volume: 1000,
        volMultiplier: opts.lastVolMultiplier ?? 1.0,
      },
    ],
    zone: opts.zone ?? "MID_RANGE",
    pattern: null,
  };
}

describe("section-selector — selectVolatile", () => {
  it("filters out stocks below the ATR% floor", () => {
    const result = selectVolatile([
      vol({ symbol: "LOW_ATR", atrPct: 1.0, rvol: 2.0 }),
      vol({ symbol: "OK", atrPct: 2.0, rvol: 2.0 }),
    ]);
    assert.deepEqual(result.map((s) => s.symbol), ["OK"]);
  });

  it("filters out stocks below the RVOL floor", () => {
    const result = selectVolatile([
      vol({ symbol: "LOW_VOL", atrPct: 2.0, rvol: 1.0 }),
      vol({ symbol: "OK", atrPct: 2.0, rvol: 2.0 }),
    ]);
    assert.deepEqual(result.map((s) => s.symbol), ["OK"]);
  });

  it("treats exactly-at-floor as passing (≥, not >)", () => {
    const result = selectVolatile([
      vol({
        symbol: "EXACT",
        atrPct: VOLATILE_ATR_PCT_FLOOR,
        rvol: VOLATILE_RVOL_FLOOR,
      }),
    ]);
    assert.equal(result.length, 1);
  });

  it("applies the priceMin filter", () => {
    const result = selectVolatile(
      [
        vol({ symbol: "CHEAP", price: 100 }),
        vol({ symbol: "MID", price: 300 }),
        vol({ symbol: "EXP", price: 1500 }),
      ],
      { priceMin: 250 },
    );
    assert.deepEqual(result.map((s) => s.symbol), ["MID", "EXP"]);
  });

  it("applies the priceMax filter", () => {
    const result = selectVolatile(
      [
        vol({ symbol: "CHEAP", price: 100 }),
        vol({ symbol: "MID", price: 300 }),
        vol({ symbol: "EXP", price: 1500 }),
      ],
      { priceMax: 500 },
    );
    assert.deepEqual(result.map((s) => s.symbol), ["CHEAP", "MID"]);
  });

  it("combines priceMin + priceMax (inclusive band)", () => {
    const result = selectVolatile(
      [
        vol({ symbol: "OUT_LOW", price: 200 }),
        vol({ symbol: "BAND_LOW", price: 250 }),
        vol({ symbol: "BAND_HIGH", price: 500 }),
        vol({ symbol: "OUT_HIGH", price: 501 }),
      ],
      { priceMin: 250, priceMax: 500 },
    );
    assert.deepEqual(result.map((s) => s.symbol), ["BAND_LOW", "BAND_HIGH"]);
  });

  it("sorts by ATR% DESC by default", () => {
    const result = selectVolatile([
      vol({ symbol: "A", atrPct: 1.6 }),
      vol({ symbol: "B", atrPct: 3.0 }),
      vol({ symbol: "C", atrPct: 2.0 }),
    ]);
    assert.deepEqual(result.map((s) => s.symbol), ["B", "C", "A"]);
  });

  it("sorts by RVOL DESC when requested", () => {
    const result = selectVolatile(
      [
        vol({ symbol: "A", rvol: 1.6 }),
        vol({ symbol: "B", rvol: 3.0 }),
        vol({ symbol: "C", rvol: 2.0 }),
      ],
      { sortBy: "rvol" },
    );
    assert.deepEqual(result.map((s) => s.symbol), ["B", "C", "A"]);
  });

  it("sorts by absolute changePct (so big drops rank alongside big rises)", () => {
    const result = selectVolatile(
      [
        vol({ symbol: "FLAT", changePct: 0.5 }),
        vol({ symbol: "BIG_DROP", changePct: -5 }),
        vol({ symbol: "BIG_RISE", changePct: 4 }),
      ],
      { sortBy: "changePct" },
    );
    assert.equal(result[0].symbol, "BIG_DROP", "abs(-5) > abs(4) > abs(0.5)");
    assert.equal(result[1].symbol, "BIG_RISE");
    assert.equal(result[2].symbol, "FLAT");
  });

  it("sorts by last-candle volume multiplier DESC", () => {
    const result = selectVolatile(
      [
        vol({ symbol: "A", lastVolMultiplier: 1.2 }),
        vol({ symbol: "SPIKE", lastVolMultiplier: 4.5 }),
        vol({ symbol: "B", lastVolMultiplier: 2.0 }),
      ],
      { sortBy: "lastCandleVolSpike" },
    );
    assert.deepEqual(result.map((s) => s.symbol), ["SPIKE", "B", "A"]);
  });

  it("caps the result at VOLATILE_CAP", () => {
    const many: VolatileStock[] = [];
    for (let i = 0; i < VOLATILE_CAP + 10; i++) {
      many.push(vol({ symbol: `S_${i}`, atrPct: 2 + i * 0.01, rvol: 2 }));
    }
    const result = selectVolatile(many);
    assert.equal(result.length, VOLATILE_CAP);
  });

  it("does not mutate the input array", () => {
    const input = [
      vol({ symbol: "A", atrPct: 2 }),
      vol({ symbol: "B", atrPct: 3 }),
    ];
    const beforeSyms = input.map((s) => s.symbol);
    selectVolatile(input);
    const afterSyms = input.map((s) => s.symbol);
    assert.deepEqual(afterSyms, beforeSyms);
  });
});

// ─── selectDayMovers ───────────────────────────────────────────────────────

function dm(opts: {
  symbol: string;
  price?: number;
  dayOpen?: number;
  dayMovePct?: number;
  rvol?: number;
  lastVolMultiplier?: number;
  zone?: Zone;
}): DayMover {
  // When dayMovePct is provided, use it directly (and infer signs/direction).
  // Otherwise derive from price + dayOpen.
  const price = opts.price ?? 100;
  const dayOpen = opts.dayOpen ?? 100;
  const dayMovePct =
    opts.dayMovePct !== undefined ? opts.dayMovePct : ((price - dayOpen) / dayOpen) * 100;
  const absDayMovePct = Math.abs(dayMovePct);
  return {
    symbol: opts.symbol,
    price,
    dayOpen,
    dayHigh: Math.max(price, dayOpen) * 1.01,
    dayLow: Math.min(price, dayOpen) * 0.99,
    dayMovePct,
    absDayMovePct,
    direction: dayMovePct >= 0 ? "up" : "down",
    distanceFromHighAbs: 1,
    distanceFromHighPct: 0.5,
    distanceFromLowAbs: 1,
    distanceFromLowPct: 0.5,
    dayRangePosition: 0.5,
    rvol: opts.rvol ?? 1.5,
    recentCandles: [
      {
        time: 0,
        direction: "up",
        volume: 1000,
        volMultiplier: opts.lastVolMultiplier ?? 1.0,
      },
    ],
    zone: opts.zone ?? "MID_RANGE",
    pattern: null,
  };
}

describe("section-selector — selectDayMovers", () => {
  it("filters out stocks below the |Day Move %| floor", () => {
    const result = selectDayMovers([
      dm({ symbol: "SMALL", dayMovePct: 2 }),     // below 3% floor
      dm({ symbol: "OK", dayMovePct: 5 }),
      dm({ symbol: "OK_DOWN", dayMovePct: -4 }),
    ]);
    assert.deepEqual(
      result.map((s) => s.symbol).sort(),
      ["OK", "OK_DOWN"].sort(),
    );
  });

  it("treats |dayMovePct| at exactly the floor as passing (≥)", () => {
    const result = selectDayMovers([
      dm({ symbol: "AT_FLOOR_UP", dayMovePct: DAY_MOVERS_PCT_FLOOR }),
      dm({ symbol: "AT_FLOOR_DOWN", dayMovePct: -DAY_MOVERS_PCT_FLOOR }),
    ]);
    assert.equal(result.length, 2);
  });

  it("filters out stocks below the RVOL floor", () => {
    const result = selectDayMovers([
      dm({ symbol: "BIG_BUT_QUIET", dayMovePct: 10, rvol: 0.5 }),
      dm({ symbol: "OK", dayMovePct: 5, rvol: 1.0 }),
    ]);
    assert.deepEqual(result.map((s) => s.symbol), ["OK"]);
  });

  it("direction filter 'gainers' keeps only ups", () => {
    const result = selectDayMovers(
      [
        dm({ symbol: "UP_5", dayMovePct: 5 }),
        dm({ symbol: "DOWN_4", dayMovePct: -4 }),
        dm({ symbol: "UP_10", dayMovePct: 10 }),
      ],
      { direction: "gainers" },
    );
    assert.deepEqual(result.map((s) => s.symbol), ["UP_10", "UP_5"]);
  });

  it("direction filter 'losers' keeps only downs", () => {
    const result = selectDayMovers(
      [
        dm({ symbol: "UP_5", dayMovePct: 5 }),
        dm({ symbol: "DOWN_4", dayMovePct: -4 }),
        dm({ symbol: "DOWN_8", dayMovePct: -8 }),
      ],
      { direction: "losers" },
    );
    assert.deepEqual(result.map((s) => s.symbol), ["DOWN_8", "DOWN_4"]);
  });

  it("applies the price band (inclusive)", () => {
    const result = selectDayMovers(
      [
        dm({ symbol: "CHEAP", price: 100, dayMovePct: 5 }),
        dm({ symbol: "MID", price: 300, dayMovePct: 5 }),
        dm({ symbol: "EXP", price: 1500, dayMovePct: 5 }),
      ],
      { priceMin: 250, priceMax: 500 },
    );
    assert.deepEqual(result.map((s) => s.symbol), ["MID"]);
  });

  it("default sort = absDayMove DESC (so a -10% and a +5% both surface, -10% first)", () => {
    const result = selectDayMovers([
      dm({ symbol: "UP_5", dayMovePct: 5 }),
      dm({ symbol: "DOWN_10", dayMovePct: -10 }),
      dm({ symbol: "UP_4", dayMovePct: 4 }),
    ]);
    assert.deepEqual(result.map((s) => s.symbol), ["DOWN_10", "UP_5", "UP_4"]);
  });

  it("signedDayMove sort places largest gainers first, biggest losers last", () => {
    const result = selectDayMovers(
      [
        dm({ symbol: "UP_5", dayMovePct: 5 }),
        dm({ symbol: "DOWN_10", dayMovePct: -10 }),
        dm({ symbol: "UP_15", dayMovePct: 15 }),
      ],
      { sortBy: "signedDayMove" },
    );
    assert.deepEqual(result.map((s) => s.symbol), ["UP_15", "UP_5", "DOWN_10"]);
  });

  it("rvol sort ranks by volume", () => {
    const result = selectDayMovers(
      [
        dm({ symbol: "A", dayMovePct: 5, rvol: 1.2 }),
        dm({ symbol: "SPIKE", dayMovePct: 5, rvol: 5.0 }),
        dm({ symbol: "B", dayMovePct: 5, rvol: 2.0 }),
      ],
      { sortBy: "rvol" },
    );
    assert.deepEqual(result.map((s) => s.symbol), ["SPIKE", "B", "A"]);
  });

  it("lastCandleVolSpike sort uses the newest candle's multiplier", () => {
    const result = selectDayMovers(
      [
        dm({ symbol: "A", dayMovePct: 5, lastVolMultiplier: 1.2 }),
        dm({ symbol: "SPIKE", dayMovePct: 5, lastVolMultiplier: 4.5 }),
        dm({ symbol: "B", dayMovePct: 5, lastVolMultiplier: 2.0 }),
      ],
      { sortBy: "lastCandleVolSpike" },
    );
    assert.deepEqual(result.map((s) => s.symbol), ["SPIKE", "B", "A"]);
  });

  it("caps at DAY_MOVERS_CAP", () => {
    const many: DayMover[] = [];
    for (let i = 0; i < DAY_MOVERS_CAP + 10; i++) {
      many.push(dm({ symbol: `S_${i}`, dayMovePct: 3 + i * 0.1, rvol: 1.5 }));
    }
    const result = selectDayMovers(many);
    assert.equal(result.length, DAY_MOVERS_CAP);
  });

  it("does not mutate the input array", () => {
    const input = [
      dm({ symbol: "A", dayMovePct: 5 }),
      dm({ symbol: "B", dayMovePct: 8 }),
    ];
    const beforeSyms = input.map((s) => s.symbol);
    selectDayMovers(input);
    assert.deepEqual(input.map((s) => s.symbol), beforeSyms);
  });

  it("RVOL floor for day movers (1.0) is intentionally looser than Volatile (1.5)", () => {
    // Sanity check on the constant — a stock at exactly 1.0 RVOL with a big
    // day move qualifies, while the Volatile lane would reject it.
    assert.equal(DAY_MOVERS_RVOL_FLOOR, 1.0);
    const result = selectDayMovers([
      dm({ symbol: "STILL_OK", dayMovePct: 7, rvol: DAY_MOVERS_RVOL_FLOOR }),
    ]);
    assert.equal(result.length, 1);
  });
});
