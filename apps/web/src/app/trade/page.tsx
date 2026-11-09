"use client";

/**
 * Trade — the stocks most aligned across all engines, sitting at support or
 * resistance with a clear bounce / breakout / rejection / breakdown setup.
 * Buy / Sell opens the order window; today's positions are listed below.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Minus, RefreshCw } from "lucide-react";
import { useMarketData } from "@/hooks/use-market-data";
import { TRADE_PLACED_EVENT, useOrderWindow } from "@/components/trading/order-window";
import { TradesTable } from "@/components/trading/trades-table";
import { AutoTraderPanel } from "@/components/trading/auto-trader-panel";
import { AdminOnly, ModePill, SectionHeader, usePolling, useTradeConfig } from "@/components/trading/ui";
import {
  SETUP_LABEL,
  SIDE_TONE,
  inr,
  pct,
  pnlTone,
  signedInr,
  tradePnl,
  tradingApi,
  type Setup,
  type SetupsResponse,
  type Trade,
  type TradeSide,
} from "@/lib/trading";

/** "On watch" lists only stocks at this confidence or higher. */
const WATCH_MIN_CONFIDENCE = 0.75;

export default function TradePage() {
  return (
    <AdminOnly>
      <TradeDesk />
    </AdminOnly>
  );
}

