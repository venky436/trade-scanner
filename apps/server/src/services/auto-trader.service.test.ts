// Auto-trader rules — pure unit tests (fake setups + fake placeTrade, NO database).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAutoTrader, riskQuantity, type AutoTradeRow, type AutoTraderConfig } from "./auto-trader.service.js";
import type { IntelligenceSnapshot } from "../lib/types.js";

const NOW = 1_800_000_000_000;
function setup(symbol: string, confidence: number, action: "BUY" | "SELL" = "BUY"): IntelligenceSnapshot {
  return {
    symbol,
    confidence,
    outlook: action === "BUY" ? "BOUNCE_EXPECTED" : "REJECTION_POSSIBLE",
    tradePlan: { action, entry: 100, stopLoss: action === "BUY" ? 98 : 102, target: action === "BUY" ? 104 : 96, riskPercent: 2, rewardPercent: 4, riskReward: 2, atr: 1 },
  } as unknown as IntelligenceSnapshot;
}

function harness(opts: {
  setups: IntelligenceSnapshot[];
  trades?: AutoTradeRow[];
  mode?: "PAPER" | "LIVE";
  fail?: Set<string>;
  maxQty?: number;
  config?: Partial<AutoTraderConfig>;
}) {
  const trades: AutoTradeRow[] = [...(opts.trades ?? [])];
  const placed: { symbol: string; side: string; quantity: number; stopLoss: number; target: number; setup: string }[] = [];
  let clock = NOW;
  let nextId = 100;
  const auto = createAutoTrader({
    getMode: () => opts.mode ?? "PAPER",
    getUserId: async () => "admin",
    getReadySetups: () => opts.setups,
    getTodayTrades: async () => trades,
    placeTrade: async (_u, input) => {
      if (opts.fail?.has(input.symbol)) throw new Error("Not enough margin");
      placed.push(input);
      const id = nextId++;
      trades.push({ id, symbol: input.symbol, status: "OPEN", createdAt: new Date(clock), closedAt: null });
      return { id };
    },
    now: () => clock,
    stateFile: null,
    ...(opts.maxQty != null ? { getMaxQuantity: async () => opts.maxQty! } : {}),
    ...(opts.config ? { config: opts.config } : {}),
  });
  return { auto, placed, trades, tick: (msAdd: number) => (clock += msAdd) };
}

describe("auto-trader — fixed-risk sizing", () => {
  it("riskQuantity = floor(risk ÷ |entry − SL|)", () => {
    assert.equal(riskQuantity(500, 100, 98), 250);
    assert.equal(riskQuantity(500, 1000, 1007), 71); // SELL: ₹7 risk per share
    assert.equal(riskQuantity(500, 2500, 2400), 5);
    assert.equal(riskQuantity(500, 100, 100), 0); // no risk distance → invalid
    assert.equal(riskQuantity(0, 100, 98), 0);
  });
  it("caps the quantity to what the margin allows", async () => {
    const h = harness({ setups: [setup("AAA", 0.95)], maxQty: 120 });
    await h.auto.runOnce();
    assert.equal(h.placed[0]!.quantity, 120);
  });
  it("skips (no order) when the margin allows 0 shares", async () => {
    const h = harness({ setups: [setup("AAA", 0.95)], maxQty: 0 });
    await h.auto.runOnce();
    assert.equal(h.placed.length, 0);
    assert.match(h.auto.status().activity[0]!.message, /Skipped/);
  });
  it("riskPerTrade 0 → the old fixed quantity", async () => {
    const h = harness({ setups: [setup("AAA", 0.95)], config: { riskPerTrade: 0, quantity: 100 } });
    await h.auto.runOnce();
    assert.equal(h.placed[0]!.quantity, 100);
  });
  it("status shows the risk per trade", () => {
    const h = harness({ setups: [] });
    assert.equal(h.auto.status().riskPerTrade, 500);
  });
});

