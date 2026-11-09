"use client";

/**
 * Orders — every trade you placed, its live status from Zerodha, and (click a
 * row) the Zerodha order ids plus every status change.
 */
import { useCallback, useEffect, useState } from "react";
import { TRADE_PLACED_EVENT } from "@/components/trading/order-window";
import { TradesTable } from "@/components/trading/trades-table";
import { AdminOnly, ModePill, Segmented, usePolling, useTradeConfig } from "@/components/trading/ui";
import { ACTIVE_STATUSES, tradingApi, type Range, type Trade } from "@/lib/trading";

type View = "all" | "active" | "closed" | "failed";

export default function OrdersPage() {
  return (
    <AdminOnly>
      <Orders />
    </AdminOnly>
  );
}

function Orders() {
  const config = useTradeConfig();
  const mode = config?.mode ?? null; // global Paper / Real switch
  const [range, setRange] = useState<Range>("today");
  const [view, setView] = useState<View>("all");
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setTrades(null), [mode]);
  const load = useCallback(() => {
    if (!mode) return;
    tradingApi
      .list(range, mode)
      .then((r) => {
        setTrades(r.trades);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [range, mode]);

  usePolling(load, 3000, [load]);
  useEffect(() => {
    window.addEventListener(TRADE_PLACED_EVENT, load);
    return () => window.removeEventListener(TRADE_PLACED_EVENT, load);
  }, [load]);

  const rows = (trades ?? []).filter((t) => {
    if (view === "active") return ACTIVE_STATUSES.has(t.status);
    if (view === "closed") return t.status === "CLOSED";
    if (view === "failed") return t.status === "REJECTED" || t.status === "FAILED";
    return true;
  });
  const count = (v: View) =>
    (trades ?? []).filter((t) =>
      v === "active" ? ACTIVE_STATUSES.has(t.status) : v === "closed" ? t.status === "CLOSED" : v === "failed" ? t.status === "REJECTED" || t.status === "FAILED" : true,
    ).length;

  return (
    <main className="max-w-[1400px] mx-auto px-4 py-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Orders</h1>
          <p className="mt-1 text-sm text-muted-foreground">{mode === "PAPER" ? "Your paper trades" : "Your real trades"} placed from this app. Switch Paper / Real in the top bar. Click a row to see its orders and history.</p>
        </div>
        <ModePill config={config} />
      </div>

      <section className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-border">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Order status">
            {(
              [
                ["all", "All"],
                ["active", "Active"],
                ["closed", "Closed"],
                ["failed", "Rejected"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={`h-8 px-3 rounded-md text-sm transition-colors ${
                  view === v ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
                <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{trades ? count(v) : ""}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Segmented
              label="Period"
              value={range}
              onChange={setRange}
              options={[
                { value: "today", label: "Today" },
                { value: "7d", label: "7 days" },
                { value: "30d", label: "30 days" },
                { value: "all", label: "All time" },
              ]}
            />
          </div>
        </div>

        {error ? (
          <p className="px-4 py-8 text-sm text-rose-400">{error}</p>
        ) : !trades ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 rounded-md bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : (
          <TradesTable
            trades={rows}
            onChanged={load}
            showDate={range !== "today"}
            empty={view === "all" ? "No orders in this period. Place one from the Trade screen or a stock's page." : "Nothing here for this filter."}
          />
        )}
      </section>
    </main>
  );
}
