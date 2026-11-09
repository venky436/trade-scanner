// Shared types, API calls and display helpers for the Trade / Orders / P&L
// screens and the order window. Mirrors apps/server/src/services/order-execution.service.ts.

import { apiFetch } from "@/lib/api";
import type { IntelligenceSnapshot } from "@/lib/types";
import { intradayCharges } from "./charges";

export type TradeSide = "BUY" | "SELL";
export type TradeMode = "PAPER" | "LIVE";
export type TradeStatus =
  | "PENDING"
  | "ENTRY_PLACED"
  | "OPEN"
  | "EXITING"
  | "CLOSED"
  | "REJECTED"
  | "FAILED"
  | "UNPROTECTED";
export type ExitReason = "TARGET" | "STOP_LOSS" | "MANUAL" | "SQUARE_OFF";

export interface TradePlan {
  action: TradeSide;
  entry: number;
  stopLoss: number;
  target: number;
  riskPercent: number;
  rewardPercent: number;
  riskReward: number;
  atr: number;
}

/** Server-side intelligence snapshot (includes the trade plan). */
export interface Setup extends IntelligenceSnapshot {
  tradePlan: TradePlan | null;
}

export interface SetupsResponse {
  ready: Setup[];
  watch: Setup[];
  poolSize: number;
  timestamp: number;
  /** Call rules: new calls only inside the window, confirmation candle volume ≥ volumeMult × average */
  rules?: { window: string; inWindow: boolean; volumeMult: number };
}

export interface AutoTraderStatus {
  enabled: boolean;
  /** true only when switched on AND the server is in PAPER mode */
  active: boolean;
  mode: TradeMode;
  minConfidence: number;
  maxActive: number;
  quantity: number;
  cooldownMinutes: number;
  lastRunAt: number;
  note: string;
  activity: { at: number; symbol: string; action: "PLACED" | "FAILED"; message: string }[];
}

/** Trades placed by the auto-trader carry setup "AUTO:<outlook>". */
export const AUTO_SETUP_PREFIX = "AUTO:";
export const isAutoTrade = (t: { setup: string | null }) => !!t.setup?.startsWith(AUTO_SETUP_PREFIX);

export interface TradeConfig {
  mode: TradeMode;
  paperCapital: number;
  entryWindow: string;
  squareOffAt: string;
}

export interface MarginQuote {
  symbol: string;
  side: TradeSide;
  mode: TradeMode;
  ltp: number;
  tickSize: number;
  marginPerShare: number;
  leverage: number;
  available: number;
  maxQty: number;
  estimated: boolean;
}

export interface Trade {
  id: number;
  mode: TradeMode;
  symbol: string;
  exchange: string;
  side: TradeSide;
  quantity: number;
  product: string;
  ltpAtOrder: number;
  stopLoss: number;
  target: number;
  marginRequired: number | null;
  marginAvailable: number | null;
  setup: string | null;
  confidence: number | null;
  status: TradeStatus;
  statusMessage: string | null;
  entryOrderId: string | null;
  entryStatus: string | null;
  entryPrice: number | null;
  filledQty: number | null;
  slOrderId: string | null;
  slStatus: string | null;
  targetOrderId: string | null;
  targetStatus: string | null;
  exitOrderId: string | null;
  exitStatus: string | null;
  exitPrice: number | null;
  exitReason: ExitReason | null;
  /** NET P&L of a closed trade: gross − estimated charges */
  pnl: number | null;
  /** Exact gross P&L from the fills (closed trades) */
  grossPnl?: number | null;
  /** Estimated Zerodha charges for the round trip (closed trades) */
  charges?: number | null;
  createdAt: string;
  updatedAt: string;
  entryAt: string | null;
  closedAt: string | null;
  /** Live price (list endpoint only) — for P&L of open positions. */
  ltp?: number | null;
}

