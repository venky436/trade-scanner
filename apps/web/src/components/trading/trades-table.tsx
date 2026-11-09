"use client";

/**
 * Trades table — used by the Trade screen (today's positions) and the Orders page.
 * One row per trade; click a row to see its Zerodha orders and every status change.
 */
import { Fragment, useEffect, useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { useMarketData } from "@/hooks/use-market-data";
import {
  ACTIVE_STATUSES,
  AUTO_SETUP_PREFIX,
  EXIT_REASON_LABEL,
  isAutoTrade,
  SIDE_TONE,
  dateIst,
  inr,
  pnlTone,
  signedInr,
  statusLabel,
  timeIst,
  tradePnl,
  tradingApi,
  type Trade,
  type TradeEvent,
} from "@/lib/trading";
import { intradayCharges } from "@/lib/charges";

/**
 * What this trade makes / loses IF the stop-loss or the target is hit:
 *   buy:  (SL − entry) × qty   and  (target − entry) × qty
 *   sell: (entry − SL) × qty   and  (entry − target) × qty
 * Uses the fill price; before the fill, the price when you clicked.
 * null for failed / rejected orders (nothing was bought or sold).
 */
/** What you'd get at the stop-loss / target — NET of estimated charges. */
function slTargetOutcome(t: Trade): { atStopLoss: number; atTarget: number } | null {
  if (t.status === "FAILED" || t.status === "REJECTED") return null;
  const entry = t.entryPrice ?? t.ltpAtOrder;
  if (!entry) return null;
  const qty = t.filledQty ?? t.quantity;
  const dir = t.side === "BUY" ? 1 : -1;
  return {
    atStopLoss: (t.stopLoss - entry) * qty * dir - intradayCharges(t.side, qty, entry, t.stopLoss).total,
    atTarget: (t.target - entry) * qty * dir - intradayCharges(t.side, qty, entry, t.target).total,
  };
}

export function StatusChip({ trade }: { trade: Pick<Trade, "status" | "exitReason"> }) {
  const s = statusLabel(trade);
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium ${s.tone}`}>
      {trade.status === "UNPROTECTED" && <span className="size-1.5 rounded-full bg-white animate-pulse" />}
      {s.label}
    </span>
  );
}

export function SideTag({ side }: { side: Trade["side"] }) {
  return <span className={`text-xs font-semibold ${SIDE_TONE[side].text}`}>{side === "BUY" ? "Buy" : "Sell"}</span>;
}

export function TradesTable({
  trades,
  onChanged,
  showDate = false,
  empty,
}: {
  trades: Trade[];
  onChanged?: () => void;
  showDate?: boolean;
  empty: React.ReactNode;
}) {
  const { stockMap } = useMarketData();
  const [expanded, setExpanded] = useState<number | null>(null);

  if (trades.length === 0) return <div className="px-4 py-10 text-center text-sm text-muted-foreground">{empty}</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="w-8" />
            <th className="py-2 pr-3 font-normal">{showDate ? "Date" : "Time"}</th>
            <th className="py-2 pr-3 font-normal">Stock</th>
            <th className="py-2 pr-3 font-normal">Side</th>
            <th className="py-2 pr-3 font-normal text-right">Qty</th>
            <th className="py-2 pr-3 font-normal text-right">Entry</th>
            <th className="py-2 pr-3 font-normal text-right">Stop-loss</th>
            <th className="py-2 pr-3 font-normal text-right">Target</th>
            <th className="py-2 pr-3 font-normal text-right">Exit / LTP</th>
            <th className="py-2 pr-3 font-normal text-right">P&amp;L</th>
            <th className="py-2 pr-3 font-normal">Status</th>
            <th className="py-2 pr-3" />
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => {
            const ltp = stockMap.get(t.symbol)?.price ?? t.ltp ?? undefined;
            const pnl = tradePnl(t, ltp);
            const isOpen = t.status === "OPEN" || t.status === "UNPROTECTED";
            const isExpanded = expanded === t.id;
            const outcome = slTargetOutcome(t);
            return (
              <Fragment key={t.id}>
                <tr
                  onClick={() => setExpanded(isExpanded ? null : t.id)}
                  className={`border-b border-border/60 cursor-pointer hover:bg-muted/30 ${t.status === "UNPROTECTED" ? "bg-rose-500/5" : ""}`}
                >
                  <td className="pl-2">
                    <ChevronRight className={`size-3.5 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                  </td>
                  <td className="py-2.5 pr-3 text-muted-foreground whitespace-nowrap">
                    {showDate ? `${dateIst(t.createdAt)} ${timeIst(t.createdAt).slice(0, 5)}` : timeIst(t.createdAt)}
                  </td>
                  <td className="py-2.5 pr-3 whitespace-nowrap">
                    <span className="font-medium text-foreground">{t.symbol}</span>
                    {t.mode === "PAPER" && <span className="ml-1.5 rounded px-1 py-px text-[10px] text-amber-400 bg-amber-400/10">Paper</span>}
                    {isAutoTrade(t) && <span className="ml-1 rounded px-1 py-px text-[10px] text-sky-400 bg-sky-400/10">Auto</span>}
                  </td>
                  <td className="py-2.5 pr-3">
                    <SideTag side={t.side} />
                  </td>
                  <td className="py-2.5 pr-3 text-right">{t.filledQty ?? t.quantity}</td>
                  <td className="py-2.5 pr-3 text-right">{inr(t.entryPrice)}</td>
                  <td className="py-2.5 pr-3 text-right">
                    <div className="text-muted-foreground">{inr(t.stopLoss)}</div>
                    {outcome && <div className="text-xs text-rose-500">{signedInr(outcome.atStopLoss)}</div>}
                  </td>
                  <td className="py-2.5 pr-3 text-right">
                    <div className="text-muted-foreground">{inr(t.target)}</div>
                    {outcome && <div className="text-xs text-emerald-500">{signedInr(outcome.atTarget)}</div>}
                  </td>
                  <td className="py-2.5 pr-3 text-right">
                    {t.status === "CLOSED" ? inr(t.exitPrice) : isOpen && ltp ? <span className="text-muted-foreground">{inr(ltp)}</span> : "—"}
                  </td>
                  <td className={`py-2.5 pr-3 text-right font-medium ${pnlTone(pnl)}`}>{signedInr(pnl)}</td>
                  <td className="py-2.5 pr-3">
                    <StatusChip trade={t} />
                  </td>
                  <td className="py-2.5 pr-3 text-right" onClick={(e) => e.stopPropagation()}>
                    {isOpen && <ExitButton trade={t} onDone={onChanged} />}
                    {t.status === "ENTRY_PLACED" && t.mode === "LIVE" && <ExitButton trade={t} onDone={onChanged} cancel />}
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="border-b border-border/60 bg-muted/20">
                    <td />
                    <td colSpan={11} className="py-3 pr-3">
                      <TradeDetails trade={t} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ExitButton({ trade, onDone, cancel = false }: { trade: Trade; onDone?: () => void; cancel?: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exit() {
    setBusy(true);
    setError(null);
    try {
      await tradingApi.exit(trade.id);
      setConfirming(false);
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="h-7 px-2.5 rounded-md border border-border text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {cancel ? "Cancel" : "Exit"}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {error && <span className="text-xs text-rose-400 max-w-48 truncate" title={error}>{error}</span>}
      <button onClick={() => setConfirming(false)} disabled={busy} className="h-7 px-2 rounded-md text-xs text-muted-foreground hover:text-foreground">
        Keep
      </button>
      <button onClick={() => void exit()} disabled={busy} className="h-7 px-2.5 rounded-md text-xs font-semibold bg-rose-600 text-white hover:bg-rose-500">
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : cancel ? "Cancel order" : "Exit at market"}
      </button>
    </span>
  );
}

/** Zerodha orders of one trade + every status change, oldest first. */
function TradeDetails({ trade }: { trade: Trade }) {
  const [events, setEvents] = useState<TradeEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      tradingApi
        .get(trade.id)
        .then((r) => active && setEvents(r.events))
        .catch((e: Error) => active && setError(e.message));
    void load();
    // keep the timeline fresh while the trade is still moving
    const t = ACTIVE_STATUSES.has(trade.status) ? setInterval(load, 3000) : undefined;
    return () => {
      active = false;
      if (t) clearInterval(t);
    };
  }, [trade.id, trade.status]);

  const legs = [
    { name: "Entry", id: trade.entryOrderId, status: trade.entryStatus, detail: trade.entryPrice != null ? `filled at ${inr(trade.entryPrice)}` : "market" },
    { name: "Stop-loss", id: trade.slOrderId, status: trade.slStatus, detail: `SL-M trigger ${inr(trade.stopLoss)}` },
    { name: "Target", id: trade.targetOrderId, status: trade.targetStatus, detail: `limit ${inr(trade.target)}` },
    { name: "Exit", id: trade.exitOrderId, status: trade.exitStatus, detail: trade.exitReason ? EXIT_REASON_LABEL[trade.exitReason] : "" },
  ].filter((l) => l.id);

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div>
        <h4 className="text-xs text-muted-foreground mb-2">Zerodha orders</h4>
        {trade.statusMessage && <p className="mb-2 text-sm text-rose-400">{trade.statusMessage}</p>}
        {legs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No order reached Zerodha.</p>
        ) : (
          <table className="w-full text-xs">
            <tbody>
              {legs.map((l) => (
                <tr key={l.name} className="border-b border-border/40 last:border-0">
                  <td className="py-1.5 pr-3 text-foreground">{l.name}</td>
                  <td className="py-1.5 pr-3 font-mono text-muted-foreground">{l.id}</td>
                  <td className="py-1.5 pr-3 text-foreground">{l.status ?? "—"}</td>
                  <td className="py-1.5 text-muted-foreground">{l.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Price when placed</dt>
          <dd className="text-right">{inr(trade.ltpAtOrder)}</dd>
          <dt className="text-muted-foreground">Margin blocked</dt>
          <dd className="text-right">{inr(trade.marginRequired)}</dd>
          {trade.status === "CLOSED" && trade.grossPnl != null && (
            <>
              <dt className="text-muted-foreground">P&amp;L before charges</dt>
              <dd className="text-right">{signedInr(trade.grossPnl)}</dd>
              <dt className="text-muted-foreground">Est. charges (brokerage, STT, fees, GST, stamp)</dt>
              <dd className="text-right">{trade.charges != null ? `−${inr(trade.charges)}` : "—"}</dd>
              <dt className="text-muted-foreground">P&amp;L after charges</dt>
              <dd className={`text-right font-medium ${pnlTone(trade.pnl ?? 0)}`}>{signedInr(trade.pnl)}</dd>
            </>
          )}
          {trade.setup && (
            <>
              <dt className="text-muted-foreground">Scanner setup</dt>
              <dd className="text-right">
                {isAutoTrade(trade) ? "Auto · " : ""}
                {trade.setup.replace(AUTO_SETUP_PREFIX, "").replaceAll("_", " ").toLowerCase()}
                {trade.confidence != null ? ` (${Math.round(trade.confidence * 100)}%)` : ""}
              </dd>
            </>
          )}
        </dl>
      </div>
      <div>
        <h4 className="text-xs text-muted-foreground mb-2">What happened</h4>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        {!events && !error && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        {events && (
          <ol className="space-y-1.5">
            {events.map((e) => (
              <li key={e.id} className="flex gap-3 text-xs">
                <span className="w-16 shrink-0 tabular-nums text-muted-foreground">{timeIst(e.at)}</span>
                <span className={e.type === "ERROR" || e.type === "WARNING" ? "text-rose-400" : "text-foreground"}>{e.message ?? e.type}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
