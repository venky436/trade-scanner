// GET /api/sections/trend — Trend Structure lane (display only). Fastify inject, no DB, no Kite.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { sectionsRoute } from "./sections.route.js";
import { marketDataService } from "../services/market-data.service.js";
import type { Candle } from "../lib/types.js";

function path(points: number[], per = 4): Candle[] {
  const out: Candle[] = [];
  let prev = points[0]!, t = 1_800_000_000;
  for (let p = 1; p < points.length; p++) {
    const a = points[p - 1]!, b = points[p]!;
    for (let s = 1; s <= per; s++) {
      const close = a + ((b - a) * s) / per;
      out.push({ time: (t += 300), open: prev, high: Math.max(prev, close) + 0.1, low: Math.min(prev, close) - 0.1, close, volume: 1000 });
      prev = close;
    }
  }
  return out;
}
const SESSIONS: Record<string, Candle[]> = {
  STRONGUP: path([103, 100, 104, 102, 106, 104, 108, 106, 109]), // 5 agreeing swings
  SHORTUP: path([103, 100, 104, 102, 105, 103.5, 106]), // 3 agreeing swings
  CLEANDOWN: path([97, 100, 96, 98, 94, 96, 92, 94, 91]), // 5 agreeing swings
  CHOPPY: path([103, 100, 104, 101, 103, 99, 105, 102]), // mixed → not listed
  NOWHERE: path([103, 100, 101.6, 100.1, 101.75, 100.2, 101.9, 100.35, 100.8]), // many higher highs/lows but < 1 % net → only EARLY
  "NIFTY 50": path([103, 100, 104, 102, 106, 104, 108, 106, 109]), // an index → skipped
};

async function call(limit?: number) {
  const app = Fastify();
  await app.register(sectionsRoute, {
    getCachedLevels: () => ({}),
    getPressure: () => null,
    getMomentum: () => null,
    getRecentCandles: () => [],
    getAllSymbols: () => Object.keys(SESSIONS),
    getSessionCandles: (s) => SESSIONS[s] ?? [],
  });
  for (const [s, cs] of Object.entries(SESSIONS)) marketDataService.updateQuote(s, { lastPrice: cs.at(-1)!.close, open: cs[0]!.open, high: 0, low: 0, close: 100, volume: 1, timestamp: 0 });
  const res = await app.inject({ method: "GET", url: `/api/sections/trend${limit ? `?limit=${limit}` : ""}` });
  await app.close();
  return res.json() as { stocks: { symbol: string; trend: string; steps: number; sequence: string[] }[]; meta: { poolSize: number; upCount: number; downCount: number } };
}

describe("GET /api/sections/trend", () => {
  it("lists clear up and down trends, skips choppy stocks and indices", async () => {
    const r = await call();
    const syms = r.stocks.map((s) => s.symbol);
    assert.ok(syms.includes("STRONGUP") && syms.includes("CLEANDOWN") && syms.includes("SHORTUP"));
    assert.ok(!syms.includes("CHOPPY"));
    const nowhere = (r.stocks as unknown as { symbol: string; stage: string }[]).find((s) => s.symbol === "NOWHERE");
    assert.equal(nowhere?.stage, "EARLY", "moved < 1 % → not confirmed, shown as early");
    assert.ok(!syms.includes("NIFTY 50"));
    assert.equal(r.stocks.find((s) => s.symbol === "CLEANDOWN")!.trend, "DOWN");
    assert.equal(r.meta.poolSize, 5);
  });
  it("confirmed trends first, then early ones; each ranked by move; shows the sequence", async () => {
    const r = await call();
    const xs = r.stocks as unknown as { stage: string; movePct: number }[];
    const firstEarly = xs.findIndex((s) => s.stage === "EARLY");
    assert.ok(firstEarly === -1 || xs.slice(firstEarly).every((s) => s.stage === "EARLY"), "no confirmed after an early one");
    const conf = xs.filter((s) => s.stage === "CONFIRMED").map((s) => s.movePct);
    assert.deepEqual(conf, [...conf].sort((a, b) => b - a));
    assert.ok(conf.every((m) => m >= 1));
    assert.deepEqual(r.stocks.find((s) => s.symbol === "STRONGUP")!.sequence, ["HL", "HH", "HL", "HH", "HL"]);
  });
  it("respects the limit", async () => {
    const r = await call(1);
    assert.equal(r.stocks.length, 1);
  });
});

describe("GET /api/sections/trend-map (flags for every stock)", () => {
  it("gives a trend read per trending stock, nothing for choppy stocks or indices", async () => {
    const app = Fastify();
    await app.register(sectionsRoute, {
      getCachedLevels: () => ({}), getPressure: () => null, getMomentum: () => null, getRecentCandles: () => [],
      getAllSymbols: () => Object.keys(SESSIONS), getSessionCandles: (s) => SESSIONS[s] ?? [],
    });
    for (const [s, cs] of Object.entries(SESSIONS)) marketDataService.updateQuote(s, { lastPrice: cs.at(-1)!.close, open: cs[0]!.open, high: 0, low: 0, close: 100, volume: 1, timestamp: 0 });
    const r = (await app.inject({ method: "GET", url: "/api/sections/trend-map" })).json() as { trends: Record<string, { trend: string; stage: string; sequence: string[] }>; patterns: Record<string, unknown> };
    assert.deepEqual(r.patterns, {}, "no day lines given → no pattern notes");
    await app.close();
    assert.equal(r.trends.STRONGUP?.trend, "UP");
    assert.equal(r.trends.STRONGUP?.stage, "CONFIRMED");
    assert.ok(r.trends.STRONGUP!.sequence.length <= 4);
    assert.equal(r.trends.CLEANDOWN?.trend, "DOWN");
    assert.equal(r.trends.CHOPPY, undefined);
    assert.equal(r.trends["NIFTY 50"], undefined);
  });
});