export interface TradeEvent {
  id: number;
  tradeId: number;
  at: string;
  type: string;
  message: string | null;
}

export interface TradeStats {
  range: string;
  mode: string;
  netPnl: number;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  profitFactor: number | null;
  best: number | null;
  worst: number | null;
  openTrades: number;
  rejected: number;
  byReason: Record<string, number>;
  equity: { time: number; pnl: number }[];
  byDay: { date: string; pnl: number; trades: number; wins: number }[];
  bySymbol: { symbol: string; pnl: number; trades: number; wins: number }[];
}

/** Real Zerodha account — funds + today's positions (also trades placed in the Kite app). */
export interface AccountSnapshot {
  /** PAPER = paper balance + paper positions; LIVE = straight from Zerodha */
  mode: TradeMode;
  funds: {
    available: number;
    usedMargin: number;
    openingBalance: number;
    addedToday: number;
    cash: number;
    liveBalance: number;
    collateral: number;
  };
  positions: {
    symbol: string;
    exchange: string;
    product: string;
    quantity: number;
    avgPrice: number;
    ltp: number;
    pnl: number;
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

export type Range = "today" | "7d" | "30d" | "all";
export type ModeFilter = "ALL" | TradeMode;

// ── API ──────────────────────────────────────────────────────────────────────

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const tradingApi = {
  config: () => apiFetch("/api/trade/config").then((r) => json<TradeConfig>(r)),
  account: () => apiFetch("/api/trade/account").then((r) => json<AccountSnapshot>(r)),
  setMode: (mode: TradeMode) =>
    apiFetch("/api/trade/mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, confirm: mode === "LIVE" }),
    }).then((r) => json<TradeConfig>(r)),
  setups: (limit = 10) => apiFetch(`/api/trade/setups?limit=${limit}`).then((r) => json<SetupsResponse>(r)),
  margin: (symbol: string, side: TradeSide) =>
    apiFetch(`/api/trade/margin${qs({ symbol, side })}`).then((r) => json<MarginQuote>(r)),
  place: (body: {
    symbol: string;
    side: TradeSide;
    quantity: number;
    stopLoss: number;
    target: number;
    setup?: string | null;
    confidence?: number | null;
  }) =>
    apiFetch("/api/trades", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => json<{ trade: Trade }>(r)),
  list: (range: Range, mode: ModeFilter, status?: "active") =>
    apiFetch(`/api/trades${qs({ range, mode: mode === "ALL" ? undefined : mode, status })}`).then((r) =>
      json<{ trades: Trade[] }>(r),
    ),
  get: (id: number) => apiFetch(`/api/trades/${id}`).then((r) => json<{ trade: Trade; events: TradeEvent[] }>(r)),
  exit: (id: number) => apiFetch(`/api/trades/${id}/exit`, { method: "POST" }).then((r) => json<{ trade: Trade }>(r)),
  auto: () => apiFetch("/api/trade/auto").then((r) => json<AutoTraderStatus>(r)),
  setAuto: (enabled: boolean) =>
    apiFetch("/api/trade/auto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }).then((r) => json<AutoTraderStatus>(r)),
  stats: (range: Range, mode: ModeFilter) =>
    apiFetch(`/api/trades/stats${qs({ range, mode: mode === "ALL" ? undefined : mode })}`).then((r) => json<TradeStats>(r)),
};

// ── formatting ───────────────────────────────────────────────────────────────

const inrFmt = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inrWhole = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** ₹1,23,456.70 */
export function inr(n: number | null | undefined, whole = false): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `₹${(whole ? inrWhole : inrFmt).format(n)}`;
}

/** +₹1,234.50 / −₹320.00 — for P&L */
export function signedInr(n: number | null | undefined, whole = false): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${inr(Math.abs(n), whole)}`;
}

export function pct(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(digits)}%`;
}

export function pnlTone(n: number | null | undefined): string {
  if (n == null || n === 0) return "text-muted-foreground";
  return n > 0 ? "text-emerald-500" : "text-rose-500";
}

