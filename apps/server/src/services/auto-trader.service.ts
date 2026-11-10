/**
 * AUTO-TRADER — places PAPER trades by itself when a setup is strong enough.
 *
 * Every few seconds it reads the same "ready" setups the Trade screen shows
 * (lib/trade-setups.ts) and, for each one:
 *
 *   a READY setup (09:30–14:00, volume ≥ 1.2× — see lib/trade-setups.ts)
 *   confidence ≥ 90% + a trade plan (stop-loss + target)
 *   → no active trade on that stock
 *   → fewer than 5 trades active right now (any trade, manual or auto)
 *   → stock not traded in the last 30 min (no instant re-entry after an exit)
 *   → place a FIXED-RISK quantity (2026-11-10): shares = ₹500 ÷ (entry − SL),
 *     so a stop-loss hit loses ≈ ₹500 whatever the stock's price; capped to
 *     what the (paper) margin allows. riskPerTrade 0 → fixed `quantity`.
 *
 * When 5 trades are active it waits; as soon as one closes, the next strong
 * setup can be taken. Placing goes through orderExecution.placeTrade, so all
 * the normal checks still apply (09:15–entry cutoff, SL/target sides, margin).
 *
 * SAFETY: it only ever trades in PAPER mode. While the navbar switch is on
 * Real it does nothing — real money is never auto-traded.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { IntelligenceSnapshot } from "../lib/types.js";

export const AUTO_SETUP_PREFIX = "AUTO:";

/** Shares so that a stop-loss hit loses ≈ `risk` ₹: floor(risk ÷ |entry − stopLoss|), 0 if invalid. */
export function riskQuantity(risk: number, entry: number, stopLoss: number): number {
  const perShare = Math.abs(entry - stopLoss);
  if (!(risk > 0) || !(perShare > 0) || !Number.isFinite(perShare)) return 0;
  return Math.floor(risk / perShare);
}

export interface AutoTraderConfig {
  minConfidence: number; // 0..1
  maxActive: number;
  quantity: number; // used only when riskPerTrade is 0
  riskPerTrade: number; // ₹ lost if the stop-loss is hit (0 = use `quantity`)
  cooldownMs: number;
  intervalMs: number;
}

export const DEFAULT_AUTO_CONFIG: AutoTraderConfig = {
  minConfidence: 0.9,
  maxActive: 5, // raised from 3 (2026-11-10, user)
  quantity: 100,
  riskPerTrade: 500, // 1 % of a ₹50,000 account (user, 2026-11-10)
  cooldownMs: 30 * 60_000,
  intervalMs: 5_000,
};

/** The bits of a trade row the auto-trader needs. */
export interface AutoTradeRow {
  id: number;
  symbol: string;
  status: string;
  createdAt: Date | string;
  closedAt: Date | string | null;
}

export interface AutoTraderDeps {
  getMode: () => "PAPER" | "LIVE";
  getUserId: () => Promise<string | null>;
  getReadySetups: () => IntelligenceSnapshot[];
  /** Call window (e.g. 09:30–14:00) — only used for the status message. */
  callWindow?: { isOpen: () => boolean; label: string };
  /** Today's trades for the user (all modes). */
  getTodayTrades: (userId: string) => Promise<AutoTradeRow[]>;
  placeTrade: (
    userId: string,
    input: { symbol: string; side: "BUY" | "SELL"; quantity: number; stopLoss: number; target: number; setup: string; confidence: number },
  ) => Promise<{ id: number }>;
  /** Most shares the account's margin allows for this order (fixed-risk sizing is capped to it). */
  getMaxQuantity?: (symbol: string, side: "BUY" | "SELL") => Promise<number>;
  now?: () => number;
  /** Where the on/off switch is remembered across restarts (null = memory only). */
  stateFile?: string | null;
  config?: Partial<AutoTraderConfig>;
}

export interface AutoActivity {
  at: number;
  symbol: string;
  action: "PLACED" | "FAILED";
  message: string;
}

const ACTIVE = new Set(["PENDING", "ENTRY_PLACED", "OPEN", "EXITING", "UNPROTECTED"]);
const ms = (d: Date | string | null) => (d == null ? 0 : new Date(d).getTime());

