/**
 * ORDER EXECUTION — the only place that sends orders to Zerodha.
 *
 * Flow for one trade (LIVE mode):
 *
 *   placeTrade()  → row in `trades` (PENDING)
 *                 → Zerodha: MARKET entry, product MIS (intraday, uses margin)
 *                 → row: ENTRY_PLACED (+ entry_order_id)
 *
 *   Zerodha reports back (WebSocket order_update + a 3 s poll as backup):
 *     entry COMPLETE   → place STOP-LOSS (SL-M) + TARGET (LIMIT) → row: OPEN
 *     entry REJECTED   → row: REJECTED (+ Zerodha's reason)
 *     SL COMPLETE      → cancel target → row: CLOSED (STOP_LOSS) + P&L
 *     target COMPLETE  → cancel SL     → row: CLOSED (TARGET)    + P&L
 *
 *   exitTrade() / 15:15 square-off → cancel SL + target → MARKET exit → CLOSED
 *
 * MODE is a global runtime switch (navbar Paper / Real, POST /api/trade/mode),
 * remembered in data/trade-mode.json. No file yet → PAPER (safe default).
 * There is no .env flag — the switch is the only way to turn real orders on. Switching only changes NEW orders:
 * every existing trade keeps the mode it was placed in and is managed the
 * same way (live trades keep being polled even while in Paper mode).
 *
 * PAPER mode runs the exact same lifecycle
 * without calling Zerodha: entry fills at the live price, SL/target are
 * checked against live ticks every second.
 *
 * Every state change is written to `trade_events`, so you can see exactly
 * what happened to each order.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { KiteConnect, type Connect } from "kiteconnect";
import { and, desc, eq, gte, inArray, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { trades, tradeEvents, type Trade } from "../db/schema/trades.js";
import type { InstrumentMaps } from "../lib/types.js";
import { marketDataService } from "./market-data.service.js";
import { intradayCharges } from "../lib/charges.js";

export type TradeMode = "PAPER" | "LIVE";
export type TradeSide = "BUY" | "SELL";
export type ExitReason = "TARGET" | "STOP_LOSS" | "MANUAL" | "SQUARE_OFF";

/** Trades that still need watching. */
const ACTIVE_STATUSES = ["PENDING", "ENTRY_PLACED", "OPEN", "EXITING", "UNPROTECTED"];
const TERMINAL_ORDER_STATUSES = new Set(["COMPLETE", "CANCELLED", "REJECTED"]);

// Market rules (IST, Monday–Friday; no holiday calendar yet).
// Entry cutoff + square-off come from .env (ENTRY_CUTOFF / SQUARE_OFF_AT).
// Defaults are conservative: Zerodha's own MIS auto square-off happens a few
// minutes before the close and charges a fee — we always exit before that.
const ENTRY_OPEN_MIN = 9 * 60 + 15; // 09:15 — new entries allowed from
const DEFAULT_ENTRY_CUTOFF = "14:45";
const DEFAULT_SQUARE_OFF_AT = "15:00";
const MAX_SQUARE_OFF_ATTEMPTS = 3;
/** A triggered stop-loss still unfilled after this long → exit at market. */
const STUCK_SL_MS = 5_000;

/** "15:00" → 900 (minutes since midnight); invalid → fallback. */
function parseHhMm(value: string | undefined, fallback: string): { minutes: number; label: string } {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value ?? "").trim());
  const src = m ? value!.trim() : fallback;
  const [h, mm] = src.split(":").map(Number);
  return { minutes: h! * 60 + mm!, label: `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}` };
}

/** Expected failure with an HTTP status + a message safe to show the user. */
export class TradeError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface PlaceTradeInput {
  symbol: string;
  side: TradeSide;
  quantity: number;
  stopLoss: number;
  target: number;
  setup?: string | null;
  confidence?: number | null;
}

export interface MarginQuote {
  symbol: string;
  side: TradeSide;
  mode: TradeMode;
  ltp: number;
  tickSize: number;
  marginPerShare: number; // ₹ blocked per share for an MIS order
  leverage: number; // price ÷ margin per share (≈ 5 for most stocks)
  available: number; // ₹ you can use right now
  maxQty: number; // floor(available ÷ marginPerShare)
  estimated: boolean; // true = Zerodha's margin API failed, used 20% of price
}

interface OrderExecutionConfig {
  apiKey: string;
  getAccessToken: () => string | null;
  getInstrumentMaps: () => InstrumentMaps | null;
  paperCapital: number;
  /** Remembers the Paper / Real switch across restarts (unset = memory only). */
  modeFile?: string | null;
  /** "HH:MM" IST — no new entries from this time (default 14:45). */
  entryCutoff?: string;
  /** "HH:MM" IST — close all open trades at this time (default 15:00). */
  squareOffAt?: string;
  /** Test hooks — leave unset in the app. */
  now?: () => Date;
  kiteFactory?: () => Connect;
}

// ── small helpers ────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Kite SDK rejects with plain objects ({ message, error_type }), not Errors. */
function errMsg(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { message?: unknown; error_type?: unknown };
    if (typeof o.message === "string" && o.message) return o.message;
    if (typeof o.error_type === "string") return o.error_type;
  }
  return String(e);
}

/** Minutes since midnight + weekday, in IST (UTC+5:30, no DST). */
function istNow(d = new Date()): { minutes: number; weekday: number; dateKey: string } {
  const ist = new Date(d.getTime() + 330 * 60_000);
  return {
    minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
    weekday: ist.getUTCDay(), // 0 = Sunday
    dateKey: ist.toISOString().slice(0, 10),
  };
}

function isWeekday(weekday: number): boolean {
  return weekday >= 1 && weekday <= 5;
}

function roundToTick(price: number, tick: number): number {
  return Number((Math.round(price / tick) * tick).toFixed(2));
}

const num = (v: string | number | null | undefined): number | null => (v == null ? null : Number(v));

/** DB row → API shape (Postgres numerics come back as strings). */
/**
 * Estimated charges for a CLOSED trade (null when it can't be priced).
 * The DB keeps the exact GROSS P&L from the fills; everything shown or
 * summed (stats, paper balance) uses NET = gross − estimated charges.
 */
function closedCharges(t: Pick<Trade, "status" | "side" | "quantity" | "filledQty" | "entryPrice" | "exitPrice" | "pnl">): number | null {
  if (t.status !== "CLOSED" || t.pnl == null || t.entryPrice == null || t.exitPrice == null) return null;
  const qty = t.filledQty ?? t.quantity;
  const c = intradayCharges(t.side as "BUY" | "SELL", qty, Number(t.entryPrice), Number(t.exitPrice)).total;
  return c > 0 ? c : null;
}
/** Net P&L of a closed trade (gross − estimated charges); gross if charges unknown. */
function netPnlOf(t: Parameters<typeof closedCharges>[0]): number | null {
  if (t.pnl == null) return null;
  const c = closedCharges(t);
  return Number((Number(t.pnl) - (c ?? 0)).toFixed(2));
}

