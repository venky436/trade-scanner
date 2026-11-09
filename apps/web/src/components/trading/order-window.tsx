"use client";

/**
 * Order window — the ONE place where a BUY / SELL is placed.
 *
 * Open it from anywhere (Trade screen, stock details page, …):
 *
 *   const { openOrder } = useOrderWindow();
 *   openOrder({ symbol: "RELIANCE", side: "BUY", stopLoss: 1310, target: 1350 });
 *
 * Intraday (MIS) market order + stop-loss + target. Shows margin needed vs
 * available (from Zerodha), max quantity, risk and reward before you place.
 * LIVE mode asks for a second confirmation; PAPER places straight away.
 */
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, Minus, Plus, ShieldAlert, X, XCircle } from "lucide-react";
import { useMarketData } from "@/hooks/use-market-data";
import { useAuth } from "@/context/auth-context";
import {
  SIDE_TONE,
  inr,
  pct,
  statusLabel,
  tradingApi,
  type MarginQuote,
  type Trade,
  type TradeConfig,
  type TradeSide,
} from "@/lib/trading";

export interface OrderRequest {
  symbol: string;
  side: TradeSide;
  stopLoss?: number;
  target?: number;
  setup?: string | null;
  confidence?: number | null;
}

interface OrderWindowContextValue {
  openOrder: (req: OrderRequest) => void;
  /** Admin only — use to hide Buy/Sell buttons for everyone else. */
  canTrade: boolean;
}

const OrderWindowContext = createContext<OrderWindowContextValue>({ openOrder: () => {}, canTrade: false });

/** Fired on window after a trade is placed — lists refresh on it. */
export const TRADE_PLACED_EVENT = "trading:trade-placed";

export function useOrderWindow() {
  return useContext(OrderWindowContext);
}

export function OrderWindowProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [request, setRequest] = useState<OrderRequest | null>(null);
  const canTrade = user?.role === "ADMIN";
  const openOrder = useCallback((req: OrderRequest) => setRequest(req), []);
  const value = useMemo(() => ({ openOrder, canTrade }), [openOrder, canTrade]);

  return (
    <OrderWindowContext.Provider value={value}>
      {children}
      {request && canTrade && <OrderWindow key={`${request.symbol}-${request.side}`} request={request} onClose={() => setRequest(null)} />}
    </OrderWindowContext.Provider>
  );
}

// ── the window ───────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;
const toTick = (n: number, tick: number) => round2(Math.round(n / tick) * tick);