export function createAutoTrader(deps: AutoTraderDeps) {
  const cfg: AutoTraderConfig = { ...DEFAULT_AUTO_CONFIG, ...deps.config };
  const now = () => deps.now?.() ?? Date.now();
  const activity: AutoActivity[] = [];
  /** symbol → last time WE tried it (covers failures too, so we don't spam). */
  const lastAttempt = new Map<string, number>();
  let enabled = readEnabled();
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastRunAt = 0;
  let lastNote = "";

  function readEnabled(): boolean {
    if (!deps.stateFile) return true;
    try {
      if (existsSync(deps.stateFile)) return JSON.parse(readFileSync(deps.stateFile, "utf8")).enabled !== false;
    } catch {
      /* default */
    }
    return true; // ON by default (paper only)
  }
  function saveEnabled() {
    if (!deps.stateFile) return;
    try {
      mkdirSync(dirname(deps.stateFile), { recursive: true });
      writeFileSync(deps.stateFile, JSON.stringify({ enabled }));
    } catch (e) {
      console.error("[Auto] could not save state:", (e as Error).message);
    }
  }
  function log(symbol: string, action: AutoActivity["action"], message: string) {
    activity.unshift({ at: now(), symbol, action, message });
    activity.length = Math.min(activity.length, 50);
    console.log(`[Auto] ${action} ${symbol}: ${message}`);
  }

  /** One pass. Returns the trade ids placed (for tests). */
  async function runOnce(): Promise<number[]> {
    if (running) return [];
    running = true;
    lastRunAt = now();
    const placed: number[] = [];
    try {
      if (!enabled) return (lastNote = "Switched off"), placed;
      if (deps.getMode() !== "PAPER") return (lastNote = "Off — the server is in LIVE mode (auto trades paper only)"), placed;
      const userId = await deps.getUserId();
      if (!userId) return (lastNote = "No admin user found"), placed;

      if (deps.callWindow && !deps.callWindow.isOpen()) return (lastNote = `Outside the call window (${deps.callWindow.label} IST) — no new calls`), placed;
      const candidates = deps
        .getReadySetups()
        .filter((s) => s.tradePlan && s.confidence >= cfg.minConfidence)
        .sort((a, b) => b.confidence - a.confidence);
      if (candidates.length === 0) return (lastNote = `Watching — no setup at ${Math.round(cfg.minConfidence * 100)}%+ confidence`), placed;

      const trades = await deps.getTodayTrades(userId);
      const activeSymbols = new Set(trades.filter((t) => ACTIVE.has(t.status)).map((t) => t.symbol));
      let slots = cfg.maxActive - activeSymbols.size;
      if (slots <= 0) return (lastNote = `${activeSymbols.size} trades active (max ${cfg.maxActive}) — waiting for one to close`), placed;

      const t = now();
      const lastTouched = (sym: string) =>
        Math.max(lastAttempt.get(sym) ?? 0, ...trades.filter((x) => x.symbol === sym).map((x) => Math.max(ms(x.createdAt), ms(x.closedAt))));

      for (const s of candidates) {
        if (slots <= 0) break;
        if (activeSymbols.has(s.symbol)) continue;
        if (t - lastTouched(s.symbol) < cfg.cooldownMs) continue;
        const plan = s.tradePlan!;
        lastAttempt.set(s.symbol, t);
        let quantity = cfg.riskPerTrade > 0 ? riskQuantity(cfg.riskPerTrade, plan.entry, plan.stopLoss) : cfg.quantity;
        if (cfg.riskPerTrade > 0 && deps.getMaxQuantity) {
          try {
            quantity = Math.min(quantity, await deps.getMaxQuantity(s.symbol, plan.action));
          } catch {
            /* margin check failed — placeTrade still checks margin itself */
          }
        }
        if (!(quantity >= 1)) {
          log(s.symbol, "FAILED", `Skipped — quantity 0 (risk ₹${cfg.riskPerTrade}, SL ${plan.stopLoss}, entry ${plan.entry} — or no margin)`);
          continue;
        }
        try {
          const trade = await deps.placeTrade(userId, {
            symbol: s.symbol,
            side: plan.action,
            quantity,
            stopLoss: plan.stopLoss,
            target: plan.target,
            setup: `${AUTO_SETUP_PREFIX}${s.outlook}`.slice(0, 30),
            confidence: s.confidence,
          });
          placed.push(trade.id);
          activeSymbols.add(s.symbol);
          slots--;
          log(s.symbol, "PLACED", `${plan.action} ${quantity} · ${Math.round(s.confidence * 100)}% · SL ${plan.stopLoss} · target ${plan.target} (trade #${trade.id})`);
        } catch (e) {
          log(s.symbol, "FAILED", (e as Error).message);
        }
      }
      lastNote = placed.length ? `Placed ${placed.length} trade(s)` : `Watching — ${activeSymbols.size}/${cfg.maxActive} active`;
      return placed;
    } catch (e) {
      lastNote = `Error: ${(e as Error).message}`;
      console.error("[Auto] run failed:", (e as Error).message);
      return placed;
    } finally {
      running = false;
    }
  }

  return {
    runOnce,
    start() {
      if (timer) return;
      timer = setInterval(() => void runOnce(), cfg.intervalMs);
      timer.unref?.();
      console.log(`[Auto] started — ${enabled ? "ON" : "OFF"}, paper only, ≥${Math.round(cfg.minConfidence * 100)}%, max ${cfg.maxActive} active, ${cfg.riskPerTrade > 0 ? `₹${cfg.riskPerTrade} risk per trade` : `${cfg.quantity} qty`}`);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    setEnabled(on: boolean) {
      enabled = on;
      saveEnabled();
      console.log(`[Auto] switched ${on ? "ON" : "OFF"}`);
      return this.status();
    },
    status() {
      const mode = deps.getMode();
      return {
        enabled,
        active: enabled && mode === "PAPER",
        mode,
        minConfidence: cfg.minConfidence,
        maxActive: cfg.maxActive,
        quantity: cfg.quantity,
        riskPerTrade: cfg.riskPerTrade,
        cooldownMinutes: Math.round(cfg.cooldownMs / 60_000),
        lastRunAt,
        note: lastNote,
        activity: activity.slice(0, 20),
      };
    },
  };
}

export type AutoTrader = ReturnType<typeof createAutoTrader>;
