"use client";

import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowUpDown,
  BarChart3,
  Flame,
  Landmark,
  LayoutGrid,
  LineChart,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Sunrise,
  Magnet,
} from "lucide-react";
import { MarketContextBanner } from "./market-context-banner";
import { MarketCard } from "./market-card";
import { IndexCard } from "./index-card";
import { StockTableSkeleton } from "./stock-table-skeleton";
import { VolatileCard } from "./volatile-card";
import { VolatileFilterBar } from "./volatile-filter-bar";
import { DayMoverCard } from "./day-mover-card";
import { DayMoversFilterBar } from "./day-movers-filter-bar";
import { TrendCard } from "./trend-card";
import { useTrendStocks } from "@/hooks/use-trend-stocks";
import { OpeningMoverCard } from "./opening-mover-card";
import { useOpeningMovers } from "@/hooks/use-opening-movers";
import { SmartZoneCard } from "./smart-zone-card";
import { useSmartZones } from "@/hooks/use-smart-zones";
import { useMarketData } from "@/hooks/use-market-data";
import { useVolatileStocks } from "@/hooks/use-volatile-stocks";
import { useDayMovers } from "@/hooks/use-day-movers";
import { apiFetch } from "@/lib/api";
import { INDEX_NAMES, isFutureSymbol } from "@/lib/constants";
import type {
  DayMoverDirectionFilter,
  DayMoverSortKey,
  IntelligenceSnapshot,
  VolatileSortKey,
} from "@/lib/types";

type ScannerMode = "stocks" | "indexFutures" | "volatile" | "dayMovers";

// Section caps — keep each list digestible at a glance.
const STRONG_ALIGNMENT_CAP = 6;
const ZONE_SECTION_CAP = 6;

// Confidence floor for Near Support / Near Resistance sections. Drops
// low-conviction stocks that happen to be at a level but lack the momentum +
// pressure alignment to be a real setup. 0.65 matches the existing
// "Actionable" filter threshold from market-intelligence.md.
const ZONE_SECTION_CONF_FLOOR = 0.65;

// Confidence threshold for "Strong Factor Alignment". Backend keeps producing
// the score for ranking; UI never displays the % to the user.
// Strict 0.85 floor on purpose: this card is the home-page elevator pitch
// (best-of-the-best highlight), one tier above /social's 0.75 publishable feed
// and the 0.70 tracking floor. Low volume is a feature.
const STRONG_ALIGNMENT_FLOOR = 0.85;
// Tracks all currently-emitted outlooks. Breakout / Breakdown were re-enabled
// 2026-05-10 with strict volume + Donchian-style confirmation gates — they
// qualify for Strong Alignment when they additionally clear the 0.85 floor.
const STRONG_ALIGNMENT_OUTLOOKS = new Set([
  "BOUNCE_EXPECTED",
  "REJECTION_POSSIBLE",
  "BREAKOUT_LIKELY",
  "BREAKDOWN_RISK",
]);

function SectionHeader({
  Icon,
  title,
  subtitle,
  count,
  iconBg = "bg-zinc-100 dark:bg-zinc-900/60",
  iconRing = "ring-zinc-200 dark:ring-zinc-800/80",
  iconColor = "text-zinc-600 dark:text-zinc-400",
}: {
  Icon: LucideIcon;
  title: string;
  subtitle: string;
  count?: number;
  iconBg?: string;
  iconRing?: string;
  iconColor?: string;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <div className="flex items-center gap-3.5">
        <div className={`flex size-11 items-center justify-center rounded-2xl ${iconBg} ring-1 ${iconRing} shadow-sm`}>
          <Icon className={`size-5 ${iconColor}`} strokeWidth={2.4} />
        </div>
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">
            {title}
          </h2>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>
        </div>
      </div>
      {typeof count === "number" && (
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500 tabular-nums">
          {count} {count === 1 ? "stock" : "stocks"}
        </span>
      )}
    </div>
  );
}

