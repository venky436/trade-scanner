// Smart zones service — fake Zerodha, temp file, fixed clock. No network, no DB.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSmartZonesService, type ZoneKite } from "./smart-zones.service.js";

const DATE = "2026-11-20"; // Friday
const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`).getTime();
const row = (date: string, i: number, o: number, h: number, l: number, c: number, v: number) => ({ date: new Date(ist(date, "09:15") + i * 300_000), open: o, high: h, low: l, close: c, volume: v });
const quiet = (date: string, n: number, p = 110) => Array.from({ length: n }, (_, i) => row(date, i, p, p + 0.2, p - 0.2, p, 1000));

// Today: a clean fall 110 → 100 over 10 candles (bottom 99.9 at 10:00), then a bullish FVG
// 10:05 / 10:10 / 10:15 (candle 1 low 99.95, candle 3 close 101.8), then a slow climb to 103.
function today(stopHit = false) {
  const rows = Array.from({ length: 10 }, (_, k) => row(DATE, k, 110 - k, 110.1 - k, 108.9 - k, 109 - k, 1000));
  rows.push(row(DATE, 10, 100, 100.3, 99.95, 100.2, 1000)); // c1
  rows.push(row(DATE, 11, 100.2, 101.6, 100.1, 101.5, 5000)); // c2
  rows.push(row(DATE, 12, 101.5, 102, 101, 101.8, 2000)); // c3 → entry 101.8
  if (stopHit) rows.push(row(DATE, 13, 101.8, 101.9, 99.5, 99.7, 3000)); // falls through 99.95
  for (let i = rows.length; i < 75; i++) rows.push(row(DATE, i, 102.5, 103.1, 102.4, 103, 1000));
  return rows;
}

function fakeKite(stopHit = false) {
  const calls = { history: 0, today: 0 };
  const kite: ZoneKite = {
    async getHistoricalData(_t, _i, from) {
      if (from.startsWith(DATE)) {
        calls.today++;
        return today(stopHit);
      }
      calls.history++;
      return quiet("2026-11-19", 75);
    },
  };
  return { kite, calls };
}

let dir = "";
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "zones-"))));
const make = (kite: ZoneKite | null, clock: { t: number }) =>
  createSmartZonesService({ getKite: () => kite, getStocks: () => [{ symbol: "ABC", token: 1 }], file: join(dir, "z.json"), now: () => clock.t, sleep: async () => {}, requestGapMs: 0 });

describe("smart zones service — reversal / trend setups", () => {
  it("REVERSAL BUY after a clear fall: entry = candle 3 close, stop = candle 1 LOW, in trade → closed at 15:25", async () => {
    const { kite, calls } = fakeKite();
    const clock = { t: ist(DATE, "09:30") };
    const svc = make(kite, clock);
    await svc.tick();
    assert.equal(svc.getState().status, "WAITING");
    assert.equal(calls.today, 0);

    clock.t = ist(DATE, "10:20") + 25_000; // candle 3 (10:15) has just closed
    await svc.tick();
    const z = svc.getState().zones.find((x) => x.type === "FVG" && x.side === "BUY")!;
    assert.ok(z, "the reversal BUY is listed");
    assert.equal(z.kind, "REVERSAL");
    assert.equal(z.entry, 101.8);
    assert.equal(z.stop, 99.95, "candle 1's low");
    assert.equal(z.move.from, 110.1);
    assert.equal(z.move.to, 99.9);
    assert.equal(z.status, "IN_TRADE");
    assert.ok(existsSync(join(dir, "z.json")));

    clock.t = ist(DATE, "15:30") + 25_000;
    await svc.tick(); // past the last scan → keeps the list
    clock.t = ist(DATE, "15:25") + 25_000;
    const late = make(kite, clock);
    await late.tick();
    const done = late.getState().zones.find((x) => x.id === z.id)!;
    assert.equal(done.status, "CLOSED");
    assert.ok(done.resultPct! > 0);
    assert.equal(calls.history, 2, "history fetched once per service per day");
  });

  it("price through candle 1's low → STOPPED", async () => {
    const svc = make(fakeKite(true).kite, { t: ist(DATE, "10:30") + 25_000 });
    await svc.tick();
    const z = svc.getState().zones.find((x) => x.type === "FVG" && x.side === "BUY")!;
    assert.equal(z.status, "STOPPED");
    assert.ok(z.resultPct! < 0);
  });

  it("one scan per 5-min slot; a restart reloads the saved list; weekend → NO_SESSION; no login → WAITING_LOGIN", async () => {
    const { kite, calls } = fakeKite();
    const clock = { t: ist(DATE, "10:20") + 25_000 };
    const svc = make(kite, clock);
    await svc.tick();
    clock.t += 60_000;
    await svc.tick();
    assert.equal(calls.today, 1);
    assert.ok(make(null, clock).getState().zones.length > 0);
    const sat = make(kite, { t: ist("2026-11-21", "10:00") });
    await sat.tick();
    assert.equal(sat.getState().status, "NO_SESSION");
    const off = make(null, { t: ist("2026-11-23", "10:00") });
    await off.tick();
    assert.equal(off.getState().status, "WAITING_LOGIN");
  });
});