export function serializeTrade(t: Trade) {
  return {
    ...t,
    ltpAtOrder: num(t.ltpAtOrder),
    stopLoss: num(t.stopLoss),
    target: num(t.target),
    marginRequired: num(t.marginRequired),
    marginAvailable: num(t.marginAvailable),
    confidence: num(t.confidence),
    entryPrice: num(t.entryPrice),
    exitPrice: num(t.exitPrice),
    /** NET P&L: gross − estimated charges (closed trades). */
    pnl: netPnlOf(t),
    /** Exact gross P&L from the fills, before charges. */
    grossPnl: num(t.pnl),
    /** Estimated Zerodha charges for the round trip (closed trades). */
    charges: closedCharges(t),
  };
}
export type TradeDto = ReturnType<typeof serializeTrade>;

function grossPnl(side: string, entry: number, exit: number, qty: number): number {
  const perShare = side === "BUY" ? exit - entry : entry - exit;
  return Number((perShare * qty).toFixed(2));
}

/** Your real Zerodha account: funds + today's positions (incl. trades placed in the Kite app). */
export interface AccountSnapshot {
  /** PAPER = built from paper trades; LIVE = straight from Zerodha */
  mode: TradeMode;
  funds: {
    available: number; // "Available margin" in Kite — what you can trade with now
    usedMargin: number; // blocked by open positions / orders
    openingBalance: number; // cash at the start of the day
    addedToday: number; // funds added today (pay-in)
    cash: number;
    liveBalance: number;
    collateral: number; // margin from pledged holdings
  };
  positions: {
    symbol: string;
    exchange: string;
    product: string;
    quantity: number; // 0 = closed today
    avgPrice: number;
    ltp: number;
    pnl: number; // realised + unrealised
    realised: number;
    unrealised: number;
    buyQty: number;
    sellQty: number;
    buyValue: number;
    sellValue: number;
  }[];
  totals: { pnl: number; realised: number; unrealised: number; openPositions: number };
  updatedAt: number;
}

// ── service ──────────────────────────────────────────────────────────────────

