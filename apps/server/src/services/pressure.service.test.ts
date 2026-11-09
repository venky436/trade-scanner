// Pressure engine on 5-MINUTE clock-aligned candles.
// Run: npx tsx --test src/services/pressure.service.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPressureEngine, PRESSURE_CANDLE_MS } from "./pressure.service.js";
import { createCandleTracker } from "./candle-tracker.service.js";

const FIVE = PRESSURE_CANDLE_MS; // 300 000 ms
const SEC = 1000;
const T0 = 5_666_667 * FIVE; // exactly on a 5-min boundary

type Engine = ReturnType<typeof createPressureEngine>;
const tick = (e: Engine, s: string, t: number, price: number, volume: number) =>
  e.processTick(s, { last_price: price, volume, timestamp: t });
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** 10 ticks inside candle #idx, price moving `dir`, 100 qty each. */
function feedCandle(e: Engine, s: string, idx: number, dir: 1 | -1 | 0, st: { price: number; vol: number }) {
  for (let k = 0; k < 10; k++) {
    st.price += dir * 0.05;
    st.vol += 100;
    tick(e, s, T0 + idx * FIVE + k * 25 * SEC, st.price, st.vol);
  }
  return st;
}
/** First tick just before T0 → that slot is the discarded partial candle. */
function start(e: Engine, s: string, price = 100, vol = 10_000) {
  tick(e, s, T0 - SEC, price, vol);
  return { price, vol };
}