// Section empty state — section-themed icon + glow + soft messaging. Used when
// no stocks match the section's filter at the moment. Designed to feel
// intentional rather than "broken / nothing here".
function EmptyState({
  Icon,
  heading,
  subtext,
  iconBg = "bg-gradient-to-br from-zinc-500/15 to-zinc-400/15",
  iconRing = "ring-zinc-400/30",
  iconColor = "text-zinc-500 dark:text-zinc-400",
  glow = "bg-zinc-400/10",
}: {
  Icon: LucideIcon;
  heading: string;
  subtext: string;
  iconBg?: string;
  iconRing?: string;
  iconColor?: string;
  glow?: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800/80 bg-white/40 dark:bg-zinc-900/20 px-8 py-12 text-center">
      <div className={`pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 size-44 rounded-full blur-3xl ${glow}`} />
      <div className="relative flex flex-col items-center gap-4">
        <div className={`flex size-14 items-center justify-center rounded-2xl ${iconBg} ring-1 ${iconRing} shadow-sm`}>
          <Icon className={`size-6 ${iconColor}`} strokeWidth={2.2} />
        </div>
        <div className="space-y-1.5 max-w-md">
          <h3 className="text-base font-bold text-zinc-800 dark:text-zinc-200">
            {heading}
          </h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
            {subtext}
          </p>
        </div>
      </div>
    </div>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: ScannerMode;
  onChange: (m: ScannerMode) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800/80 dark:bg-zinc-900/40">
      <button
        onClick={() => onChange("stocks")}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
          mode === "stocks"
            ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
            : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        }`}
      >
        <LayoutGrid className="size-3.5" />
        Stocks
      </button>
      <button
        onClick={() => onChange("volatile")}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
          mode === "volatile"
            ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
            : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        }`}
      >
        <Flame className="size-3.5" />
        Volatile
      </button>
      <button
        onClick={() => onChange("dayMovers")}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
          mode === "dayMovers"
            ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
            : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        }`}
      >
        <ArrowUpDown className="size-3.5" />
        Day Movers
      </button>
      <button
        onClick={() => onChange("indexFutures")}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
          mode === "indexFutures"
            ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
            : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        }`}
      >
        <LineChart className="size-3.5" />
        Index Futures
      </button>
    </div>
  );
}