export function timeIst(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function dateIst(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
}

/** Unrealised (open) or realised (closed) P&L of a trade, given the live price. */
/** NET P&L (after estimated charges). Closed: from the server. Open: as if exited at `ltp` now. */
export function tradePnl(t: Trade, ltp: number | undefined): number | null {
  if (t.status === "CLOSED") return t.pnl;
  if (t.entryPrice == null || !ltp) return null;
  const qty = t.filledQty ?? t.quantity;
  const perShare = t.side === "BUY" ? ltp - t.entryPrice : t.entryPrice - ltp;
  return perShare * qty - intradayCharges(t.side, qty, t.entryPrice, ltp).total;
}

export const ACTIVE_STATUSES: ReadonlySet<TradeStatus> = new Set(["PENDING", "ENTRY_PLACED", "OPEN", "EXITING", "UNPROTECTED"]);

// ── vocabulary shown to the user ─────────────────────────────────────────────

/** BUY = blue, SELL = orange (Kite convention) — green/red is reserved for P&L. */
export const SIDE_TONE: Record<TradeSide, { text: string; bg: string; solid: string; ring: string }> = {
  BUY: {
    text: "text-blue-500",
    bg: "bg-blue-500/10",
    solid: "bg-blue-600 hover:bg-blue-500 text-white",
    ring: "focus-visible:ring-blue-500/50",
  },
  SELL: {
    text: "text-orange-500",
    bg: "bg-orange-500/10",
    solid: "bg-orange-600 hover:bg-orange-500 text-white",
    ring: "focus-visible:ring-orange-500/50",
  },
};

export function statusLabel(t: Pick<Trade, "status" | "exitReason">): { label: string; tone: string } {
  switch (t.status) {
    case "PENDING":
      return { label: "Sending", tone: "bg-zinc-500/15 text-zinc-400" };
    case "ENTRY_PLACED":
      return { label: "Placed", tone: "bg-blue-500/15 text-blue-400" };
    case "OPEN":
      return { label: "Open", tone: "bg-sky-500/15 text-sky-400" };
    case "EXITING":
      return { label: "Exiting", tone: "bg-amber-500/15 text-amber-400" };
    case "REJECTED":
      return { label: "Rejected", tone: "bg-rose-500/15 text-rose-400" };
    case "FAILED":
      return { label: "Failed", tone: "bg-rose-500/15 text-rose-400" };
    case "UNPROTECTED":
      return { label: "No stop-loss", tone: "bg-rose-600 text-white" };
    case "CLOSED":
      switch (t.exitReason) {
        case "TARGET":
          return { label: "Target hit", tone: "bg-emerald-500/15 text-emerald-400" };
        case "STOP_LOSS":
          return { label: "Stop-loss hit", tone: "bg-rose-500/15 text-rose-400" };
        case "SQUARE_OFF":
          return { label: "Squared off", tone: "bg-zinc-500/15 text-zinc-300" };
        default:
          return { label: "Exited", tone: "bg-zinc-500/15 text-zinc-300" };
      }
  }
}

export const SETUP_LABEL: Record<string, { label: string; side: TradeSide | null }> = {
  BOUNCE_EXPECTED: { label: "Bounce off support", side: "BUY" },
  BREAKOUT_LIKELY: { label: "Breakout above resistance", side: "BUY" },
  REJECTION_POSSIBLE: { label: "Rejection at resistance", side: "SELL" },
  BREAKDOWN_RISK: { label: "Breakdown below support", side: "SELL" },
  NO_CLEAR_EDGE: { label: "Building", side: null },
};

export const EXIT_REASON_LABEL: Record<string, string> = {
  TARGET: "Target",
  STOP_LOSS: "Stop-loss",
  MANUAL: "Manual exit",
  SQUARE_OFF: "Auto square-off",
};
