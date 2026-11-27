// Opening movers service — fake Zerodha, temp files, fixed clock. No network, no DB.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpeningMoversService, type OpeningKite } from "./opening-movers.service.js";

const DATE = "2026-11-12"; // a Thursday
const ist = (date: string, hhmmss: string) => new Date(`${date}T${hhmmss}+05:30`).getTime();
const row = (date: string, hhmm: string, close: number, volume: number, open = close) => ({ date: new Date(ist(date, `${hhmm}:00`)), open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume });
const PRIOR = ["2026-11-06", "2026-11-07", "2026-11-10", "2026-11-11"];
// every stock: normal 09:15-candle volume = 500, yesterday's close 100
const history = () => PRIOR.flatMap((d) => [row(d, "09:15", 100, 500), row(d, "09:20", 100, 9_999), row(d, "15:25", 100, 50)]);

// today's first candle per stock: [close, volume]
const TODAY: Record<string, [number, number]> = {
  UPSTOCK: [102, 1250], // BUY, 2.5×
  DOWNSTOCK: [98, 1500], // SELL, 3×
  FLAT: [100, 2000], // closed exactly at yesterday's close → none
  QUIET: [103, 600], // 1.2× → pre-filtered, never fetched
};
const STOCKS = Object.keys(TODAY).map((symbol, i) => ({ symbol, token: 100 + i }));

function fakeKite(opts: { tradedOn?: string; hideFirst?: Set<string> } = {}) {
  const calls = { quote: 0, history: 0, today: [] as string[] };
  const kite: OpeningKite = {
    async getQuote(instruments) {
      calls.quote++;
      const out: Record<string, any> = {};
      for (const k of instruments) {
        const sym = k.slice(4), t = TODAY[sym]!;
        out[k] = { ohlc: { close: 100 }, volume: t[1] + 10, last_trade_time: new Date(ist(opts.tradedOn ?? DATE, "09:20:10")) };
      }
      return out;
    },
    async getHistoricalData(token, _i, from) {
      calls.history++;
      const sym = STOCKS.find((s) => s.token === token)!.symbol;
      if (!from.startsWith(DATE)) return history();
      calls.today.push(sym);
      const t = TODAY[sym]!;
      return opts.hideFirst?.has(sym) ? [] : [row(DATE, "09:15", t[0], t[1], 100)];
    },
  };
  return { kite, calls };
}

let dir = "";
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "opening-"))));
const make = (kite: OpeningKite | null, clock: { t: number }) =>
  createOpeningMoversService({
    getKite: () => kite,
    getStocks: () => STOCKS,
    file: join(dir, "movers.json"),
    baselineFile: join(dir, "baseline.json"),
    now: () => clock.t,
    sleep: async () => {},
    requestGapMs: 0,
  });

describe("opening movers service", () => {
  it("before 09:20 → loads the baseline and waits; at 09:20:20 → BUY / SELL list from the official 09:15 candle", async () => {
    const { kite, calls } = fakeKite();
    const clock = { t: ist(DATE, "09:10:00") };
    const svc = make(kite, clock);
    await svc.tick();
    assert.equal(svc.getState().status, "WAITING");
    assert.ok(existsSync(join(dir, "baseline.json")));
    assert.equal(calls.quote, 0, "nothing fetched for today before 09:20");

    clock.t = ist(DATE, "09:20:10");
    await svc.tick();
    assert.equal(svc.getState().status, "WAITING", "not before 09:20:20");

    clock.t = ist(DATE, "09:20:30");
    await svc.tick();
    const s = svc.getState();
    assert.equal(s.status, "READY");
    assert.deepEqual(s.stocks.map((m) => [m.symbol, m.side]), [["UPSTOCK", "BUY"], ["DOWNSTOCK", "SELL"]]);
    assert.equal(s.stocks[0]!.volumeX, 2.5);
    assert.equal(s.stocks[0]!.movePct, 2);
    assert.equal(s.stocks[0]!.c1.close, 102);
    assert.ok(!calls.today.includes("QUIET"), "low-volume stock pre-filtered by the quote, its candle never fetched");
    assert.ok(calls.today.includes("FLAT") && !s.stocks.some((m) => m.symbol === "FLAT"), "close equal to yesterday → not listed");
  });

  it("an old two-candle baseline saved earlier today is rebuilt, not reused", async () => {
    writeFileSync(join(dir, "baseline.json"), JSON.stringify({ date: DATE, map: { UPSTOCK: { prevClose: 100, normalVolume: 99_999 } } }));
    const { kite, calls } = fakeKite();
    const svc = make(kite, { t: ist(DATE, "09:21:00") });
    await svc.tick();
    assert.ok(calls.history > 0, "baseline refetched");
    assert.ok(svc.getState().stocks.some((m) => m.symbol === "UPSTOCK"), "new 09:15 normal (500) used, not the old 99,999");
  });

  it("frozen for the day: more ticks don't refetch; a restart reloads the saved list without calling Zerodha", async () => {
    const { kite, calls } = fakeKite();
    const clock = { t: ist(DATE, "09:21:00") };
    const svc = make(kite, clock);
    await svc.tick();
    const n = calls.history;
    clock.t = ist(DATE, "11:00:00");
    await svc.tick();
    assert.equal(calls.history, n);

    const after = fakeKite();
    const restarted = make(after.kite, clock);
    await restarted.tick();
    assert.equal(restarted.getState().status, "READY");
    assert.equal(restarted.getState().stocks.length, 2);
    assert.equal(after.calls.history + after.calls.quote, 0);
  });

  it("a 09:15 candle not published yet → waits and retries, then lists it", async () => {
    const hide = new Set(["UPSTOCK"]);
    const { kite } = fakeKite({ hideFirst: hide });
    const clock = { t: ist(DATE, "09:20:25") };
    const svc = make(kite, clock);
    await svc.tick();
    assert.equal(svc.getState().status, "WAITING");
    hide.clear();
    clock.t = ist(DATE, "09:20:50");
    await svc.tick();
    assert.equal(svc.getState().status, "READY");
    assert.ok(svc.getState().stocks.some((m) => m.symbol === "UPSTOCK"));
  });

  it("not connected → WAITING_LOGIN; weekend → NO_SESSION; holiday (no trade today) → NO_SESSION", async () => {
    const clock = { t: ist(DATE, "09:30:00") };
    const off = make(null, clock);
    await off.tick();
    assert.equal(off.getState().status, "WAITING_LOGIN");

    const sat = { t: ist("2026-11-14", "09:30:00") };
    const weekend = make(fakeKite().kite, sat);
    await weekend.tick();
    assert.equal(weekend.getState().status, "NO_SESSION");

    const { kite, calls } = fakeKite({ tradedOn: "2026-11-11" });
    const holiday = make(kite, clock);
    await holiday.tick();
    assert.equal(holiday.getState().status, "NO_SESSION");
    assert.equal(calls.today.length, 0);
  });
});