export function createOrderExecutionService(config: OrderExecutionConfig) {
  let mode: TradeMode = readSavedMode() ?? "PAPER";

  function readSavedMode(): TradeMode | null {
    if (!config.modeFile) return null;
    try {
      if (!existsSync(config.modeFile)) return null;
      const m = JSON.parse(readFileSync(config.modeFile, "utf8")).mode;
      return m === "LIVE" || m === "PAPER" ? m : null;
    } catch {
      return null;
    }
  }
  function setMode(next: TradeMode): TradeMode {
    if (next !== "LIVE" && next !== "PAPER") throw new TradeError(400, "mode must be PAPER or LIVE");
    if (next === mode) return mode;
    mode = next;
    accountCache = null;
    if (config.modeFile) {
      try {
        mkdirSync(dirname(config.modeFile), { recursive: true });
        writeFileSync(config.modeFile, JSON.stringify({ mode, changedAt: new Date().toISOString() }));
      } catch (e) {
        console.error("[Orders] could not save mode:", errMsg(e));
      }
    }
    console.log(`[Orders] Mode switched to ${mode}${mode === "LIVE" ? " ⚠ REAL ORDERS" : " (paper)"}`);
    return mode;
  }
  const entryCutoff = parseHhMm(config.entryCutoff, DEFAULT_ENTRY_CUTOFF);
  const squareOffAt = parseHhMm(config.squareOffAt, DEFAULT_SQUARE_OFF_AT);
  const squareOffAttempts = new Map<number, number>(); // tradeId → attempts
  const slTriggeredAt = new Map<number, number>(); // tradeId → when its stop-loss was first seen triggered-but-unfilled
  const timers: ReturnType<typeof setInterval>[] = [];
  let polling = false;
  let paperChecking = false;
  let squaringOff = false;

  // Per-key promise chain: everything touching one trade (or one symbol while
  // placing) runs strictly one-at-a-time. Prevents e.g. the WebSocket update
  // and the poll both placing stop-losses for the same filled entry.
  const locks = new Map<string, Promise<unknown>>();
  function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    locks.set(key, tail);
    void tail.then(() => {
      if (locks.get(key) === tail) locks.delete(key);
    });
    return run;
  }

  function kite(): Connect {
    if (config.kiteFactory) return config.kiteFactory();
    const token = config.getAccessToken();
    if (!token) throw new TradeError(503, "Kite is not connected. Log in to Kite first (Connect Kite in the top bar).");
    const kc = new KiteConnect({ api_key: config.apiKey });
    kc.setAccessToken(token);
    return kc;
  }

  /**
   * Retry ONLY on Zerodha's rate-limit error ("Too many requests"): that
   * request was refused before processing, so retrying cannot create a
   * duplicate order. Any other error is thrown immediately.
   */
  async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (attempt < 5 && /too many requests/i.test(errMsg(e))) {
          await sleep(400 * attempt);
          continue;
        }
        throw e;
      }
    }
  }

  function ltpOf(symbol: string): number {
    const q = marketDataService.getQuote(symbol);
    if (!q || q.lastPrice <= 0) throw new TradeError(422, `No live price for ${symbol}. Is Kite connected and is ${symbol} tracked?`);
    return q.lastPrice;
  }

  function tickOf(symbol: string): number {
    return config.getInstrumentMaps()?.tickSizes?.get(symbol) ?? 0.05;
  }

  async function logEvent(tradeId: number, type: string, message: string | null, data?: unknown) {
    await db.insert(tradeEvents).values({ tradeId, type, message, data: (data ?? null) as never });
  }

  async function update(id: number, values: Partial<typeof trades.$inferInsert>): Promise<Trade> {
    const [row] = await db
      .update(trades)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(trades.id, id))
      .returning();
    return row!;
  }

  async function load(id: number): Promise<Trade | undefined> {
    const [row] = await db.select().from(trades).where(eq(trades.id, id)).limit(1);
    return row;
  }

  // ── margin ──

  async function quoteMargin(symbol: string, side: TradeSide): Promise<MarginQuote> {
    const ltp = ltpOf(symbol);
    let marginPerShare = 0;
    let estimated = false;
    let kc: Connect | null = null;
    try {
      kc = kite();
      const res = await withRateLimitRetry(() =>
        kc!.orderMargins(
          [
            {
              exchange: "NSE",
              tradingsymbol: symbol,
              transaction_type: side,
              variety: "regular",
              product: "MIS",
              order_type: "MARKET",
              quantity: 1,
              price: 0,
              trigger_price: 0,
            },
          ],
          "compact",
        ),
      );
      marginPerShare = Number(res[0]?.total ?? 0);
    } catch {
      /* fall through to estimate */
    }
    if (!(marginPerShare > 0)) {
      marginPerShare = ltp * 0.2; // MIS is typically 5× leverage
      estimated = true;
    }

    let available: number;
    if (mode === "LIVE") {
      if (!kc) kc = kite();
      try {
        const funds = await withRateLimitRetry(() => kc!.getMargins("equity"));
        available = Number((funds as { net?: number }).net ?? 0);
      } catch (e) {
        throw new TradeError(502, `Could not read your funds from Zerodha: ${errMsg(e)}`);
      }
    } else {
      // Paper balance (capital + booked paper P&L) minus margin blocked by open paper trades
      available = (await paperFunds()).available;
    }

    return {
      symbol,
      side,
      mode,
      ltp,
      tickSize: tickOf(symbol),
      marginPerShare: Number(marginPerShare.toFixed(2)),
      leverage: Number((ltp / marginPerShare).toFixed(2)),
      available: Number(available.toFixed(2)),
      maxQty: Math.max(0, Math.floor(available / marginPerShare)),
      estimated,
    };
  }

  // ── paper account (same shape as the Zerodha one, built from paper trades) ──
  //   balance   = paper capital + all booked paper P&L (NET of estimated charges)
  //   available = balance − margin blocked by open paper trades

  async function paperFunds() {
    const rows = await db
      .select({
        status: trades.status,
        pnl: trades.pnl,
        m: trades.marginRequired,
        closedAt: trades.closedAt,
        side: trades.side,
        quantity: trades.quantity,
        filledQty: trades.filledQty,
        entryPrice: trades.entryPrice,
        exitPrice: trades.exitPrice,
      })
      .from(trades)
      .where(eq(trades.mode, "PAPER"));
    const todayStart = rangeStart("today")!.getTime();
    let bookedAll = 0, bookedBeforeToday = 0, used = 0;
    for (const r of rows) {
      if (ACTIVE_STATUSES.includes(r.status)) used += Number(r.m ?? 0);
      if (r.status === "CLOSED" && r.pnl != null) {
        const net = netPnlOf(r)!; // after estimated charges
        bookedAll += net;
        if (r.closedAt && r.closedAt.getTime() < todayStart) bookedBeforeToday += net;
      }
    }
    const balance = config.paperCapital + bookedAll;
    return {
      balance,
      openingBalance: config.paperCapital + bookedBeforeToday,
      used,
      available: Math.max(0, balance - used),
    };
  }

  async function paperAccount(): Promise<AccountSnapshot> {
    const f = await paperFunds();
    const today = await db.select().from(trades).where(and(eq(trades.mode, "PAPER"), gte(trades.createdAt, rangeStart("today")!)));
    const active = await db.select().from(trades).where(and(eq(trades.mode, "PAPER"), inArray(trades.status, ACTIVE_STATUSES)));
    const seen = new Set(today.map((t) => t.id));
    const rows = [...today, ...active.filter((t) => !seen.has(t.id))].filter((t) => t.entryPrice != null && (t.filledQty ?? 0) > 0);
    const r2 = (v: number) => Number(v.toFixed(2));
    const positions = rows.map((t) => {
      const qty = t.filledQty ?? t.quantity;
      const entry = Number(t.entryPrice);
      const isOpen = ACTIVE_STATUSES.includes(t.status);
      const ltp = marketDataService.getQuote(t.symbol)?.lastPrice ?? Number(t.exitPrice ?? entry);
      const exit = isOpen ? ltp : Number(t.exitPrice ?? ltp);
      // NET of estimated charges (closed: actual exit; open: as if exited at the LTP now)
      const realised = isOpen ? 0 : (netPnlOf(t) ?? grossPnl(t.side, entry, exit, qty));
      const unrealised = isOpen ? grossPnl(t.side, entry, ltp, qty) - intradayCharges(t.side as "BUY" | "SELL", qty, entry, ltp).total : 0;
      const buy = t.side === "BUY";
      return {
        symbol: t.symbol,
        exchange: t.exchange,
        product: t.product,
        quantity: isOpen ? (buy ? qty : -qty) : 0,
        avgPrice: entry,
        ltp,
        pnl: r2(realised + unrealised),
        realised: r2(realised),
        unrealised: r2(unrealised),
        buyQty: buy || !isOpen ? qty : 0,
        sellQty: !buy || !isOpen ? qty : 0,
        buyValue: r2((buy ? entry : exit) * (buy || !isOpen ? qty : 0)),
        sellValue: r2((buy ? exit : entry) * (!buy || !isOpen ? qty : 0)),
      };
    });
    const sum = (fn: (x: (typeof positions)[number]) => number) => r2(positions.reduce((t, x) => t + fn(x), 0));
    return {
      mode: "PAPER",
      funds: {
        available: r2(f.available),
        usedMargin: r2(f.used),
        openingBalance: r2(f.openingBalance),
        addedToday: 0,
        cash: r2(f.balance),
        liveBalance: r2(f.available),
        collateral: 0,
      },
      positions,
      totals: {
        pnl: sum((x) => x.pnl),
        realised: sum((x) => x.realised),
        unrealised: sum((x) => x.unrealised),
        openPositions: positions.filter((x) => x.quantity !== 0).length,
      },
      updatedAt: Date.now(),
    };
  }

  // ── account (funds + positions straight from Zerodha) ──

  let accountCache: { at: number; data: AccountSnapshot } | null = null;
  let accountInFlight: Promise<AccountSnapshot> | null = null;

  /** Cached 10 s: several screens poll this, Zerodha rate-limits API calls. */
  async function getAccount(): Promise<AccountSnapshot> {
    if (mode === "PAPER") return paperAccount();
    if (accountCache && Date.now() - accountCache.at < 10_000) return accountCache.data;
    if (accountInFlight) return accountInFlight;
    accountInFlight = (async () => {
      const kc = kite();
      // NOTE: the SDK types say getMargins("equity") is wrapped ({ equity: … });
      // the real API returns the segment object directly (verified).
      const [m, p] = await Promise.all([
        withRateLimitRetry(() => kc.getMargins("equity")) as Promise<any>,
        withRateLimitRetry(() => kc.getPositions()) as Promise<any>,
      ]);
      const n = (v: unknown) => Number(v ?? 0) || 0;
      const positions = ((p?.net ?? []) as any[]).map((x) => ({
        symbol: String(x.tradingsymbol),
        exchange: String(x.exchange),
        product: String(x.product),
        quantity: n(x.quantity),
        avgPrice: n(x.average_price),
        ltp: n(x.last_price),
        pnl: n(x.pnl),
        realised: n(x.realised),
        unrealised: n(x.unrealised),
        buyQty: n(x.buy_quantity),
        sellQty: n(x.sell_quantity),
        buyValue: n(x.buy_value),
        sellValue: n(x.sell_value),
      }));
      const sum = (f: (x: (typeof positions)[number]) => number) => Number(positions.reduce((t, x) => t + f(x), 0).toFixed(2));
      const data: AccountSnapshot = {
        mode: "LIVE",
        funds: {
          available: n(m?.net),
          usedMargin: n(m?.utilised?.debits),
          openingBalance: n(m?.available?.opening_balance),
          addedToday: n(m?.available?.intraday_payin),
          cash: n(m?.available?.cash),
          liveBalance: n(m?.available?.live_balance),
          collateral: n(m?.available?.collateral),
        },
        positions,
        totals: {
          pnl: sum((x) => x.pnl),
          realised: sum((x) => x.realised),
          unrealised: sum((x) => x.unrealised),
          openPositions: positions.filter((x) => x.quantity !== 0).length,
        },
        updatedAt: Date.now(),
      };
      accountCache = { at: Date.now(), data };
      return data;
    })();
    try {
      return await accountInFlight;
    } catch (e) {
      if (e instanceof TradeError) throw e;
      throw new TradeError(502, `Could not read your Zerodha account: ${errMsg(e)}`);
    } finally {
      accountInFlight = null;
    }
  }

  // ── place ──

  async function placeTrade(userId: string, input: PlaceTradeInput) {
    const symbol = input.symbol.trim().toUpperCase();
    const side = input.side;
    const qty = Math.floor(Number(input.quantity));

    if (side !== "BUY" && side !== "SELL") throw new TradeError(400, "side must be BUY or SELL");
    if (!Number.isInteger(qty) || qty < 1 || qty > 100_000) throw new TradeError(400, "Quantity must be a whole number of at least 1.");

    const { minutes, weekday } = istNow(config.now?.());
    if (!isWeekday(weekday) || minutes < ENTRY_OPEN_MIN || minutes >= entryCutoff.minutes) {
      throw new TradeError(422, `New intraday orders can be placed 09:15–${entryCutoff.label} IST, Monday to Friday.`);
    }

    return withLock(`place:${userId}:${symbol}`, async () => {
      const ltp = ltpOf(symbol);
      const tick = tickOf(symbol);
      const stopLoss = roundToTick(Number(input.stopLoss), tick);
      const target = roundToTick(Number(input.target), tick);
      if (!(stopLoss > 0) || !(target > 0)) throw new TradeError(400, "Stop-loss and target are required.");
      if (side === "BUY" && !(stopLoss < ltp && target > ltp)) {
        throw new TradeError(422, `For a BUY, stop-loss must be below ₹${ltp} and target above it.`);
      }
      if (side === "SELL" && !(stopLoss > ltp && target < ltp)) {
        throw new TradeError(422, `For a SELL, stop-loss must be above ₹${ltp} and target below it.`);
      }

      const [existing] = await db
        .select({ id: trades.id })
        .from(trades)
        .where(and(eq(trades.userId, userId), eq(trades.symbol, symbol), inArray(trades.status, ACTIVE_STATUSES)))
        .limit(1);
      if (existing) throw new TradeError(409, `You already have an active ${symbol} trade (#${existing.id}). Exit it first.`);

      const margin = await quoteMargin(symbol, side);
      if (qty > margin.maxQty) {
        throw new TradeError(
          422,
          `Not enough margin: ${qty} shares need ₹${(qty * margin.marginPerShare).toFixed(0)}, available ₹${margin.available.toFixed(0)} (max ${margin.maxQty}).`,
        );
      }

      const [row] = await db
        .insert(trades)
        .values({
          userId,
          mode,
          symbol,
          side,
          quantity: qty,
          ltpAtOrder: String(ltp),
          stopLoss: String(stopLoss),
          target: String(target),
          marginRequired: String((qty * margin.marginPerShare).toFixed(2)),
          marginAvailable: String(margin.available),
          setup: input.setup ?? null,
          confidence: input.confidence != null ? String(Number(input.confidence).toFixed(2)) : null,
          status: "PENDING",
        })
        .returning();
      const trade = row!;
      await logEvent(trade.id, "CREATED", `${mode} ${side} ${qty} ${symbol} @ market (LTP ₹${ltp}), SL ₹${stopLoss}, target ₹${target}`);

      // ── PAPER: fill instantly at the live price ──
      if (mode === "PAPER") {
        const opened = await update(trade.id, {
          status: "OPEN",
          entryOrderId: `PAPER-${trade.id}-E`,
          entryStatus: "COMPLETE",
          entryPrice: String(ltp),
          filledQty: qty,
          entryAt: new Date(),
          slOrderId: `PAPER-${trade.id}-SL`,
          slStatus: "TRIGGER PENDING",
          targetOrderId: `PAPER-${trade.id}-T`,
          targetStatus: "OPEN",
        });
        await logEvent(trade.id, "ENTRY_FILLED", `Paper fill ${qty} @ ₹${ltp}; stop-loss and target are being watched`);
        return serializeTrade(opened);
      }

      // ── LIVE: send the entry to Zerodha ──
      try {
        const kc = kite();
        const orderId = await placeTagged(
          kc,
          {
            exchange: "NSE",
            tradingsymbol: symbol,
            transaction_type: side,
            quantity: qty,
            product: "MIS",
            order_type: "MARKET",
            validity: "DAY",
            // Required by Zerodha for API market orders (-1 = automatic protection)
            market_protection: -1,
          },
          `TS${trade.id}`,
          false,
        );
        const placed = await update(trade.id, {
          status: "ENTRY_PLACED",
          entryOrderId: orderId,
          entryStatus: "PUT ORDER REQ RECEIVED",
        });
        await logEvent(trade.id, "ENTRY_PLACED", `Zerodha order ${orderId}`);
        return serializeTrade(placed);
      } catch (e) {
        const message = errMsg(e);
        const failed = await update(trade.id, { status: "FAILED", statusMessage: message });
        await logEvent(trade.id, "ERROR", `Entry order failed: ${message}`);
        return serializeTrade(failed);
      }
    });
  }

  // ── lifecycle on Zerodha updates (LIVE) ──

  /**
   * Close a trade. `pnlQty` = shares actually exited (defaults to the filled
   * entry quantity); P&L = (exit − entry) × qty for a buy, mirrored for a sell.
   */
  async function close(
    cur: Trade,
    reason: ExitReason,
    exitPrice: number,
    extra: Partial<typeof trades.$inferInsert> = {},
    pnlQty?: number,
    exactEntryPrice?: number,
  ) {
    // P&L from EXACT prices (Zerodha averages like 611.46625); the stored
    // entry/exit prices are rounded to 2 decimals for display only.
    const entry = exactEntryPrice && exactEntryPrice > 0 ? exactEntryPrice : Number(cur.entryPrice);
    const qty = pnlQty ?? cur.filledQty ?? cur.quantity;
    const price = Number(exitPrice.toFixed(2));
    const pnl = grossPnl(cur.side, entry, exitPrice, qty);
    const row = await update(cur.id, {
      ...extra,
      status: "CLOSED",
      exitReason: reason,
      exitPrice: String(price),
      pnl: String(pnl),
      closedAt: new Date(),
    });
    await logEvent(cur.id, "CLOSED", `${reason} @ ₹${price} — P&L ₹${pnl}`);
    return row;
  }

  async function cancelIfLive(kc: Connect, orderId: string | null, status: string | null) {
    if (!orderId || (status && TERMINAL_ORDER_STATUSES.has(status))) return;
    try {
      await withRateLimitRetry(() => kc.cancelOrder("regular", orderId));
    } catch {
      /* already filled/cancelled — the order update will tell us */
    }
  }

  /** Newest live (not rejected/cancelled) Zerodha order carrying our tag, if any. */
  async function findByTag(kc: Connect, tag: string): Promise<string | null> {
    const orders = (await withRateLimitRetry(() => kc.getOrders())) as any[];
    const hits = orders.filter(
      (o) => (o.tag === tag || (Array.isArray(o.tags) && o.tags.includes(tag))) && o.status !== "REJECTED" && o.status !== "CANCELLED",
    );
    const last = hits[hits.length - 1];
    return last ? String(last.order_id) : null;
  }

  /**
   * Place an order tagged with OUR id, safely:
   *  - adoptExisting: if an order with this tag already exists (server restarted
   *    half-way), reuse it instead of sending a duplicate.
   *  - on an error (timeout, network) the order may still have reached Zerodha
   *    → look it up by tag before reporting failure.
   */
  async function placeTagged(kc: Connect, params: Record<string, unknown>, tag: string, adoptExisting: boolean): Promise<string> {
    if (adoptExisting) {
      const existing = await findByTag(kc, tag).catch(() => null);
      if (existing) return existing;
    }
    try {
      const res = await withRateLimitRetry(() =>
        kc.placeOrder("regular", { ...params, tag } as Parameters<Connect["placeOrder"]>[1]),
      );
      return String(res.order_id);
    } catch (e) {
      await sleep(800);
      const adopted = await findByTag(kc, tag).catch(() => null);
      if (adopted) return adopted;
      throw e;
    }
  }

  interface LegState {
    status: string;
    filled: number;
    avg: number;
    quantity: number;
  }

  /** Latest state of one real Zerodha order (last row of its history). */
  async function legState(kc: Connect, orderId: string | null): Promise<LegState | null> {
    if (!orderId || orderId.startsWith("PAPER-")) return null;
    const history = (await withRateLimitRetry(() => kc.getOrderHistory(orderId))) as any[];
    const last = history[history.length - 1];
    if (!last) return null;
    return {
      status: String(last.status),
      filled: Number(last.filled_quantity ?? 0),
      avg: Number(last.average_price ?? 0),
      quantity: Number(last.quantity ?? 0),
    };
  }

  /** Wait (≤ ms) until an order is COMPLETE / CANCELLED / REJECTED. */
  async function waitTerminal(kc: Connect, orderId: string | null, ms = 5000): Promise<LegState | null> {
    if (!orderId) return null;
    const until = Date.now() + ms;
    for (;;) {
      const st = await legState(kc, orderId).catch(() => null);
      if (!st || TERMINAL_ORDER_STATUSES.has(st.status) || Date.now() > until) return st;
      await sleep(400);
    }
  }

  /** Everything that has exited the position so far: stop-loss + target + manual exit fills. */
  async function exitFills(kc: Connect, cur: Trade) {
    const sl = await legState(kc, cur.slOrderId).catch(() => null);
    const tg = await legState(kc, cur.targetOrderId).catch(() => null);
    const ex = await legState(kc, cur.exitOrderId).catch(() => null);
    const legs = [sl, tg, ex].filter((l): l is LegState => !!l && l.filled > 0);
    return {
      sl,
      tg,
      ex,
      qty: legs.reduce((s, l) => s + l.filled, 0),
      value: legs.reduce((s, l) => s + l.filled * l.avg, 0),
    };
  }

  /**
   * Close a LIVE trade from the ACTUAL fills of all exit legs (correct when
   * the target filled partly and the stop-loss took the rest).
   */
  async function closeLive(cur: Trade, reason: ExitReason, kc: Connect, fallback?: { qty: number; avg: number }) {
    const f = await exitFills(kc, cur);
    let qty = f.qty;
    let value = f.value;
    if (qty === 0 && fallback && fallback.qty > 0) {
      qty = fallback.qty;
      value = fallback.qty * fallback.avg;
    }
    const entryQty = cur.filledQty ?? cur.quantity;
    if (qty !== entryQty) {
      await logEvent(cur.id, "WARNING", `Exited ${qty} of ${entryQty} shares — check positions in Kite.`);
    }
    const exitPrice = qty > 0 ? value / qty : Number(cur.entryPrice);
    const entryLeg = await legState(kc, cur.entryOrderId).catch(() => null);
    return close(
      cur,
      reason,
      exitPrice,
      {
        // remember final leg states so late duplicate updates are recognised
        ...(f.sl ? { slStatus: f.sl.status } : {}),
        ...(f.tg ? { targetStatus: f.tg.status } : {}),
        ...(f.ex ? { exitStatus: f.ex.status } : {}),
      },
      qty || entryQty,
      entryLeg?.avg,
    );
  }

  /** Entry filled → place stop-loss (SL-M) then target (LIMIT). Caller holds the trade lock. */
  async function placeProtection(cur: Trade) {
    const kc = kite();
    const qty = cur.filledQty ?? cur.quantity;
    const exitSide: TradeSide = cur.side === "BUY" ? "SELL" : "BUY";
    const stopLoss = Number(cur.stopLoss);
    const target = Number(cur.target);

    // Price already through the stop at fill time → an SL-M would be rejected; exit now.
    const ltp = marketDataService.getQuote(cur.symbol)?.lastPrice ?? 0;
    if (ltp > 0 && ((cur.side === "BUY" && ltp <= stopLoss) || (cur.side === "SELL" && ltp >= stopLoss))) {
      await logEvent(cur.id, "SL_ALREADY_HIT", `Price ₹${ltp} already beyond stop-loss ₹${stopLoss} at fill — exiting`);
      await startExit(cur, "STOP_LOSS");
      return;
    }

    let slOk = false;
    try {
      const slId = await placeTagged(
        kc,
        {
          exchange: "NSE",
          tradingsymbol: cur.symbol,
          transaction_type: exitSide,
          quantity: qty,
          product: "MIS",
          order_type: "SL-M",
          trigger_price: stopLoss,
          validity: "DAY",
          market_protection: -1,
        },
        `TS${cur.id}SL`,
        true,
      );
      await update(cur.id, { slOrderId: slId, slStatus: "TRIGGER PENDING" });
      await logEvent(cur.id, "SL_PLACED", `Stop-loss ${slId}: ${exitSide} ${qty} SL-M trigger ₹${stopLoss}`);
      slOk = true;
    } catch (e) {
      await update(cur.id, {
        status: "UNPROTECTED",
        statusMessage: `Stop-loss NOT placed: ${errMsg(e)}. Your position is open without protection — exit in Kite or with the Exit button.`,
      });
      await logEvent(cur.id, "ERROR", `Stop-loss failed: ${errMsg(e)}`);
    }

    let targetMsg: string | null = null;
    try {
      const tgId = await placeTagged(
        kc,
        {
          exchange: "NSE",
          tradingsymbol: cur.symbol,
          transaction_type: exitSide,
          quantity: qty,
          product: "MIS",
          order_type: "LIMIT",
          price: target,
          validity: "DAY",
        },
        `TS${cur.id}TG`,
        true,
      );
      await update(cur.id, { targetOrderId: tgId, targetStatus: "OPEN" });
      await logEvent(cur.id, "TARGET_PLACED", `Target ${tgId}: ${exitSide} ${qty} LIMIT ₹${target}`);
    } catch (e) {
      targetMsg = `Target not placed: ${errMsg(e)} (stop-loss is still active).`;
      await logEvent(cur.id, "ERROR", targetMsg);
    }

    if (slOk) await update(cur.id, { status: "OPEN", statusMessage: targetMsg });
  }

  async function processOrderUpdate(o: any) {
    const orderId = o?.order_id != null ? String(o.order_id) : null;
    const status: string | undefined = o?.status;
    if (!orderId || !status) return;

    const [t] = await db
      .select()
      .from(trades)
      .where(
        or(
          eq(trades.entryOrderId, orderId),
          eq(trades.slOrderId, orderId),
          eq(trades.targetOrderId, orderId),
          eq(trades.exitOrderId, orderId),
        ),
      )
      .limit(1);
    if (!t || t.mode !== "LIVE") return;

    await withLock(`trade:${t.id}`, async () => {
      const before = (await load(t.id))!;
      const leg =
        before.entryOrderId === orderId ? "entry" : before.slOrderId === orderId ? "sl" : before.targetOrderId === orderId ? "target" : "exit";
      const statusField = `${leg}Status` as "entryStatus" | "slStatus" | "targetStatus" | "exitStatus";

      // Zerodha can send the same update more than once (and the poll may
      // see it too). Same status as stored = already handled → ignore.
      // (Partial fills keep status OPEN; the poll reconciles those.)
      if (before[statusField] === status) return;
      // Zerodha can deliver updates out of order (e.g. "OPEN" arriving after
      // "COMPLETE"). A final status is never replaced by a non-final one.
      const stored = before[statusField];
      if (stored && TERMINAL_ORDER_STATUSES.has(stored) && !TERMINAL_ORDER_STATUSES.has(status)) {
        await logEvent(before.id, "IGNORED_UPDATE", `${leg} ${orderId}: late "${status}" after "${stored}" ignored`);
        return;
      }

      const avg = Number(o.average_price ?? 0);
      const filled = Number(o.filled_quantity ?? 0);
      const reason: string = o.status_message || o.status_message_raw || status;
      await update(before.id, { [statusField]: status });
      await logEvent(before.id, "ORDER_UPDATE", `${leg} ${orderId}: ${status}${o.status_message ? ` — ${o.status_message}` : ""}`, {
        status,
        average_price: o.average_price,
        filled_quantity: o.filled_quantity,
        status_message: o.status_message,
      });
      const cur = (await load(before.id))!;
      const awaitingEntry = cur.status === "ENTRY_PLACED" || cur.status === "PENDING";

      if (leg === "entry") {
        // Filled (or partly filled then cancelled → protect the part we got)
        if (awaitingEntry && (status === "COMPLETE" || (TERMINAL_ORDER_STATUSES.has(status) && filled > 0))) {
          const opened = await update(cur.id, {
            entryPrice: String(avg),
            filledQty: filled || cur.quantity,
            entryAt: new Date(),
          });
          await logEvent(cur.id, "ENTRY_FILLED", `Filled ${filled} @ ₹${avg.toFixed(2)}`);
          await placeProtection(opened);
        } else if (awaitingEntry && (status === "REJECTED" || status === "CANCELLED")) {
          await update(cur.id, { status: "REJECTED", statusMessage: reason });
        }
        return;
      }

      if (leg === "sl" || leg === "target") {
        const exitReason: ExitReason = leg === "sl" ? "STOP_LOSS" : "TARGET";
        if (status === "COMPLETE") {
          if (cur.status === "CLOSED") {
            // Trade was already closed by ANOTHER leg → this fill over-exits the position.
            await update(cur.id, {
              status: "UNPROTECTED",
              statusMessage: `Both exit orders filled — you may now hold an opposite position in ${cur.symbol}. Check positions in Kite.`,
            });
            await logEvent(cur.id, "WARNING", `${leg} filled after the trade was already closed (${cur.exitReason}).`);
            return;
          }
          const kc = kite();
          // the other leg is no longer needed
          if (leg === "sl") await cancelIfLive(kc, cur.targetOrderId, cur.targetStatus);
          else await cancelIfLive(kc, cur.slOrderId, cur.slStatus);
          await closeLive(cur, exitReason, kc, { qty: filled, avg });
        } else if ((status === "REJECTED" || status === "CANCELLED") && cur.status === "OPEN") {
          // Cancelled by someone else (Kite app) or rejected by the exchange
          if (leg === "sl") {
            await update(cur.id, {
              status: "UNPROTECTED",
              statusMessage: `Stop-loss order ${status.toLowerCase()}: ${reason}. Position has no stop-loss — exit it.`,
            });
          } else {
            await update(cur.id, { statusMessage: `Target order ${status.toLowerCase()}: ${reason} (stop-loss still active).` });
          }
        }
        return;
      }

      // exit leg
      if (status === "COMPLETE") {
        await closeLive(cur, (cur.exitReason as ExitReason) ?? "MANUAL", kite(), { qty: filled, avg });
      } else if (status === "REJECTED" || status === "CANCELLED") {
        await update(cur.id, {
          status: "UNPROTECTED",
          statusMessage: `Exit order ${status.toLowerCase()}: ${reason}. Square off ${cur.symbol} in Kite now.`,
        });
      }
    });
  }

  /** Send the exit (caller holds the trade lock). */
  async function startExit(cur: Trade, reason: ExitReason) {
    if (cur.mode === "PAPER") {
      const ltp = marketDataService.getQuote(cur.symbol)?.lastPrice ?? Number(cur.entryPrice);
      return close(cur, reason, ltp, {
        slStatus: "CANCELLED",
        targetStatus: "CANCELLED",
        exitOrderId: `PAPER-${cur.id}-X`,
        exitStatus: "COMPLETE",
      });
    }

    const kc = kite();
    await update(cur.id, { status: "EXITING", exitReason: reason });
    await logEvent(cur.id, "EXIT_REQUESTED", reason);

    // 1. Cancel stop-loss + target and WAIT until Zerodha confirms — a leg
    //    filling during the cancel must not be followed by a second exit.
    await cancelIfLive(kc, cur.slOrderId, cur.slStatus);
    await cancelIfLive(kc, cur.targetOrderId, cur.targetStatus);
    const sl = await waitTerminal(kc, cur.slOrderId);
    const tg = await waitTerminal(kc, cur.targetOrderId);
    for (const [name, st] of [
      ["stop-loss", sl],
      ["target", tg],
    ] as const) {
      if (st && !TERMINAL_ORDER_STATUSES.has(st.status)) {
        await update(cur.id, {
          status: "UNPROTECTED",
          statusMessage: `Could not confirm the ${name} order was cancelled (still ${st.status}). Not sending another exit to avoid selling twice — check ${cur.symbol} in Kite.`,
        });
        await logEvent(cur.id, "ERROR", `Exit aborted: ${name} still ${st.status}`);
        return;
      }
    }

    // 2. How much is still open? (target may have filled partly)
    const entryQty = cur.filledQty ?? cur.quantity;
    const done = (sl?.filled ?? 0) + (tg?.filled ?? 0);
    const remaining = entryQty - done;
    const fresh = (await load(cur.id))!;
    if (remaining === 0) {
      return closeLive(fresh, (sl?.filled ?? 0) >= (tg?.filled ?? 0) ? "STOP_LOSS" : "TARGET", kc);
    }
    if (remaining < 0) {
      await update(cur.id, {
        status: "UNPROTECTED",
        statusMessage: `Exit orders filled ${-remaining} more shares than you held in ${cur.symbol} — check positions in Kite.`,
      });
      return;
    }

    // 3. Market exit for exactly what is left
    try {
      const exitId = await placeTagged(
        kc,
        {
          exchange: "NSE",
          tradingsymbol: cur.symbol,
          transaction_type: cur.side === "BUY" ? "SELL" : "BUY",
          quantity: remaining,
          product: "MIS",
          order_type: "MARKET",
          validity: "DAY",
          market_protection: -1,
        },
        `TS${cur.id}X`,
        true,
      );
      await update(cur.id, { exitOrderId: exitId, exitStatus: "PUT ORDER REQ RECEIVED" });
      await logEvent(cur.id, "EXIT_PLACED", `Exit order ${exitId}: ${remaining} shares (${reason})`);
    } catch (e) {
      await update(cur.id, {
        status: "UNPROTECTED",
        statusMessage: `Exit order failed: ${errMsg(e)}. Square off ${cur.symbol} in Kite now.`,
      });
      await logEvent(cur.id, "ERROR", `Exit failed: ${errMsg(e)}`);
    }
  }

  async function exitTrade(userId: string, tradeId: number, reason: ExitReason = "MANUAL") {
    return withLock(`trade:${tradeId}`, async () => {
      const cur = await load(tradeId);
      if (!cur || cur.userId !== userId) throw new TradeError(404, "Trade not found.");

      // Entry sent but not filled yet → cancel it (the update marks the trade REJECTED/cancelled)
      if (cur.status === "ENTRY_PLACED" && cur.mode === "LIVE") {
        await cancelIfLive(kite(), cur.entryOrderId, cur.entryStatus);
        await logEvent(cur.id, "CANCEL_REQUESTED", reason === "SQUARE_OFF" ? "Entry not filled by square-off time — cancelling" : "Entry cancelled by you");
        return serializeTrade((await load(tradeId))!);
      }
      if (cur.status !== "OPEN" && cur.status !== "UNPROTECTED") {
        throw new TradeError(409, `Trade is ${cur.status.toLowerCase()} — nothing to exit.`);
      }
      await startExit(cur, reason);
      return serializeTrade((await load(tradeId))!);
    });
  }

  // ── background loops ──

  /**
   * LIVE safety net, one getOrders() call every 3 s:
   *  1. status changes the WebSocket missed
   *  2. recovery: entry filled but stop-loss never placed (e.g. server restart)
   *  3. target filled PARTLY → shrink the stop-loss to the shares still open,
   *     so a later stop-loss hit can't sell more than you hold
   */
  async function pollLiveOrders() {
    // Runs in BOTH modes: live trades placed before switching to Paper must stay managed.
    if (polling || (!config.getAccessToken() && !config.kiteFactory)) return;
    polling = true;
    try {
      const active = await db
        .select()
        .from(trades)
        .where(and(eq(trades.mode, "LIVE"), inArray(trades.status, ["ENTRY_PLACED", "OPEN", "EXITING", "UNPROTECTED"])));
      if (active.length === 0) return;
      const kc = kite();
      const orders = (await withRateLimitRetry(() => kc.getOrders())) as any[];
      const byId = new Map(orders.map((o) => [String(o.order_id), o]));

      // 1. missed status changes
      for (const t of active) {
        for (const [id, st] of [
          [t.entryOrderId, t.entryStatus],
          [t.slOrderId, t.slStatus],
          [t.targetOrderId, t.targetStatus],
          [t.exitOrderId, t.exitStatus],
        ] as const) {
          const o = id ? byId.get(id) : undefined;
          if (o && o.status !== st) await processOrderUpdate(o);
        }
      }

      // 2. entry filled but no stop-loss recorded (crashed between fill and protection)
      for (const t of active.filter((x) => x.status === "ENTRY_PLACED" && x.entryStatus === "COMPLETE" && !x.slOrderId)) {
        await withLock(`trade:${t.id}`, async () => {
          const cur = await load(t.id);
          if (!cur || cur.status !== "ENTRY_PLACED" || cur.slOrderId) return;
          const e = cur.entryOrderId ? byId.get(cur.entryOrderId) : undefined;
          const fixed = await update(cur.id, {
            entryPrice: cur.entryPrice ?? String(Number(e?.average_price ?? 0)),
            filledQty: cur.filledQty ?? (Number(e?.filled_quantity ?? 0) || cur.quantity),
            entryAt: cur.entryAt ?? new Date(),
          });
          await logEvent(cur.id, "RECOVERY", "Entry was filled but protection was missing — placing stop-loss and target now");
          await placeProtection(fixed);
        });
      }

      // 3. partial target fill → resize the stop-loss
      for (const t of active.filter((x) => x.status === "OPEN" && x.slOrderId && x.targetOrderId)) {
        const tg = byId.get(t.targetOrderId!);
        const sl = byId.get(t.slOrderId!);
        if (!tg || !sl || TERMINAL_ORDER_STATUSES.has(String(sl.status)) || tg.status === "COMPLETE") continue;
        const filled = Number(tg.filled_quantity ?? 0);
        const want = (t.filledQty ?? t.quantity) - filled;
        if (filled <= 0 || want <= 0 || Number(sl.quantity) === want) continue;
        await withLock(`trade:${t.id}`, async () => {
          try {
            await withRateLimitRetry(() =>
              kc.modifyOrder("regular", t.slOrderId!, {
                quantity: want,
                order_type: "SL-M",
                trigger_price: Number(t.stopLoss),
                market_protection: -1,
              } as Parameters<Connect["modifyOrder"]>[2]),
            );
            await logEvent(t.id, "SL_RESIZED", `Target filled ${filled} — stop-loss reduced to the ${want} shares still open`);
          } catch (e) {
            await logEvent(t.id, "ERROR", `Could not resize stop-loss after partial target fill: ${errMsg(e)}`);
          }
        });
      }

      // 4. stop-loss TRIGGERED but not filling (Zerodha turns SL-M into a
      //    protected stop-LIMIT; a fast fall past its limit leaves it open)
      //    → after STUCK_SL_MS, cancel it and exit the rest at market.
      for (const t of active.filter((x) => x.status === "OPEN" && x.slOrderId)) {
        const sl = byId.get(t.slOrderId!);
        const pending = sl ? Number(sl.pending_quantity ?? Number(sl.quantity) - Number(sl.filled_quantity ?? 0)) : 0;
        if (!sl || sl.status !== "OPEN" || pending <= 0) {
          slTriggeredAt.delete(t.id);
          continue;
        }
        const since = slTriggeredAt.get(t.id) ?? Date.now();
        slTriggeredAt.set(t.id, since);
        if (Date.now() - since < STUCK_SL_MS) continue;
        slTriggeredAt.delete(t.id);
        await withLock(`trade:${t.id}`, async () => {
          const cur = await load(t.id);
          if (!cur || cur.status !== "OPEN") return;
          await logEvent(cur.id, "SL_NOT_FILLING", `Stop-loss triggered but ${pending} shares not filled for ${STUCK_SL_MS / 1000}s — exiting at market`);
          await startExit(cur, "STOP_LOSS");
        });
      }
    } catch (e) {
      console.error("[Orders] poll failed:", errMsg(e));
    } finally {
      polling = false;
    }
  }

  /** PAPER: check stop-loss / target against live prices every second. */
  async function checkPaperTrades() {
    if (paperChecking) return;
    paperChecking = true;
    try {
      const open = await db.select().from(trades).where(and(eq(trades.mode, "PAPER"), eq(trades.status, "OPEN")));
      for (const t of open) {
        const ltp = marketDataService.getQuote(t.symbol)?.lastPrice ?? 0;
        if (ltp <= 0) continue;
        const sl = Number(t.stopLoss);
        const tg = Number(t.target);
        const isBuy = t.side === "BUY";
        const slHit = isBuy ? ltp <= sl : ltp >= sl;
        const tgHit = isBuy ? ltp >= tg : ltp <= tg;
        if (!slHit && !tgHit) continue;
        await withLock(`trade:${t.id}`, async () => {
          const cur = await load(t.id);
          if (!cur || cur.status !== "OPEN") return;
          if (slHit) {
            // SL-M fills at market → use the live price (includes slippage)
            await close(cur, "STOP_LOSS", ltp, { slStatus: "COMPLETE", targetStatus: "CANCELLED" });
          } else {
            // LIMIT target fills at the target price
            await close(cur, "TARGET", tg, { targetStatus: "COMPLETE", slStatus: "CANCELLED" });
          }
        });
      }
    } catch (e) {
      console.error("[Orders] paper check failed:", errMsg(e));
    } finally {
      paperChecking = false;
    }
  }

  /** At SQUARE_OFF_AT (default 15:00 IST): close every open intraday trade, cancel unfilled entries. */
  async function squareOffIfDue() {
    if (squaringOff) return;
    const { minutes, weekday, dateKey } = istNow(config.now?.());
    squaringOff = true;
    try {
      const open = await db.select().from(trades).where(inArray(trades.status, ["ENTRY_PLACED", "OPEN", "UNPROTECTED"]));
      for (const t of open) {
        const createdDay = istNow(t.createdAt).dateKey;
        const due = createdDay < dateKey || (isWeekday(weekday) && minutes >= squareOffAt.minutes);
        if (!due) continue;
        if (t.mode === "LIVE" && !config.getAccessToken() && !config.kiteFactory) continue;
        // retry a failed exit a few times, then leave it to you (status stays UNPROTECTED)
        const attempts = squareOffAttempts.get(t.id) ?? 0;
        if (attempts >= MAX_SQUARE_OFF_ATTEMPTS) continue;
        squareOffAttempts.set(t.id, attempts + 1);
        try {
          await exitTrade(t.userId, t.id, "SQUARE_OFF");
        } catch (e) {
          console.error(`[Orders] square-off #${t.id} failed:`, errMsg(e));
        }
      }
    } finally {
      squaringOff = false;
    }
  }

  // ── reads for the UI ──

  function rangeStart(range: string): Date | null {
    const now = new Date();
    const startOfTodayIst = new Date(`${istNow(now).dateKey}T00:00:00+05:30`);
    if (range === "today") return startOfTodayIst;
    if (range === "7d") return new Date(startOfTodayIst.getTime() - 6 * 86_400_000);
    if (range === "30d") return new Date(startOfTodayIst.getTime() - 29 * 86_400_000);
    return null; // all
  }

  async function listTrades(userId: string, opts: { range?: string; status?: string; mode?: string }) {
    const conds = [eq(trades.userId, userId)];
    const start = rangeStart(opts.range ?? "today");
    if (start) conds.push(gte(trades.createdAt, start));
    if (opts.status === "active") conds.push(inArray(trades.status, ACTIVE_STATUSES));
    if (opts.mode === "PAPER" || opts.mode === "LIVE") conds.push(eq(trades.mode, opts.mode));
    const rows = await db.select().from(trades).where(and(...conds)).orderBy(desc(trades.createdAt)).limit(500);
    return rows.map(serializeTrade);
  }

  async function getTrade(userId: string, id: number) {
    const t = await load(id);
    if (!t || t.userId !== userId) throw new TradeError(404, "Trade not found.");
    const events = await db.select().from(tradeEvents).where(eq(tradeEvents.tradeId, id)).orderBy(tradeEvents.at);
    return { trade: serializeTrade(t), events };
  }

  async function stats(userId: string, opts: { range?: string; mode?: string }) {
    const all = await listTrades(userId, { range: opts.range ?? "30d", mode: opts.mode });
    const closed = all.filter((t) => t.status === "CLOSED" && t.pnl != null).sort((a, b) => +new Date(a.closedAt!) - +new Date(b.closedAt!));
    const wins = closed.filter((t) => t.pnl! > 0);
    const losses = closed.filter((t) => t.pnl! < 0);
    const grossWin = wins.reduce((s, t) => s + t.pnl!, 0);
    const grossLoss = losses.reduce((s, t) => s + t.pnl!, 0); // negative
    const net = grossWin + grossLoss;

    let cum = 0;
    const equity = closed.map((t) => {
      cum += t.pnl!;
      return { time: Math.floor(+new Date(t.closedAt!) / 1000), pnl: Number(cum.toFixed(2)) };
    });

    const byDayMap = new Map<string, { date: string; pnl: number; trades: number; wins: number }>();
    const bySymbolMap = new Map<string, { symbol: string; pnl: number; trades: number; wins: number }>();
    for (const t of closed) {
      const day = istNow(new Date(t.closedAt!)).dateKey;
      const d = byDayMap.get(day) ?? { date: day, pnl: 0, trades: 0, wins: 0 };
      d.pnl += t.pnl!;
      d.trades++;
      if (t.pnl! > 0) d.wins++;
      byDayMap.set(day, d);
      const s = bySymbolMap.get(t.symbol) ?? { symbol: t.symbol, pnl: 0, trades: 0, wins: 0 };
      s.pnl += t.pnl!;
      s.trades++;
      if (t.pnl! > 0) s.wins++;
      bySymbolMap.set(t.symbol, s);
    }
    const round = <T extends { pnl: number }>(x: T) => ({ ...x, pnl: Number(x.pnl.toFixed(2)) });

    const byReason: Record<string, number> = {};
    for (const t of closed) byReason[t.exitReason ?? "UNKNOWN"] = (byReason[t.exitReason ?? "UNKNOWN"] ?? 0) + 1;

    return {
      range: opts.range ?? "30d",
      mode: opts.mode ?? "ALL",
      netPnl: Number(net.toFixed(2)),
      closedTrades: closed.length,
      wins: wins.length,
      losses: losses.length,
      winRate: closed.length ? Number(((wins.length / closed.length) * 100).toFixed(1)) : null,
      avgWin: wins.length ? Number((grossWin / wins.length).toFixed(2)) : null,
      avgLoss: losses.length ? Number((grossLoss / losses.length).toFixed(2)) : null,
      profitFactor: grossLoss < 0 ? Number((grossWin / -grossLoss).toFixed(2)) : null,
      best: closed.length ? Math.max(...closed.map((t) => t.pnl!)) : null,
      worst: closed.length ? Math.min(...closed.map((t) => t.pnl!)) : null,
      openTrades: all.filter((t) => ACTIVE_STATUSES.includes(t.status)).length,
      rejected: all.filter((t) => t.status === "REJECTED" || t.status === "FAILED").length,
      byReason,
      equity,
      byDay: [...byDayMap.values()].map(round).sort((a, b) => b.date.localeCompare(a.date)),
      bySymbol: [...bySymbolMap.values()].map(round).sort((a, b) => b.pnl - a.pnl),
    };
  }

  return {
    get mode() {
      return mode;
    },
    setMode,
    getConfig() {
      return {
        mode,
        paperCapital: config.paperCapital,
        entryWindow: `09:15–${entryCutoff.label} IST`,
        squareOffAt: `${squareOffAt.label} IST`,
      };
    },
    quoteMargin,
    getAccount,
    placeTrade,
    exitTrade,
    listTrades,
    getTrade,
    stats,
    /** Wire to KiteTicker `order_update` events. */
    handleOrderUpdate(order: unknown) {
      void processOrderUpdate(order).catch((e) => console.error("[Orders] update failed:", errMsg(e)));
    },
    start() {
      timers.push(setInterval(() => void pollLiveOrders(), 3000));
      timers.push(setInterval(() => void checkPaperTrades(), 1000));
      timers.push(setInterval(() => void squareOffIfDue(), 15_000));
      for (const t of timers) t.unref();
      console.log(`[Orders] Execution service started — mode: ${mode}${mode === "PAPER" ? ` (paper capital ₹${config.paperCapital})` : " ⚠ REAL ORDERS"}`);
    },
    stop() {
      for (const t of timers) clearInterval(t);
      timers.length = 0;
    },
  };
}

export type OrderExecutionService = ReturnType<typeof createOrderExecutionService>;
