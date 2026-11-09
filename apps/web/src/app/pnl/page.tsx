"use client";

/**
 * P&L — how your trades are doing: net P&L, win rate, profit factor, the
 * equity curve, and breakdowns by day, stock and exit reason.
 * Figures are NET: after estimated Zerodha charges (brokerage, STT, fees, GST, stamp).
 */
import { useCallback, useEffect, useState } from "react";
import { EquityChart } from "@/components/trading/equity-chart";
import { AdminOnly, ModePill, Segmented, usePolling, useTradeConfig } from "@/components/trading/ui";
import { EXIT_REASON_LABEL, pnlTone, signedInr, tradingApi, type Range, type TradeStats } from "@/lib/trading";

export default function PnlPage() {
  return (
    <AdminOnly>
      <Pnl />
    </AdminOnly>
  );
}

function Pnl() {
  const config = useTradeConfig();
  const mode = config?.mode ?? null; // global Paper / Real switch
  const [range, setRange] = useState<Range>("30d");
  const [stats, setStats] = useState<TradeStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setStats(null), [mode]);
  const load = useCallback(() => {
    if (!mode) return;
    tradingApi
      .stats(range, mode)
      .then((s) => {
        setStats(s);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [range, mode]);
  usePolling(load, 10_000, [load]);

  const rangeLabel = { today: "today", "7d": "in the last 7 days", "30d": "in the last 30 days", all: "all time" }[range];

  return (
    <main className="max-w-[1400px] mx-auto px-4 py-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">P&amp;L</h1>
          <p className="mt-1 text-sm text-muted-foreground">{mode === "PAPER" ? "Paper" : "Real"} trades, closed only (switch Paper / Real in the top bar). After estimated charges (brokerage, STT, exchange fees, GST, stamp duty).</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ModePill config={config} />
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

      {error && <p className="text-sm text-rose-400">{error}</p>}

      {!stats ? (
        <div className="h-80 rounded-xl bg-muted/30 animate-pulse" />
      ) : (
        <>
          {/* Headline + key numbers */}
          <section className="rounded-xl border border-border bg-card">
            <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
              <div>
                <div className="text-sm text-muted-foreground">Net P&amp;L {rangeLabel}</div>
                <div className={`mt-1 text-4xl font-semibold tracking-tight tabular-nums ${pnlTone(stats.netPnl)}`}>{signedInr(stats.netPnl)}</div>
                <div className="mt-2 text-sm text-muted-foreground">
                  {stats.closedTrades} closed {stats.closedTrades === 1 ? "trade" : "trades"}
                  {stats.closedTrades > 0 && (
                    <>
                      , {stats.wins} won, {stats.losses} lost
                    </>
                  )}
                </div>
              </div>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4 content-center">
                <Metric label="Win rate" value={stats.winRate != null ? `${stats.winRate}%` : "—"} />
                <Metric
                  label="Profit factor"
                  value={stats.profitFactor != null ? stats.profitFactor.toFixed(2) : "—"}
                  hint="Total won ÷ total lost. Above 1 means profitable."
                />
                <Metric label="Average win" value={stats.avgWin != null ? signedInr(stats.avgWin) : "—"} tone={pnlTone(stats.avgWin)} />
                <Metric label="Average loss" value={stats.avgLoss != null ? signedInr(stats.avgLoss) : "—"} tone={pnlTone(stats.avgLoss)} />
                <Metric label="Best trade" value={signedInr(stats.best)} tone={pnlTone(stats.best)} />
                <Metric label="Worst trade" value={signedInr(stats.worst)} tone={pnlTone(stats.worst)} />
                <Metric label="Open now" value={String(stats.openTrades)} />
                <Metric label="Rejected / failed" value={String(stats.rejected)} tone={stats.rejected > 0 ? "text-rose-400" : undefined} />
              </dl>
            </div>
            <div className="border-t border-border px-2 pt-3 pb-2">
              {stats.equity.length < 2 ? (
                <p className="px-3 py-10 text-center text-sm text-muted-foreground">The equity curve appears after your second closed trade.</p>
              ) : (
                <EquityChart points={stats.equity} />
              )}
            </div>
          </section>

          {/* Breakdowns */}
          <div className="grid gap-5 lg:grid-cols-3">
            <section className="rounded-xl border border-border bg-card lg:col-span-1">
              <h2 className="px-4 pt-4 pb-3 text-sm font-semibold text-foreground">How trades ended</h2>
              <ExitReasons byReason={stats.byReason} total={stats.closedTrades} />
            </section>
            <section className="rounded-xl border border-border bg-card">
              <h2 className="px-4 pt-4 pb-3 text-sm font-semibold text-foreground">By day</h2>
              <BreakdownTable
                rows={stats.byDay.map((d) => ({
                  key: d.date,
                  name: new Date(`${d.date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }),
                  ...d,
                }))}
                empty="No closed trades yet."
              />
            </section>
            <section className="rounded-xl border border-border bg-card">
              <h2 className="px-4 pt-4 pb-3 text-sm font-semibold text-foreground">By stock</h2>
              <BreakdownTable rows={stats.bySymbol.map((s) => ({ key: s.symbol, name: s.symbol, ...s }))} empty="No closed trades yet." />
            </section>
          </div>
        </>
      )}
    </main>
  );
}

function Metric({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div title={hint}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${tone ?? "text-foreground"}`}>{value}</dd>
    </div>
  );
}

function BreakdownTable({
  rows,
  empty,
}: {
  rows: { key: string; name: string; pnl: number; trades: number; wins: number }[];
  empty: string;
}) {
  if (rows.length === 0) return <p className="px-4 pb-6 text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(...rows.map((r) => Math.abs(r.pnl)), 1);
  return (
    <div className="max-h-80 overflow-y-auto">
      <table className="w-full text-sm tabular-nums">
        <thead className="sticky top-0 bg-card">
          <tr className="border-y border-border text-left text-xs text-muted-foreground">
            <th className="py-2 pl-4 pr-3 font-normal" />
            <th className="py-2 pr-3 font-normal text-right">Trades</th>
            <th className="py-2 pr-3 font-normal text-right">Won</th>
            <th className="py-2 pr-4 font-normal text-right">P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-border/50 last:border-0">
              <td className="py-2 pl-4 pr-3 text-foreground">{r.name}</td>
              <td className="py-2 pr-3 text-right text-muted-foreground">{r.trades}</td>
              <td className="py-2 pr-3 text-right text-muted-foreground">{r.wins}</td>
              <td className="py-2 pr-4 text-right">
                <div className={`font-medium ${pnlTone(r.pnl)}`}>{signedInr(r.pnl)}</div>
                <div className="ml-auto mt-1 h-1 w-20 rounded-full bg-muted overflow-hidden" aria-hidden>
                  <div className={`h-full ${r.pnl >= 0 ? "bg-emerald-500/70" : "bg-rose-500/70"}`} style={{ width: `${(Math.abs(r.pnl) / max) * 100}%` }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const REASON_TONE: Record<string, string> = {
  TARGET: "bg-emerald-500",
  STOP_LOSS: "bg-rose-500",
  MANUAL: "bg-sky-500",
  SQUARE_OFF: "bg-zinc-400",
};

function ExitReasons({ byReason, total }: { byReason: Record<string, number>; total: number }) {
  if (total === 0) return <p className="px-4 pb-6 text-sm text-muted-foreground">No closed trades yet.</p>;
  const entries = Object.entries(byReason).sort((a, b) => b[1] - a[1]);
  return (
    <div className="px-4 pb-5">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        {entries.map(([reason, n]) => (
          <div key={reason} className={REASON_TONE[reason] ?? "bg-zinc-600"} style={{ width: `${(n / total) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        {entries.map(([reason, n]) => (
          <li key={reason} className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-foreground">
              <span className={`size-2 rounded-full ${REASON_TONE[reason] ?? "bg-zinc-600"}`} />
              {EXIT_REASON_LABEL[reason] ?? reason}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {n} <span className="text-xs">({Math.round((n / total) * 100)}%)</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
