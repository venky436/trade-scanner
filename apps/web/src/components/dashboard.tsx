"use client";

import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  Flame,
  Hammer,
  Landmark,
  LayoutGrid,
  PhoneCall,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { MarketContextBanner } from "./market-context-banner";
import { MarketCard } from "./market-card";
import { IndexCard } from "./index-card";
import { StockTableSkeleton } from "./stock-table-skeleton";
import { VolatileCard } from "./volatile-card";
import { VolatileFilterBar } from "./volatile-filter-bar";
import { useMarketData } from "@/hooks/use-market-data";
import { useVolatileStocks } from "@/hooks/use-volatile-stocks";
import { apiFetch } from "@/lib/api";
import { INDEX_NAMES } from "@/lib/constants";
import type { IntelligenceSnapshot, VolatileSortKey } from "@/lib/types";

type ScannerMode = "stocks" | "options" | "volatile";

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
        onClick={() => onChange("options")}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
          mode === "options"
            ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
            : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        }`}
      >
        <PhoneCall className="size-3.5" />
        Options
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

            {/* Options view — coming soon placeholder */}
            {mode === "options" && <OptionsComingSoon />}
          </>
        )}
      </div>
    </main>
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

// Empty-state placeholder for the Options tab. Pure illustration card — no data,
// no live polling, no API calls. Replaces the previous OptionCard grid until
// proper options analytics ship.
function OptionsComingSoon() {
  return (
    <section className="flex justify-center py-12">
      <div className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-zinc-200 dark:border-zinc-800/80 bg-gradient-to-br from-cyan-500/5 via-white to-violet-500/5 dark:from-cyan-500/8 dark:via-zinc-950/60 dark:to-violet-500/8 px-10 py-14 text-center">
        {/* Decorative glow blobs */}
        <div className="pointer-events-none absolute -top-16 -left-16 size-48 rounded-full blur-3xl bg-cyan-400/15" />
        <div className="pointer-events-none absolute -bottom-20 -right-20 size-56 rounded-full blur-3xl bg-violet-400/15" />

        <div className="relative flex flex-col items-center gap-5">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500/20 to-violet-500/20 ring-1 ring-cyan-400/30 shadow-lg shadow-cyan-500/10">
            <Hammer className="size-7 text-cyan-600 dark:text-cyan-300" strokeWidth={2} />
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Options view coming soon
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-sm mx-auto leading-relaxed">
              We are building a dedicated options activity surface. Switch back to the Stocks tab for now.
            </p>
          </div>

          <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-500/[0.06] px-4 py-1.5">
            <span className="size-1.5 animate-pulse rounded-full bg-cyan-400" />
            <span className="text-[11px] font-bold uppercase tracking-[0.25em] text-cyan-700 dark:text-cyan-300">
              In development
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
