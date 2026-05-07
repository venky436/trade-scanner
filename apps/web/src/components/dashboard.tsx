"use client";

import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  Compass,
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
import { OptionCard } from "./option-card";
import { StockTableSkeleton } from "./stock-table-skeleton";
import { useMarketData } from "@/hooks/use-market-data";
import { useAuth } from "@/context/auth-context";
import { apiFetch } from "@/lib/api";
import { INDEX_NAMES } from "@/lib/constants";
import { SUPPORTED_OPTION_INDICES } from "@/lib/option-insight";
import type { IntelligenceSnapshot } from "@/lib/types";
import { AddToWatchZoneButton } from "./watch-zone";

type ScannerMode = "stocks" | "options";

// Section caps — keep each list digestible at a glance.
const STRONG_ALIGNMENT_CAP = 8;
const ZONE_SECTION_CAP = 12;

// Confidence threshold for "Strong Factor Alignment". Backend keeps producing
// the score for ranking; UI never displays the % to the user.
const STRONG_ALIGNMENT_FLOOR = 0.85;

function SectionHeader({
  Icon,
  title,
  subtitle,
  count,
}: {
  Icon: LucideIcon;
  title: string;
  subtitle: string;
  count?: number;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-900/60 ring-1 ring-zinc-200 dark:ring-zinc-800/80">
          <Icon className="size-4 text-zinc-600 dark:text-zinc-400" />
        </div>
        <div>
          <h2 className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            {title}
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>
        </div>
      </div>
      {typeof count === "number" && (
        <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 tabular-nums">
          {count} {count === 1 ? "stock" : "stocks"}
        </span>
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800/80 bg-white/40 dark:bg-zinc-900/20 px-6 py-10 text-center text-sm text-zinc-500">
      {message}
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
  const { user } = useAuth();
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

  // Section 1: Strong Factor Alignment — confidence ≥ 0.85
  const strongAlignment = useMemo(
    () => allStocks.filter((s) => s.confidence >= STRONG_ALIGNMENT_FLOOR).slice(0, STRONG_ALIGNMENT_CAP),
    [allStocks],
  );

  // Section 2: Near Support Zones
  const nearSupport = useMemo(
    () => allStocks.filter((s) => s.context.zone === "NEAR_SUPPORT").slice(0, ZONE_SECTION_CAP),
    [allStocks],
  );

  // Section 3: Near Resistance Zones
  const nearResistance = useMemo(
    () => allStocks.filter((s) => s.context.zone === "NEAR_RESISTANCE").slice(0, ZONE_SECTION_CAP),
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
                  />
                  {strongAlignment.length === 0 ? (
                    <EmptyState message="No stocks currently showing strong factor alignment." />
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
                  />
                  {nearSupport.length === 0 ? (
                    <EmptyState message="No stocks currently near support zones." />
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
                  />
                  {nearResistance.length === 0 ? (
                    <EmptyState message="No stocks currently near resistance zones." />
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

            {/* Options view — kept as-is (separate scope) */}
            {mode === "options" && (
              <section>
                <SectionHeader
                  Icon={Compass}
                  title="Index Options"
                  subtitle="Activity insights derived from each index's real-time data"
                />
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {SUPPORTED_OPTION_INDICES.map((idx) => {
                    const data = stockMap.get(idx.symbol);
                    return (
                      <OptionCard
                        key={idx.symbol}
                        displayName={idx.displayName}
                        indexSymbol={idx.symbol}
                        data={data}
                        watchButton={
                          data ? (
                            <AddToWatchZoneButton
                              symbol={idx.symbol}
                              price={data.price}
                              isLoggedIn={!!user}
                              kind="OPTION"
                            />
                          ) : undefined
                        }
                      />
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