describe("auto-trader", () => {
  it("only takes setups at 90%+ confidence, ₹500-risk quantity, plan's SL and target", async () => {
    const h = harness({ setups: [setup("AAA", 0.95), setup("BBB", 0.89), setup("CCC", 0.9, "SELL")] });
    await h.auto.runOnce();
    assert.deepEqual(h.placed.map((p) => p.symbol), ["AAA", "CCC"]);
    // entry 100, SL 98 (BUY) / 102 (SELL) → ₹2 risk per share → ₹500 ÷ 2 = 250 shares
    assert.ok(h.placed.every((p) => p.quantity === 250));
    assert.deepEqual([h.placed[1]!.side, h.placed[1]!.stopLoss, h.placed[1]!.target], ["SELL", 102, 96]);
    assert.equal(h.placed[0]!.setup, "AUTO:BOUNCE_EXPECTED");
  });

  it("max 5 active: stops at 5, takes the next one only after one closes", async () => {
    const h = harness({ setups: ["A", "B", "C", "D", "E", "F", "G"].map((s, i) => setup(s, 0.99 - i * 0.01)) });
    await h.auto.runOnce();
    assert.deepEqual(h.placed.map((p) => p.symbol), ["A", "B", "C", "D", "E"]);
    await h.auto.runOnce();
    assert.equal(h.placed.length, 5, "still 5 active → nothing new");
    assert.match(h.auto.status().note, /waiting for one to close/);
    h.trades[1]!.status = "CLOSED";
    h.trades[1]!.closedAt = new Date(NOW);
    await h.auto.runOnce();
    assert.deepEqual(h.placed.map((p) => p.symbol), ["A", "B", "C", "D", "E", "F"], "one slot freed → exactly one more");
  });

  it("manual trades count toward the 5", async () => {
    const open = (id: number, symbol: string): AutoTradeRow => ({ id, symbol, status: "OPEN", createdAt: new Date(NOW - 3_600_000), closedAt: null });
    const h = harness({ setups: [setup("X", 0.95), setup("Y", 0.94)], trades: [open(1, "M1"), open(2, "M2"), open(3, "M3"), open(4, "M4")] });
    await h.auto.runOnce();
    assert.deepEqual(h.placed.map((p) => p.symbol), ["X"]);
  });

  it("no re-entry on a stock within 30 min of its last trade", async () => {
    const h = harness({
      setups: [setup("AAA", 0.95)],
      trades: [{ id: 1, symbol: "AAA", status: "CLOSED", createdAt: new Date(NOW - 20 * 60_000), closedAt: new Date(NOW - 10 * 60_000) }],
    });
    await h.auto.runOnce();
    assert.equal(h.placed.length, 0);
    h.tick(21 * 60_000);
    await h.auto.runOnce();
    assert.equal(h.placed.length, 1);
  });

  it("a failed order is not retried every 5 s (30 min wait) and doesn't use a slot", async () => {
    const h = harness({ setups: [setup("BAD", 0.99), setup("OK", 0.95)], fail: new Set(["BAD"]) });
    await h.auto.runOnce();
    assert.deepEqual(h.placed.map((p) => p.symbol), ["OK"]);
    assert.equal(h.auto.status().activity.find((a) => a.symbol === "BAD")?.action, "FAILED");
    await h.auto.runOnce();
    assert.equal(h.auto.status().activity.filter((a) => a.symbol === "BAD").length, 1, "not retried");
  });

  it("NEVER trades in LIVE mode, and does nothing when switched off", async () => {
    const live = harness({ setups: [setup("AAA", 0.99)], mode: "LIVE" });
    await live.auto.runOnce();
    assert.equal(live.placed.length, 0);
    assert.equal(live.auto.status().active, false);
    const off = harness({ setups: [setup("AAA", 0.99)] });
    off.auto.setEnabled(false);
    await off.auto.runOnce();
    assert.equal(off.placed.length, 0);
  });
});

describe("auto-trader call window", () => {
  it("outside the window: places nothing and says why", async () => {
    const placed: string[] = [];
    const auto = createAutoTrader({
      getMode: () => "PAPER",
      getUserId: async () => "admin",
      getReadySetups: () => [setup("AAA", 0.99)],
      getTodayTrades: async () => [],
      placeTrade: async (_u, i) => (placed.push(i.symbol), { id: 1 }),
      callWindow: { isOpen: () => false, label: "09:30–14:00" },
      stateFile: null,
    });
    await auto.runOnce();
    assert.equal(placed.length, 0);
    assert.match(auto.status().note, /Outside the call window/);
  });
});