function OrderWindow({ request, onClose }: { request: OrderRequest; onClose: () => void }) {
  const { stockMap } = useMarketData();
  const [side, setSide] = useState<TradeSide>(request.side);
  const [qtyText, setQtyText] = useState("1");
  const [slText, setSlText] = useState(request.stopLoss != null ? String(request.stopLoss) : "");
  const [tgText, setTgText] = useState(request.target != null ? String(request.target) : "");
  const [config, setConfig] = useState<TradeConfig | null>(null);
  const [quote, setQuote] = useState<MarginQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [step, setStep] = useState<"form" | "confirm" | "result">("form");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Trade | null>(null);
  const qtyRef = useRef<HTMLInputElement>(null);

  const live = stockMap.get(request.symbol);
  const ltp = live?.price ?? quote?.ltp ?? 0;
  const change = live?.change;
  const tick = quote?.tickSize ?? 0.05;
  const tone = SIDE_TONE[side];

  // Config (PAPER / LIVE) once; margin + funds now and every 5 s
  useEffect(() => {
    tradingApi.config().then(setConfig).catch(() => {});
  }, []);
  useEffect(() => {
    let active = true;
    const load = () =>
      tradingApi
        .margin(request.symbol, side)
        .then((q) => {
          if (!active) return;
          setQuote(q);
          setQuoteError(null);
        })
        .catch((e: Error) => active && setQuoteError(e.message));
    void load();
    const t = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [request.symbol, side]);

  // Default stop-loss / target (1% / 2%) once a price is known, if none were passed
  const defaultsSet = useRef(request.stopLoss != null && request.target != null);
  useEffect(() => {
    if (defaultsSet.current || ltp <= 0) return;
    defaultsSet.current = true;
    const sl = side === "BUY" ? ltp * 0.99 : ltp * 1.01;
    const tg = side === "BUY" ? ltp * 1.02 : ltp * 0.98;
    setSlText(String(toTick(sl, tick)));
    setTgText(String(toTick(tg, tick)));
  }, [ltp, side, tick]);

  // Suggested prices (from the scanner's plan) → round to the stock's real tick
  // once Zerodha's tick size is known, so what you see is what gets placed.
  const tickRounded = useRef(false);
  useEffect(() => {
    if (tickRounded.current || !quote) return;
    tickRounded.current = true;
    const round = (t: string) => (Number(t) > 0 ? String(toTick(Number(t), quote.tickSize)) : t);
    setSlText(round);
    setTgText(round);
  }, [quote]);

  useEffect(() => qtyRef.current?.select(), []);

  // Esc closes (not while sending)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  /** Switching side mirrors stop-loss and target around the price. */
  function switchSide(next: TradeSide) {
    if (next === side) return;
    const sl = Number(slText);
    const tg = Number(tgText);
    if (ltp > 0 && sl > 0 && tg > 0) {
      setSlText(String(toTick(ltp + (ltp - sl), tick)));
      setTgText(String(toTick(ltp - (tg - ltp), tick)));
    }
    setSide(next);
    setSubmitError(null);
    setStep("form");
  }

  const qty = Math.floor(Number(qtyText) || 0);
  const sl = Number(slText);
  const tg = Number(tgText);
  const marginNeeded = quote ? qty * quote.marginPerShare : null;
  const risk = ltp > 0 && sl > 0 ? Math.abs(ltp - sl) * qty : null;
  const reward = ltp > 0 && tg > 0 ? Math.abs(tg - ltp) * qty : null;
  const rr = risk && reward ? reward / risk : null;

  const problems: string[] = [];
  if (qty < 1) problems.push("Enter a quantity of at least 1.");
  if (quote && qty > quote.maxQty) problems.push(`Not enough margin — you can buy at most ${quote.maxQty}.`);
  if (ltp > 0 && sl > 0 && tg > 0) {
    if (side === "BUY" && !(sl < ltp && tg > ltp)) problems.push("For a buy, stop-loss goes below the price and target above it.");
    if (side === "SELL" && !(sl > ltp && tg < ltp)) problems.push("For a sell, stop-loss goes above the price and target below it.");
  } else {
    problems.push("Enter a stop-loss and a target.");
  }
  const canSubmit = problems.length === 0 && !!quote && !submitting;
  const isLive = config?.mode === "LIVE";

  async function place() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { trade } = await tradingApi.place({
        symbol: request.symbol,
        side,
        quantity: qty,
        stopLoss: sl,
        target: tg,
        setup: request.setup ?? null,
        confidence: request.confidence ?? null,
      });
      setPlaced(trade);
      setStep("result");
      window.dispatchEvent(new Event(TRADE_PLACED_EVENT));
    } catch (e) {
      setSubmitError((e as Error).message);
      setStep("form");
    } finally {
      setSubmitting(false);
    }
  }

  function onPrimary() {
    if (!canSubmit) return;
    if (isLive && step === "form") setStep("confirm");
    else void place();
  }

  const action = side === "BUY" ? "Buy" : "Sell";

  const orderValue = ltp > 0 && qty > 0 ? ltp * qty : null;
  const marginShare = quote && marginNeeded != null && quote.available > 0 ? marginNeeded / quote.available : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-[3px] p-0 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-window-title"
        className="w-full sm:max-w-[520px] max-h-[100dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-border bg-card shadow-2xl shadow-black/50 animate-in fade-in-0 slide-in-from-bottom-4 sm:zoom-in-95 duration-150"
      >
        {/* Header — tinted by side: you always know which way you're trading */}
        <div
          className={`border-t-[3px] px-6 pt-5 pb-4 ${
            side === "BUY" ? "border-t-blue-600 bg-blue-500/[0.06]" : "border-t-orange-600 bg-orange-500/[0.06]"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 id="order-window-title" className="text-xl font-semibold tracking-tight text-foreground truncate">
                  {request.symbol}
                </h2>
                <span className="rounded border border-border px-1.5 py-px text-[11px] text-muted-foreground">NSE</span>
              </div>
              <div className="mt-1 flex items-baseline gap-2 tabular-nums">
                <span className="text-2xl font-semibold text-foreground">{ltp > 0 ? inr(ltp) : "—"}</span>
                {change != null && (
                  <span className={`text-sm font-medium ${change >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{pct(change)}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-xl bg-background/60 p-1 ring-1 ring-border" role="radiogroup" aria-label="Order side">
                {(["BUY", "SELL"] as const).map((s) => (
                  <button
                    key={s}
                    role="radio"
                    aria-checked={side === s}
                    onClick={() => switchSide(s)}
                    disabled={step === "result"}
                    className={`h-9 px-5 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 ${SIDE_TONE[s].ring} ${
                      side === s ? SIDE_TONE[s].solid : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s === "BUY" ? "Buy" : "Sell"}
                  </button>
                ))}
              </div>
              <button
                onClick={onClose}
                disabled={submitting}
                aria-label="Close order window"
                className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-5" />
              </button>
            </div>
          </div>
          {/* Product + type — fixed for now, shown so there's no doubt */}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-md bg-background/60 ring-1 ring-border px-2 py-1 text-foreground">Intraday (MIS)</span>
            <span className="rounded-md bg-background/60 ring-1 ring-border px-2 py-1 text-foreground">Market order</span>
            {quote && <span className="px-1 text-muted-foreground">{quote.leverage.toFixed(1)}× leverage</span>}
          </div>
        </div>

        {step === "result" && placed ? (
          <ResultView trade={placed} onClose={onClose} />
        ) : step === "confirm" ? (
          <ConfirmView
            symbol={request.symbol}
            squareOffAt={config?.squareOffAt ?? ""}
            side={side}
            qty={qty}
            ltp={ltp}
            sl={sl}
            tg={tg}
            marginNeeded={marginNeeded}
            submitting={submitting}
            onBack={() => setStep("form")}
            onConfirm={() => void place()}
          />
        ) : (
          <>
            <div className="px-6 py-5 space-y-6">
              {/* Quantity */}
              <div>
                <div className="flex items-baseline justify-between">
                  <label htmlFor="ow-qty" className="text-sm font-medium text-foreground">
                    Quantity
                  </label>
                  {quote && <span className="text-xs text-muted-foreground tabular-nums">up to {quote.maxQty} shares</span>}
                </div>
                <div className="mt-2 flex items-stretch rounded-xl border border-input bg-background/40 focus-within:ring-2 focus-within:ring-ring/40">
                  <button
                    onClick={() => setQtyText(String(Math.max(1, qty - 1)))}
                    aria-label="Decrease quantity"
                    className="px-5 text-muted-foreground hover:text-foreground"
                  >
                    <Minus className="size-5" />
                  </button>
                  <input
                    id="ow-qty"
                    ref={qtyRef}
                    inputMode="numeric"
                    value={qtyText}
                    onChange={(e) => setQtyText(e.target.value.replace(/[^\d]/g, ""))}
                    onKeyDown={(e) => e.key === "Enter" && onPrimary()}
                    className="w-full bg-transparent text-center text-3xl font-semibold tabular-nums py-3 focus:outline-none"
                  />
                  <button
                    onClick={() => setQtyText(String(qty + 1))}
                    aria-label="Increase quantity"
                    className="px-5 text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="size-5" />
                  </button>
                </div>
                {quote && quote.maxQty > 0 && (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {[
                      { label: "25%", q: Math.max(1, Math.floor(quote.maxQty * 0.25)) },
                      { label: "50%", q: Math.max(1, Math.floor(quote.maxQty * 0.5)) },
                      { label: "Max", q: quote.maxQty },
                    ].map((o) => (
                      <button
                        key={o.label}
                        onClick={() => setQtyText(String(o.q))}
                        className={`h-8 rounded-lg text-xs tabular-nums transition-colors ring-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          qty === o.q ? `${SIDE_TONE[side].bg} ${SIDE_TONE[side].text} ring-transparent font-semibold` : "ring-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {o.label} · {o.q}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Stop-loss + target */}
              <div className="grid grid-cols-2 gap-4">
                <PriceField id="ow-sl" label="Stop-loss" value={slText} onChange={setSlText} ltp={ltp} kind="loss" />
                <PriceField id="ow-tg" label="Target" value={tgText} onChange={setTgText} ltp={ltp} kind="gain" />
              </div>

              {/* Risk ←entry→ reward, to scale */}
              <RiskRewardBar risk={risk} reward={reward} rr={rr} />

              {/* Margin */}
              <div className="rounded-xl bg-muted/40 px-4 py-3">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-muted-foreground">Margin needed</span>
                  <span className="tabular-nums">
                    <span className="font-semibold text-foreground">{inr(marginNeeded)}</span>
                    <span className="text-muted-foreground"> of {inr(quote?.available)}{quote?.mode === "PAPER" ? " (paper)" : ""}</span>
                  </span>
                </div>
                {marginShare != null && (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-background" aria-hidden>
                    <div
                      className={`h-full rounded-full ${marginShare > 1 ? "bg-rose-500" : side === "BUY" ? "bg-blue-500" : "bg-orange-500"}`}
                      style={{ width: `${Math.min(100, marginShare * 100)}%` }}
                    />
                  </div>
                )}
                {quote?.estimated && <p className="mt-1.5 text-xs text-muted-foreground">Estimated — Zerodha's margin figure wasn't available.</p>}
              </div>

              {(quoteError || submitError || (problems.length > 0 && qtyText !== "")) && (
                <p role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
                  {submitError ?? quoteError ?? problems[0]}
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-border px-6 py-4 flex items-center justify-between gap-4">
              <ModeNote mode={config?.mode} />
              <button
                onClick={onPrimary}
                disabled={!canSubmit}
                className={`h-12 min-w-48 px-6 rounded-xl font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 ${tone.solid} ${tone.ring}`}
              >
                {submitting ? (
                  <Loader2 className="size-5 animate-spin mx-auto" />
                ) : (
                  <span className="flex flex-col items-center leading-tight">
                    <span className="text-base">
                      {action} {qty > 0 ? qty : ""} {qty === 1 ? "share" : "shares"}
                    </span>
                    {orderValue != null && <span className="text-xs font-normal opacity-80 tabular-nums">worth {inr(orderValue, true)}</span>}
                  </span>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PriceField({
  id,
  label,
  value,
  onChange,
  ltp,
  kind,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  ltp: number;
  kind: "loss" | "gain";
}) {
  const n = Number(value);
  const distance = ltp > 0 && n > 0 ? ((n - ltp) / ltp) * 100 : null;
  const tone = kind === "loss" ? "text-rose-400" : "text-emerald-400";
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {distance != null && <span className={`text-xs tabular-nums ${tone}`}>{pct(distance)}</span>}
      </div>
      <div
        className={`mt-2 flex items-center rounded-xl border border-input border-l-4 bg-background/40 focus-within:ring-2 focus-within:ring-ring/40 ${
          kind === "loss" ? "border-l-rose-500/70" : "border-l-emerald-500/70"
        }`}
      >
        <span className="pl-3 text-muted-foreground">₹</span>
        <input
          id={id}
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
          className="w-full bg-transparent px-2 py-3 text-lg font-medium tabular-nums focus:outline-none"
        />
      </div>
    </div>
  );
}

/** Loss if the stop-loss hits ← entry → profit if the target hits, drawn to scale. */
function RiskRewardBar({ risk, reward, rr }: { risk: number | null; reward: number | null; rr: number | null }) {
  if (risk == null || reward == null || risk + reward <= 0) return null;
  const riskPct = (risk / (risk + reward)) * 100;
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full" aria-hidden>
        <div className="h-full bg-rose-500/80" style={{ width: `${riskPct}%` }} />
        <div className="h-full w-0.5 bg-foreground" />
        <div className="h-full flex-1 bg-emerald-500/80" />
      </div>
      <div className="mt-2 flex items-start justify-between text-sm tabular-nums">
        <div>
          <div className="font-semibold text-rose-400">−{inr(risk)}</div>
          <div className="text-xs text-muted-foreground">if stop-loss hits</div>
        </div>
        {rr != null && (
          <div className="text-center">
            <div className="font-semibold text-foreground">1 : {rr.toFixed(1)}</div>
            <div className="text-xs text-muted-foreground">risk : reward</div>
          </div>
        )}
        <div className="text-right">
          <div className="font-semibold text-emerald-400">+{inr(reward)}</div>
          <div className="text-xs text-muted-foreground">if target hits</div>
        </div>
      </div>
    </div>
  );
}

function ModeNote({ mode }: { mode: TradeConfig["mode"] | undefined }) {
  if (!mode) return <span />;
  return mode === "LIVE" ? (
    <span className="flex items-center gap-2 text-sm text-rose-400">
      <span className="size-2 rounded-full bg-rose-500 animate-pulse" />
      Real order on Zerodha
    </span>
  ) : (
    <span className="flex items-center gap-2 text-sm text-amber-400">
      <span className="size-2 rounded-full bg-amber-400" />
      Paper — simulated
    </span>
  );
}

function ConfirmView(props: {
  symbol: string;
  squareOffAt: string;
  side: TradeSide;
  qty: number;
  ltp: number;
  sl: number;
  tg: number;
  marginNeeded: number | null;
  submitting: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const action = props.side === "BUY" ? "Buy" : "Sell";
  return (
    <>
      <div className="px-6 py-5">
        <div className="flex gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4">
          <ShieldAlert className="size-5 shrink-0 text-rose-500" />
          <div className="text-sm">
            <p className="font-medium text-foreground">This places a real order on your Zerodha account.</p>
            <p className="mt-1 text-muted-foreground">
              {action} {props.qty} {props.symbol} at market (about {inr(props.ltp)}), stop-loss {inr(props.sl)}, target {inr(props.tg)}.
              Margin blocked: {inr(props.marginNeeded)}. Open positions are closed automatically at {props.squareOffAt}.
            </p>
          </div>
        </div>
      </div>
      <div className="border-t border-border px-6 py-4 flex items-center justify-end gap-2">
        <button onClick={props.onBack} disabled={props.submitting} className="h-10 px-4 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted">
          Back
        </button>
        <button
          onClick={props.onConfirm}
          disabled={props.submitting}
          className={`h-12 min-w-48 px-6 rounded-xl text-base font-semibold ${SIDE_TONE[props.side].solid} disabled:opacity-50`}
        >
          {props.submitting ? <Loader2 className="size-4 animate-spin mx-auto" /> : `Place real ${action.toLowerCase()} order`}
        </button>
      </div>
    </>
  );
}

function ResultView({ trade, onClose }: { trade: Trade; onClose: () => void }) {
  const failed = trade.status === "FAILED" || trade.status === "REJECTED";
  const s = statusLabel(trade);
  return (
    <>
      <div className="px-6 pb-6 pt-5 text-center">
        {failed ? <XCircle className="mx-auto size-10 text-rose-500" /> : <CheckCircle2 className="mx-auto size-10 text-emerald-500" />}
        <p className="mt-3 font-semibold text-foreground">{failed ? "Order not placed" : trade.mode === "PAPER" ? "Paper trade opened" : "Order sent to Zerodha"}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {trade.side === "BUY" ? "Buy" : "Sell"} {trade.quantity} {trade.symbol}
          {trade.entryPrice != null ? ` filled at ${inr(trade.entryPrice)}` : ""}
        </p>
        <span className={`mt-3 inline-block rounded-md px-2 py-0.5 text-xs font-medium ${s.tone}`}>{s.label}</span>
        {trade.statusMessage && <p className="mt-3 text-sm text-rose-400">{trade.statusMessage}</p>}
        {!failed && trade.mode === "LIVE" && (
          <p className="mt-3 text-xs text-muted-foreground">Stop-loss and target are placed automatically once the entry fills. Follow it in Orders.</p>
        )}
      </div>
      <div className="border-t border-border px-6 py-4 flex items-center justify-end gap-2">
        <Link href="/orders" onClick={onClose} className="h-10 px-4 inline-flex items-center rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted">
          View orders
        </Link>
        <button onClick={onClose} className="h-10 px-5 rounded-lg text-sm font-semibold bg-foreground text-background hover:opacity-90">
          Done
        </button>
      </div>
    </>
  );
}