describe("pressure engine — 5-min clock-aligned candles", () => {
  it("discards the partial first candle and closes exactly on the 5-min boundary", () => {
    const e = createPressureEngine();
    tick(e, "RELIANCE", T0 + 250 * SEC, 100, 10_000); // joined 4m10s into a candle
    tick(e, "RELIANCE", T0 + 280 * SEC, 100.1, 10_500);
    tick(e, "RELIANCE", T0 + FIVE, 100.2, 10_600); // closes the partial → not scored
    assert.equal(e.getVersion("RELIANCE"), 0);
    assert.deepEqual(e.getRecentCandles("RELIANCE"), []);
    tick(e, "RELIANCE", T0 + 2 * FIVE - 1, 100.3, 10_800); // still same slot
    assert.equal(e.getVersion("RELIANCE"), 0);
    tick(e, "RELIANCE", T0 + 2 * FIVE, 100.4, 10_900); // boundary → closes
    assert.equal(e.getVersion("RELIANCE"), 1);
    const [c] = e.getRecentCandles("RELIANCE");
    assert.equal(c!.time, (T0 + FIVE) / 1000);
    assert.equal(c!.buyerVolume, 300); // +100 and +200, both up-ticks; partial slot's +500 discarded
    assert.equal(c!.bias, "BUY");
  });

  it("worked example: per-candle scores, 5-min volume baseline, final STRONG_BUY", () => {
    const e = createPressureEngine();
    start(e, "TCS");
    tick(e, "TCS", T0, 100.0, 10_000);
    tick(e, "TCS", T0 + 60 * SEC, 100.1, 10_500); //  ▲ +500
    tick(e, "TCS", T0 + 120 * SEC, 100.05, 10_700); // ▼ +200
    tick(e, "TCS", T0 + 180 * SEC, 100.05, 10_800); // = +100
    tick(e, "TCS", T0 + 240 * SEC, 100.2, 11_400); //  ▲ +600
    tick(e, "TCS", T0 + 270 * SEC, 100.15, 11_500); // ▼ +100
    tick(e, "TCS", T0 + FIVE, 100.3, 11_500); //        close candle 0
    let cs = e.getRecentCandles("TCS");
    assert.equal(cs[0]!.delta, 800);
    assert.equal(cs[0]!.volume, 1500);
    assert.equal(cs[0]!.volumeStrength, 1);
    assert.ok(close(cs[0]!.score, 0.7));

    tick(e, "TCS", T0 + FIVE + 60 * SEC, 100.4, 11_800); //  ▲ +300
    tick(e, "TCS", T0 + FIVE + 120 * SEC, 100.35, 12_000); // ▼ +200
    tick(e, "TCS", T0 + 2 * FIVE, 100.35, 12_000);
    cs = e.getRecentCandles("TCS");
    assert.ok(close(cs[1]!.volumeStrength, 0.5)); // (1500+500)/2 = 1000 avg
    assert.ok(close(cs[1]!.score, 0.29));
    // 2 candles are enough since 2026-11-09: (0.7×0.3 + 0.29×0.7) × 1.15 ≈ 0.475 → BUY
    assert.ok(close(e.getPressure("TCS")!.value, (0.7 * 0.3 + 0.29 * 0.7) * 1.15));
    assert.equal(e.getPressure("TCS")!.signal, "BUY");

    tick(e, "TCS", T0 + 2 * FIVE + 60 * SEC, 100.5, 12_400); // ▲ +400
    tick(e, "TCS", T0 + 3 * FIVE, 100.5, 12_400);
    cs = e.getRecentCandles("TCS");
    assert.ok(close(cs[2]!.score, 0.85)); // 400 / 800 avg → 0.5
    const p = e.getPressure("TCS")!;
    // only the last 2 candles count: (0.29×0.3 + 0.85×0.7) × 1.15 ≈ 0.784
    assert.ok(close(p.value, (0.29 * 0.3 + 0.85 * 0.7) * 1.15));
    assert.equal(p.signal, "STRONG_BUY");
    assert.equal(p.trend, "rising");
  });

  it("a slot with no ticks at all still counts in the volume baseline", () => {
    const e = createPressureEngine();
    start(e, "HDFCBANK");
    tick(e, "HDFCBANK", T0, 100, 10_000);
    tick(e, "HDFCBANK", T0 + 60 * SEC, 100.1, 10_600); // +600 in slot 0
    tick(e, "HDFCBANK", T0 + 2 * FIVE + 60 * SEC, 100.2, 10_800); // closes slot 0; +200 in slot 2
    tick(e, "HDFCBANK", T0 + 3 * FIVE, 100.2, 10_800);
    const cs = e.getRecentCandles("HDFCBANK");
    assert.deepEqual(cs.map((c) => c.time), [T0 / 1000, (T0 + 2 * FIVE) / 1000]);
    assert.ok(close(cs[1]!.volumeStrength, 0.75)); // (600+200)/3 slots
  });

  it("null until 2 full candles, keeps the last 3 for display, version counts scored closes", () => {
    const e = createPressureEngine();
    const st = start(e, "INFY");
    for (let i = 0; i <= 1; i++) feedCandle(e, "INFY", i, 1, st); // 1 scored candle
    assert.equal(e.getPressure("INFY"), null);
    feedCandle(e, "INFY", 2, 1, st); // 2nd scored candle → ready
    assert.notEqual(e.getPressure("INFY"), null);
    assert.equal(e.getVersion("INFY"), 2);
    feedCandle(e, "INFY", 3, 1, st);
    feedCandle(e, "INFY", 4, 1, st);
    assert.equal(e.getRecentCandles("INFY").length, 3);
  });

  it("only the last 2 candles decide: a strong old buying candle can't outvote 2 selling ones", () => {
    const e = createPressureEngine();
    const st = start(e, "SBIN");
    feedCandle(e, "SBIN", 0, 1, st); // buying
    feedCandle(e, "SBIN", 1, -1, st); // closes 0 (buy)
    feedCandle(e, "SBIN", 2, -1, st); // closes 1 (sell)
    feedCandle(e, "SBIN", 3, 1, st); //  closes 2 (sell) → last 2 = sell, sell
    assert.equal(e.getPressure("SBIN")!.signal, "STRONG_SELL");
  });

  it("rising → STRONG_BUY, falling → STRONG_SELL, flat → NEUTRAL", () => {
    const up = createPressureEngine(), dn = createPressureEngine(), fl = createPressureEngine();
    const a = start(up, "A"), b = start(dn, "B"), c = start(fl, "C");
    for (let i = 0; i <= 3; i++) {
      feedCandle(up, "A", i, 1, a);
      feedCandle(dn, "B", i, -1, b);
      feedCandle(fl, "C", i, 0, c);
    }
    assert.equal(up.getPressure("A")!.signal, "STRONG_BUY");
    assert.equal(dn.getPressure("B")!.signal, "STRONG_SELL");
    assert.equal(fl.getPressure("C")!.signal, "NEUTRAL");
    assert.equal(fl.getPressure("C")!.value, 0);
  });

  it("skips indices; getStats / getAllPressure keep their shape", () => {
    const e = createPressureEngine();
    const st = start(e, "NIFTY 50", 22_000, 0);
    for (let i = 0; i <= 3; i++) feedCandle(e, "NIFTY 50", i, 1, st);
    assert.equal(e.getPressure("NIFTY 50"), null);
    assert.equal(e.getStats()["NIFTY 50"], undefined);
    const s2 = start(e, "SBIN");
    for (let i = 0; i <= 3; i++) feedCandle(e, "SBIN", i, 1, s2);
    const stats = e.getStats()["SBIN"]!;
    assert.equal(stats.candleScores.length, 3);
    assert.ok(stats.ticksSeen > 0 && stats.totalVolume > 0);
    assert.ok("SBIN" in e.getAllPressure());
  });

  it("same ticks → same 5-min slots and volume as the candle tracker", () => {
    const e = createPressureEngine();
    const tracker = createCandleTracker({ onCandleClose: () => {} });
    const both = (t: number, price: number, vol: number) => {
      tick(e, "LT", t, price, vol);
      tracker.processTick("LT", price, vol, t);
    };
    const now = Math.floor(Date.now() / FIVE) * FIVE; // tracker resets by IST date → use "today"
    both(now - 3 * FIVE + 200 * SEC, 100, 1_000);
    both(now - 2 * FIVE + 3 * SEC, 101, 1_200);
    both(now - 2 * FIVE + 120 * SEC, 102, 1_500);
    both(now - FIVE + 7 * SEC, 101, 1_700);
    both(now + 2 * SEC, 103, 2_000);
    const price = tracker.getSessionCandles("LT");
    const pressure = e.getRecentCandles("LT");
    // tracker keeps the partial first slot; pressure deliberately drops it
    assert.deepEqual(price.slice(1).map((c) => Math.floor(c.time / 300)), pressure.map((c) => c.time / 300));
    assert.deepEqual(price.slice(1).map((c) => c.volume), pressure.map((c) => c.volume));
  });
});