function TradeDesk() {
  const config = useTradeConfig();
  const { stockMap } = useMarketData();
  const [setups, setSetups] = useState<SetupsResponse | null>(null);
  const [setupsError, setSetupsError] = useState<string | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadSetups = useCallback(async () => {
    setRefreshing(true);
    try {
      setSetups(await tradingApi.setups(10));
      setSetupsError(null);
    } catch (e) {
      setSetupsError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);
  const mode = config?.mode ?? null; // global Paper / Real switch
  useEffect(() => setTrades([]), [mode]);
  const loadTrades = useCallback(() => {
    if (!mode) return;
    tradingApi
      .list("today", mode)
      .then((r) => setTrades(r.trades))
      .catch(() => {});
  }, []);

  usePolling(() => void loadSetups(), 5000);
  usePolling(loadTrades, 3000);
  useEffect(() => {
    window.addEventListener(TRADE_PLACED_EVENT, loadTrades);
    return () => window.removeEventListener(TRADE_PLACED_EVENT, loadTrades);
  }, [loadTrades]);

  const watch = (setups?.watch ?? []).filter((s) => s.confidence >= WATCH_MIN_CONFIDENCE);
  const unprotected = trades.filter((t) => t.status === "UNPROTECTED");
  const open = trades.filter((t) => t.status === "OPEN" || t.status === "UNPROTECTED");
  const dayPnl = trades.reduce((sum, t) => sum + (tradePnl(t, stockMap.get(t.symbol)?.price ?? t.ltp ?? undefined) ?? 0), 0);

  return (
    <main className="max-w-[1400px] mx-auto px-4 py-6 space-y-5">
      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Trade</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Intraday setups at support and resistance. Orders are MIS with a stop-loss and target
            {config ? `, new entries ${config.entryWindow}, everything closed at ${config.squareOffAt}.` : "."}
          </p>
        </div>
        <div className="flex items-center gap-5 text-sm">
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Today&apos;s P&amp;L</div>
            <div className={`font-semibold tabular-nums ${pnlTone(dayPnl)}`}>{signedInr(dayPnl)}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Open positions</div>
            <div className="font-semibold tabular-nums text-foreground">{open.length}</div>
          </div>
          <ModePill config={config} />
        </div>
      </div>

      {unprotected.length > 0 && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3">
          <AlertTriangle className="size-5 shrink-0 text-rose-500 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-foreground">
              {unprotected.map((t) => t.symbol).join(", ")} {unprotected.length === 1 ? "has" : "have"} no working stop-loss.
            </p>
            <p className="text-muted-foreground">{unprotected[0]!.statusMessage ?? "Exit the position below or in Kite."}</p>
          </div>
        </div>
      )}

      <AutoTraderPanel />

      {/* Setups */}
      <section className="rounded-xl border border-border bg-card">
        <SectionHeader
          title="Ready to trade"
          note={`At support or resistance, the level has answered (bounce / rejection / break), momentum and pressure agree, confidence 70%+, confirmation candle volume ≥ ${setups?.rules?.volumeMult ?? 1.2}× average, price still within 1.5 typical candles of the level. Stop-loss just beyond the level, target 2× the risk. New calls ${setups?.rules?.window ?? "09:30–14:00"} IST only. Highest confidence first.`}
          right={
            <button
              onClick={() => void loadSetups()}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
          }
        />
        {setupsError ? (
          <p className="px-4 pb-6 text-sm text-rose-400">{setupsError}</p>
        ) : !setups ? (
          <SetupsSkeleton />
        ) : setups.poolSize === 0 ? (
          <EmptyState>
            No live prices yet. <span className="text-foreground">Connect Kite</span> in the top bar — setups appear once prices stream in.
          </EmptyState>
        ) : setups.rules && !setups.rules.inWindow ? (
          <EmptyState>
            Outside the call window. New calls are made <span className="text-foreground">{setups.rules.window} IST</span> only. Stocks
            building a setup are listed under &quot;On watch&quot;.
          </EmptyState>
        ) : setups.ready.length === 0 ? (
          <EmptyState>
            No stock has a ready setup right now. This list fills as stocks react at support or resistance with momentum, pressure and
            volume agreeing.
          </EmptyState>
        ) : (
          <SetupTable setups={setups.ready} rankStart={1} />
        )}
      </section>

      {watch.length > 0 && (
        <section className="rounded-xl border border-border bg-card">
          <SectionHeader
            title="On watch"
            note={`At a level with ${Math.round(WATCH_MIN_CONFIDENCE * 100)}%+ confidence, not confirmed yet — wait for the level to answer.`}
          />
          <SetupTable setups={watch} compact />
        </section>
      )}

      {/* Today's trades */}
      <section className="rounded-xl border border-border bg-card">
        <SectionHeader
          title="Today's trades"
          right={
            <Link href="/orders" className="text-xs text-muted-foreground hover:text-foreground">
              All orders
            </Link>
          }
        />
        <TradesTable trades={trades} onChanged={loadTrades} empty="No trades today. Pick a setup above to place one." />
      </section>
    </main>
  );
}

// ── setups table ─────────────────────────────────────────────────────────────

function SetupTable({ setups, compact = false, rankStart }: { setups: Setup[]; compact?: boolean; rankStart?: number }) {
  const { stockMap } = useMarketData();
  const { openOrder } = useOrderWindow();

  function open(s: Setup, side: TradeSide) {
    const plan = s.tradePlan && s.tradePlan.action === side ? s.tradePlan : null;
    openOrder({
      symbol: s.symbol,
      side,
      stopLoss: plan?.stopLoss,
      target: plan?.target,
      setup: s.outlook,
      confidence: s.confidence,
    });
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="border-y border-border text-left text-xs text-muted-foreground">
            {rankStart != null && <th className="py-2 pl-4 pr-2 font-normal w-8">#</th>}
            <th className={`py-2 pr-3 font-normal ${rankStart == null ? "pl-4" : ""}`}>Stock</th>
            <th className="py-2 pr-3 font-normal text-right">LTP</th>
            <th className="py-2 pr-3 font-normal">Level</th>
            <th className="py-2 pr-3 font-normal">Momentum</th>
            <th className="py-2 pr-3 font-normal">Pressure</th>
            <th className="py-2 pr-3 font-normal">Confidence</th>
            {!compact && <th className="py-2 pr-3 font-normal text-right">Stop-loss / Target</th>}
            <th className="py-2 pr-4 font-normal text-right">Order</th>
          </tr>
        </thead>
        <tbody>
          {setups.map((s, i) => {
            const live = stockMap.get(s.symbol);
            const price = live?.price ?? s.price;
            const change = live?.change ?? s.change;
            const setup = SETUP_LABEL[s.outlook] ?? SETUP_LABEL.NO_CLEAR_EDGE!;
            const suggested = s.tradePlan?.action ?? setup.side;
            const levelName = s.context.zone === "NEAR_SUPPORT" ? "Support" : "Resistance";
            return (
              <tr key={s.symbol} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                {rankStart != null && <td className="py-3 pl-4 pr-2 text-muted-foreground">{rankStart + i}</td>}
                <td className={`py-3 pr-3 ${rankStart == null ? "pl-4" : ""}`}>
                  <Link href={`/stock/${encodeURIComponent(s.symbol)}`} className="font-medium text-foreground hover:underline">
                    {s.displayName ?? s.symbol}
                  </Link>
                  <div className={`text-xs ${suggested ? SIDE_TONE[suggested].text : "text-muted-foreground"}`}>{setup.label}</div>
                </td>
                <td className="py-3 pr-3 text-right whitespace-nowrap">
                  <div className="text-foreground">{inr(price)}</div>
                  <div className={`text-xs ${change >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{pct(change)}</div>
                </td>
                <td className="py-3 pr-3 whitespace-nowrap">
                  <div className="text-foreground">
                    {levelName} {inr(s.context.level)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {s.context.distanceToLevel != null ? `${Math.abs(s.context.distanceToLevel).toFixed(2)}% away` : ""}
                  </div>
                </td>
                <td className="py-3 pr-3 whitespace-nowrap">
                  <Direction label={s.momentum.label} />
                </td>
                <td className="py-3 pr-3 whitespace-nowrap">
                  <PressureText label={s.pressure.label} />
                </td>
                <td className="py-3 pr-3">
                  <Confidence value={s.confidence} />
                </td>
                {!compact && (
                  <td className="py-3 pr-3 text-right whitespace-nowrap">
                    {s.tradePlan ? (
                      <>
                        <div>
                          <span className="text-rose-400">{inr(s.tradePlan.stopLoss)}</span>
                          <span className="text-muted-foreground"> / </span>
                          <span className="text-emerald-400">{inr(s.tradePlan.target)}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          risk {s.tradePlan.riskPercent.toFixed(2)}% for {s.tradePlan.rewardPercent.toFixed(2)}%
                        </div>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                )}
                <td className="py-3 pr-4 text-right whitespace-nowrap">
                  <div className="inline-flex gap-1.5">
                    {(["BUY", "SELL"] as const).map((side) => (
                      <button
                        key={side}
                        onClick={() => open(s, side)}
                        className={`h-8 w-14 rounded-md text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 ${SIDE_TONE[side].ring} ${
                          suggested === side ? SIDE_TONE[side].solid : `${SIDE_TONE[side].bg} ${SIDE_TONE[side].text} hover:brightness-125`
                        }`}
                      >
                        {side === "BUY" ? "Buy" : "Sell"}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Direction({ label }: { label: string }) {
  const up = label.endsWith("UP");
  const down = label.endsWith("DOWN");
  const strong = label.startsWith("STRONG");
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  const tone = up ? "text-emerald-500" : down ? "text-rose-500" : "text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1 ${tone}`}>
      <Icon className="size-3.5" />
      {up || down ? `${strong ? "Strong" : "Weak"} ${up ? "up" : "down"}` : "Flat"}
    </span>
  );
}

function PressureText({ label }: { label: string }) {
  if (label === "BUY") return <span className="text-emerald-500">Buyers</span>;
  if (label === "SELL") return <span className="text-rose-500">Sellers</span>;
  if (label === "NOT_APPLICABLE") return <span className="text-muted-foreground">—</span>;
  return <span className="text-muted-foreground">Balanced</span>;
}

function Confidence({ value }: { value: number }) {
  const p = Math.round(value * 100);
  const tone = p >= 85 ? "bg-emerald-500" : p >= 70 ? "bg-sky-500" : "bg-zinc-500";
  return (
    <div className="flex items-center gap-2 min-w-24">
      <div className="h-1.5 w-14 rounded-full bg-muted overflow-hidden" aria-hidden>
        <div className={`h-full ${tone}`} style={{ width: `${p}%` }} />
      </div>
      <span className="text-xs text-foreground">{p}%</span>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="px-4 pb-8 pt-2 text-sm text-muted-foreground max-w-xl">{children}</div>;
}

function SetupsSkeleton() {
  return (
    <div className="px-4 pb-4 space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-11 rounded-md bg-muted/40 animate-pulse" />
      ))}
    </div>
  );
}