export function Dashboard() {
  const { stockMap, marketContext } = useMarketData();
  const [kiteConnected, setKiteConnected] = useState(false);
  const [mode, setMode] = useState<ScannerMode>("stocks");

  // Poll auth status until connected.
  useEffect(() => {
    let active = true;
    async function check() {
      try {
        const res = await apiFetch("/api/auth/status");
        const data = await res.json();
        if (active) setKiteConnected(data.connected);
      } catch {
        // server not reachable yet
      }
    }
    check();
    const interval = setInterval(check, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (stockMap.size > 0) setKiteConnected(true);
  }, [stockMap.size]);

  // All non-index stocks, sorted by confidence (used internally for ranking).
  const allStocks = useMemo(() => {
    const list: IntelligenceSnapshot[] = [];
    for (const stock of stockMap.values()) {
      if (INDEX_NAMES.has(stock.symbol)) continue;
      list.push(stock);
    }
    list.sort((a, b) => b.confidence - a.confidence);
    return list;
  }, [stockMap]);

  // Section 1: Strong Factor Alignment — confidence ≥ STRONG_ALIGNMENT_FLOOR
  // AND outlook is in STRONG_ALIGNMENT_OUTLOOKS (currently all 4 emitted
  // outlooks: Bounce, Rejection, Breakout, Breakdown). Frontend allowlist is
  // intentionally narrower than "any non-NO_CLEAR_EDGE" so unknown future
  // outlooks don't accidentally surface in the elevator-pitch lane.
  const strongAlignment = useMemo(
    () =>
      allStocks
        .filter((s) => s.confidence >= STRONG_ALIGNMENT_FLOOR && STRONG_ALIGNMENT_OUTLOOKS.has(s.outlook))
        .slice(0, STRONG_ALIGNMENT_CAP),
    [allStocks],
  );

  // Section 2: Near Support Zones — only stocks with confidence ≥ 65%
  const nearSupport = useMemo(
    () =>
      allStocks
        .filter((s) => s.context.zone === "NEAR_SUPPORT" && s.confidence >= ZONE_SECTION_CONF_FLOOR)
        .slice(0, ZONE_SECTION_CAP),
    [allStocks],
  );

  // Section 3: Near Resistance Zones — only stocks with confidence ≥ 65%
  const nearResistance = useMemo(
    () =>
      allStocks
        .filter((s) => s.context.zone === "NEAR_RESISTANCE" && s.confidence >= ZONE_SECTION_CONF_FLOOR)
        .slice(0, ZONE_SECTION_CAP),
    [allStocks],
  );

  const isLoading = stockMap.size === 0 && kiteConnected;

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-8">
        {!kiteConnected ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <p className="text-lg">Not connected to Kite</p>
            <p className="text-sm mt-1">
              Click{" "}
              <span className="text-yellow-600 dark:text-yellow-400 font-medium">Connect Kite</span>{" "}
              above to start streaming market data.
            </p>
          </div>
        ) : isLoading ? (
          <StockTableSkeleton />
        ) : (
          <>
            <MarketContextBanner market={marketContext} />

            {/* Section 1 — Market Overview (indices) */}
            <section>
              <SectionHeader
                Icon={Activity}
                title="Market Overview"
                subtitle="Real-time market activity across major indices"
                iconBg="bg-gradient-to-br from-cyan-500/20 to-blue-500/20"
                iconRing="ring-cyan-400/30"
                iconColor="text-cyan-600 dark:text-cyan-300"
              />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <IndexCard
                  name="NIFTY 50"
                  symbol="NIFTY 50"
                  data={stockMap.get("NIFTY 50")}
                  accent="blue"
                  Icon={TrendingUp}
                />
                <IndexCard
                  name="BANKNIFTY"
                  symbol="NIFTY BANK"
                  data={stockMap.get("NIFTY BANK")}
                  accent="purple"
                  Icon={Landmark}
                />
                <IndexCard
                  name="NIFTY FIN"
                  symbol="NIFTY FIN SERVICE"
                  data={stockMap.get("NIFTY FIN SERVICE")}
                  accent="amber"
                  Icon={BarChart3}
                />
              </div>
            </section>

            {/* Mode toggle */}
            <div className="flex justify-center sm:justify-start">
              <ModeToggle mode={mode} onChange={setMode} />
            </div>

            {mode === "stocks" && (
              <>
                {/* Section 2 — Strong Factor Alignment */}
                <section>
                  <SectionHeader
                    Icon={Sparkles}
                    title="Strong Factor Alignment"
                    subtitle="Stocks showing alignment across momentum, pressure & volatility"
                    count={strongAlignment.length}
                    iconBg="bg-gradient-to-br from-amber-500/25 to-orange-500/20"
                    iconRing="ring-amber-400/40"
                    iconColor="text-amber-600 dark:text-amber-300"
                  />
                  {strongAlignment.length === 0 ? (
                    <EmptyState
                      Icon={Sparkles}
                      heading="No strong alignment right now"
                      subtext="Markets are in balance. Fresh setups will appear here as momentum, pressure and volatility align."
                      iconBg="bg-gradient-to-br from-amber-500/20 to-orange-500/15"
                      iconRing="ring-amber-400/40"
                      iconColor="text-amber-500 dark:text-amber-300"
                      glow="bg-amber-400/15"
                    />
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {strongAlignment.map((s) => (
                        <MarketCard key={s.symbol} data={s} />
                      ))}
                    </div>
                  )}
                </section>

                {/* Opening Movers — BUY / SELL from the first two 5-min candles (display only) */}
                <OpeningMoversSection />

                {/* Smart Zones — FVGs + Order Blocks after a clear move: Reversal / Trend (display only) */}
                <SmartZonesSection />

                {/* Trend Structure — higher highs / higher lows (display only) */}
                <TrendSection />

                {/* Section 3 — Near Support Zones */}
                <section>
                  <SectionHeader
                    Icon={TrendingUp}
                    title="Near Support Zones"
                    subtitle="Stocks trading close to historically reactive support areas"
                    count={nearSupport.length}
                    iconBg="bg-gradient-to-br from-emerald-500/25 to-green-500/20"
                    iconRing="ring-emerald-400/40"
                    iconColor="text-emerald-600 dark:text-emerald-300"
                  />
                  {nearSupport.length === 0 ? (
                    <EmptyState
                      Icon={TrendingUp}
                      heading="No stocks near support zones"
                      subtext="Stocks will appear here when price approaches a recent support level worth watching."
                      iconBg="bg-gradient-to-br from-emerald-500/20 to-green-500/15"
                      iconRing="ring-emerald-400/40"
                      iconColor="text-emerald-500 dark:text-emerald-300"
                      glow="bg-emerald-400/15"
                    />
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {nearSupport.map((s) => (
                        <MarketCard key={s.symbol} data={s} />
                      ))}
                    </div>
                  )}
                </section>

                {/* Section 4 — Near Resistance Zones */}
                <section>
                  <SectionHeader
                    Icon={TrendingDown}
                    title="Near Resistance Zones"
                    subtitle="Stocks approaching historically reactive resistance areas"
                    count={nearResistance.length}
                    iconBg="bg-gradient-to-br from-rose-500/25 to-red-500/20"
                    iconRing="ring-rose-400/40"
                    iconColor="text-rose-600 dark:text-rose-300"
                  />
                  {nearResistance.length === 0 ? (
                    <EmptyState
                      Icon={TrendingDown}
                      heading="No stocks near resistance zones"
                      subtext="Stocks will appear here when price approaches a recent resistance level worth watching."
                      iconBg="bg-gradient-to-br from-rose-500/20 to-red-500/15"
                      iconRing="ring-rose-400/40"
                      iconColor="text-rose-500 dark:text-rose-300"
                      glow="bg-rose-400/15"
                    />
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {nearResistance.map((s) => (
                        <MarketCard key={s.symbol} data={s} />
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}

            {/* Volatile tab — intraday-trading aid (ATR% + RVOL gated) */}
            {mode === "volatile" && <VolatileSection />}

            {/* Day Movers tab — reversal-hunting (|Day Move %| ≥ 3 + RVOL gated) */}
            {mode === "dayMovers" && <DayMoversSection />}

            {/* Index Futures tab — applies the full engine (pressure, momentum,
                volatility, S/R, AI verdict, etc.) to NIFTY near-expiry futures. */}
            {mode === "indexFutures" && <IndexFuturesSection />}
          </>
        )}
      </div>
    </main>
  );
}

// Trend Structure — the stocks with the clearest intraday trend right now,
// from today's 5-min swing highs / lows (HH + HL = uptrend, LH + LL =
// downtrend, at least 3 agreeing swings, not broken). Display only: it does
// not change any engine, confidence score or call.
const OPENING_WAIT_TEXT: Record<string, string> = {
  WAITING_LOGIN: "Connect Kite to build today's list.",
  LOADING: "Getting each stock's normal opening volume from Zerodha…",
  WAITING: "The list is built at 09:20, after the first 5-minute candle closes.",
  COMPUTING: "Checking the 09:15 candle…",
  NO_SESSION: "No trading today.",
  READY: "No stock passed today. The 09:15 candle must close beyond yesterday's close with at least 2× normal volume.",
};

function OpeningMoversSection() {
  const { data, isLoading } = useOpeningMovers();
  const stocks = data?.stocks ?? [];
  const buys = stocks.filter((s) => s.side === "BUY").length;
  const sells = stocks.length - buys;
  const progress = data?.status === "LOADING" && data.progress?.total ? ` (${data.progress.done}/${data.progress.total})` : "";
  return (
    <section>
      <SectionHeader
        Icon={Sunrise}
        title="Opening Movers"
        subtitle={
          stocks.length > 0
            ? `${buys} BUY · ${sells} SELL, from the 09:15 candle. Fixed for the day.`
            : "BUY / SELL from the first 5-minute candle, built at 09:20 and fixed for the day."
        }
        count={stocks.length}
        iconBg="bg-gradient-to-br from-amber-500/25 to-rose-500/20"
        iconRing="ring-amber-400/40"
        iconColor="text-amber-600 dark:text-amber-300"
      />
      {isLoading && !data ? (
        <StockTableSkeleton />
      ) : stocks.length === 0 ? (
        <EmptyState
          Icon={Sunrise}
          heading={data?.status === "READY" ? "No opening movers today" : "Not built yet"}
          subtext={(OPENING_WAIT_TEXT[data?.status ?? "WAITING"] ?? OPENING_WAIT_TEXT.WAITING) + progress}
          iconBg="bg-gradient-to-br from-amber-500/20 to-rose-500/15"
          iconRing="ring-amber-400/40"
          iconColor="text-amber-500 dark:text-amber-300"
          glow="bg-amber-400/15"
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {stocks.map((s) => (
            <OpeningMoverCard key={s.symbol} data={s} />
          ))}
        </div>
      )}
    </section>
  );
}

const ZONE_WAIT_TEXT: Record<string, string> = {
  WAITING_LOGIN: "Connect Kite to start finding setups.",
  WAITING: "The first check is at 09:35, then every 5 minutes after each candle closes.",
  SCANNING: "Checking every stock's 5-minute candles…",
  NO_SESSION: "No trading today.",
  LIVE: "No Fair Value Gap or Order Block after a clear move yet today.",
};
const ZONE_ORDER = { IN_TRADE: 0, CLOSED: 1, STOPPED: 2 } as const;
type ZoneFilter = "ACTIVE" | "REVERSAL" | "TREND" | "ALL";

function SmartZonesSection() {
  const { data, isLoading } = useSmartZones();
  const [filter, setFilter] = useState<ZoneFilter>("ALL");
  const all = data?.zones ?? [];
  const active = all.filter((z) => z.status === "IN_TRADE");
  const rev = all.filter((z) => z.kind === "REVERSAL");
  const shown = (filter === "ACTIVE" ? active : filter === "ALL" ? all : all.filter((z) => z.kind === filter))
    .slice()
    .sort((a, b) => ZONE_ORDER[a.status] - ZONE_ORDER[b.status] || b.formedAt - a.formedAt)
    .slice(0, 30);
  const progress = data?.status === "SCANNING" && data.progress?.total ? ` (${data.progress.done}/${data.progress.total})` : "";
  const chips: [ZoneFilter, string][] = [["ALL", `All ${all.length}`], ["REVERSAL", `Reversal ${rev.length}`], ["TREND", `Trend ${all.length - rev.length}`], ["ACTIVE", `In trade ${active.length}`]];
  return (
    <section>
      <SectionHeader
        Icon={Magnet}
        title="Smart Zones"
        subtitle={
          all.length > 0
            ? `${rev.length} reversal · ${all.length - rev.length} trend setups today. Fair Value Gaps and Order Blocks after a clear move, updated every 5 minutes.`
            : "Fair Value Gaps and Order Blocks after a clear fall or rise, from official 5-minute candles."
        }
        count={all.length}
        iconBg="bg-gradient-to-br from-violet-500/25 to-sky-500/20"
        iconRing="ring-violet-400/40"
        iconColor="text-violet-600 dark:text-violet-300"
      />
      {all.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {chips.map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              aria-pressed={filter === k}
              className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${filter === k ? "bg-violet-600 text-white ring-violet-600" : "text-zinc-600 dark:text-zinc-300 ring-zinc-300 dark:ring-zinc-700 hover:ring-violet-400"}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {isLoading && !data ? (
        <StockTableSkeleton />
      ) : shown.length === 0 ? (
        <EmptyState
          Icon={Magnet}
          heading={all.length > 0 ? "No setups in this view" : data?.status === "LIVE" ? "No setups yet today" : "Not started yet"}
          subtext={all.length > 0 ? "Pick another filter above." : (ZONE_WAIT_TEXT[data?.status ?? "WAITING"] ?? ZONE_WAIT_TEXT.WAITING) + progress}
          iconBg="bg-gradient-to-br from-violet-500/20 to-sky-500/15"
          iconRing="ring-violet-400/40"
          iconColor="text-violet-500 dark:text-violet-300"
          glow="bg-violet-400/15"
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {shown.map((z) => (
            <SmartZoneCard key={z.id} data={z} />
          ))}
        </div>
      )}
    </section>
  );
}

function TrendSection() {
  const { stocks, meta, isLoading } = useTrendStocks(10);
  return (
    <section>
      <SectionHeader
        Icon={LineChart}
        title="Trend Structure"
        subtitle="Trends forming today — higher highs & higher lows, or lower highs & lower lows. Confirmed first, then early."
        count={stocks.length}
        iconBg="bg-gradient-to-br from-sky-500/25 to-indigo-500/20"
        iconRing="ring-sky-400/40"
        iconColor="text-sky-600 dark:text-sky-300"
      />
      {isLoading && stocks.length === 0 ? (
        <StockTableSkeleton />
      ) : stocks.length === 0 ? (
        <EmptyState
          Icon={LineChart}
          heading="No clear trend yet"
          subtext={
            meta && meta.poolSize > 0
              ? `Watching ${meta.poolSize} stocks. A stock appears as "Early" once its first higher high + higher low (or lower high + lower low) forms and it has moved ${meta.earlyMinMovePct}%+, usually from about 10:15; "Confirmed" after ${meta.confirmedMinSteps}+ swings and ${meta.confirmedMinMovePct}%+.`
              : "Trends are read from today's 5-minute candles, so this fills in after the market opens."
          }
          iconBg="bg-gradient-to-br from-sky-500/20 to-indigo-500/15"
          iconRing="ring-sky-400/40"
          iconColor="text-sky-500 dark:text-sky-300"
          glow="bg-sky-400/15"
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {stocks.map((s) => (
            <TrendCard key={s.symbol} data={s} />
          ))}
        </div>
      )}
    </section>
  );
}

// Volatile tab — surfaces stocks that are actively moving (ATR% ≥ 1.5%) with
// real volume behind them (RVOL ≥ 1.5×). Optional price-band + sort chips.
// Lives behind a tab so the rest of the dashboard is unaffected when the user
// doesn't want this view.
function VolatileSection() {
  const [priceMin, setPriceMin] = useState<number | null>(null);
  const [priceMax, setPriceMax] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<VolatileSortKey>("atrPct");

  const { stocks, meta, isLoading } = useVolatileStocks({ priceMin, priceMax, sortBy });

  return (
    <section className="space-y-6">
      <SectionHeader
        Icon={Flame}
        title="Volatile Movers"
        subtitle="Stocks moving with real volume — built for live intraday scanning"
        count={stocks.length}
        iconBg="bg-gradient-to-br from-orange-500/25 to-violet-500/20"
        iconRing="ring-orange-400/40"
        iconColor="text-orange-600 dark:text-orange-300"
      />

      <VolatileFilterBar
        priceMin={priceMin}
        priceMax={priceMax}
        sortBy={sortBy}
        onPriceBandChange={(min, max) => {
          setPriceMin(min);
          setPriceMax(max);
        }}
        onSortChange={setSortBy}
        matchedCount={meta?.matchedCount}
        poolSize={meta?.poolSize}
      />

      {isLoading && stocks.length === 0 ? (
        <StockTableSkeleton />
      ) : stocks.length === 0 ? (
        <EmptyState
          Icon={Flame}
          heading="No volatile stocks right now"
          subtext="Market is calm or still warming up. As stocks build ATR ≥ 1.5% and RVOL ≥ 1.5×, they'll appear here automatically. Try a different price band if you've narrowed the filter."
          iconBg="bg-gradient-to-br from-orange-500/20 to-violet-500/15"
          iconRing="ring-orange-400/40"
          iconColor="text-orange-500 dark:text-orange-300"
          glow="bg-orange-400/15"
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {stocks.map((s) => (
            <VolatileCard key={s.symbol} data={s} />
          ))}
        </div>
      )}
    </section>
  );
}

// Day Movers tab — sibling to Volatile, for reversal-hunting. Surfaces stocks
// that have already made a meaningful directional move from today's open
// (|Day Move %| ≥ 3) on at least average volume (RVOL ≥ 1.0). Different
// mental model: not "what's moving now" but "what's already moved a lot."
function DayMoversSection() {
  const [direction, setDirection] = useState<DayMoverDirectionFilter>("all");
  const [priceMin, setPriceMin] = useState<number | null>(null);
  const [priceMax, setPriceMax] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<DayMoverSortKey>("absDayMove");

  const { stocks, meta, isLoading } = useDayMovers({
    direction,
    priceMin,
    priceMax,
    sortBy,
  });

  return (
    <section className="space-y-6">
      <SectionHeader
        Icon={ArrowUpDown}
        title="Day Movers"
        subtitle="Stocks already up or down sharply today — for reversal hunts"
        count={stocks.length}
        iconBg="bg-gradient-to-br from-emerald-500/25 to-rose-500/20"
        iconRing="ring-emerald-400/40"
        iconColor="text-emerald-600 dark:text-emerald-300"
      />

      <DayMoversFilterBar
        direction={direction}
        priceMin={priceMin}
        priceMax={priceMax}
        sortBy={sortBy}
        onDirectionChange={setDirection}
        onPriceBandChange={(min, max) => {
          setPriceMin(min);
          setPriceMax(max);
        }}
        onSortChange={setSortBy}
        matchedCount={meta?.matchedCount}
        poolSize={meta?.poolSize}
        gainersCount={meta?.gainersCount}
        losersCount={meta?.losersCount}
      />

      {isLoading && stocks.length === 0 ? (
        <StockTableSkeleton />
      ) : stocks.length === 0 ? (
        <EmptyState
          Icon={ArrowUpDown}
          heading="No big movers right now"
          subtext={
            direction === "gainers"
              ? "No stocks up ≥ 3% on average-or-better volume yet. Try the Losers tab or wait for more action."
              : direction === "losers"
              ? "No stocks down ≤ -3% on average-or-better volume yet. Try the Gainers tab or wait for more action."
              : "Market is calm — no stocks have moved ≥ 3% from open on average-or-better volume yet. They'll appear here as the day unfolds."
          }
          iconBg="bg-gradient-to-br from-emerald-500/20 to-rose-500/15"
          iconRing="ring-emerald-400/40"
          iconColor="text-emerald-500 dark:text-emerald-300"
          glow="bg-emerald-400/15"
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {stocks.map((s) => (
            <DayMoverCard key={s.symbol} data={s} />
          ))}
        </div>
      )}
    </section>
  );
}

// Index Futures tab — surfaces the NIFTY near-expiry futures contract (v1 scope).
// Reads the live futures from the same stockMap that drives the rest of the
// dashboard; no extra polling. The MarketCard renders pressure / momentum /
// volatility / S-R / AI verdict identically to a stock card — the engine is
// fully symbol-agnostic, so the same card "just works" for futures.
function IndexFuturesSection() {
  const { stockMap } = useMarketData();

  const futures = useMemo(() => {
    const list: IntelligenceSnapshot[] = [];
    for (const snap of stockMap.values()) {
      if (isFutureSymbol(snap.symbol)) list.push(snap);
    }
    // Order by nearest expiry — symbol sorts roughly chronologically (NIFTY25JUN…
    // sorts before NIFTY25JUL…). Sufficient for v1's single contract; will need
    // a real expiry comparator once we track multiple contracts.
    list.sort((a, b) => a.symbol.localeCompare(b.symbol));
    return list;
  }, [stockMap]);

  return (
    <section className="space-y-6">
      <SectionHeader
        Icon={LineChart}
        title="Index Futures"
        subtitle="Nearest-expiry NIFTY futures — full pressure, momentum & volatility on tradeable order flow"
        count={futures.length}
        iconBg="bg-gradient-to-br from-violet-500/25 to-cyan-500/20"
        iconRing="ring-violet-400/40"
        iconColor="text-violet-600 dark:text-violet-300"
      />
      {futures.length === 0 ? (
        <EmptyState
          Icon={LineChart}
          heading="No index futures available yet"
          subtext="The scanner is waiting for the near-expiry NIFTY contract to start streaming. If this persists after a server restart, check the [index_futures] log lines for contract selection."
          iconBg="bg-gradient-to-br from-violet-500/20 to-cyan-500/15"
          iconRing="ring-violet-400/40"
          iconColor="text-violet-500 dark:text-violet-300"
          glow="bg-violet-400/15"
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {futures.map((s) => (
            <MarketCard key={s.symbol} data={s} />
          ))}
        </div>
      )}
    </section>
  );
}
