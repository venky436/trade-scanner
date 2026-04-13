"use client";

import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  Landmark,
  LayoutGrid,
  PhoneCall,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { MarketContextBanner } from "./market-context-banner";
import { IntelligenceCard } from "./intelligence-card";
import { IndexCard } from "./index-card";
import { OptionCard } from "./option-card";
import { TopOpportunityCard } from "./top-opportunity-card";
import { StockTableSkeleton } from "./stock-table-skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { useMarketData } from "@/hooks/use-market-data";
import { useAuth } from "@/context/auth-context";
import { apiFetch } from "@/lib/api";
import { INDEX_NAMES } from "@/lib/constants";
import { SUPPORTED_OPTION_INDICES } from "@/lib/option-insight";
import type { IntelligenceSnapshot } from "@/lib/types";
import { AddToWatchZoneButton } from "./watch-zone";

type GridFilter = "ACTIONABLE" | "ALL" | "NEAR_RESISTANCE" | "NEAR_SUPPORT";
type ScannerMode = "stocks" | "options";

function SectionHeader({
  Icon,
  title,
  subtitle,
  right,
}: {
  Icon: LucideIcon;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-900/60 ring-1 ring-zinc-200 dark:ring-zinc-800/80">
          <Icon className="size-4 text-zinc-600 dark:text-zinc-400" />
        </div>
        <div>
          <h2 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            {title}
          </h2>
          {subtitle && <p className="text-[11px] text-zinc-500">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

const FILTER_LABEL: Record<GridFilter, string> = {
  ACTIONABLE: "Actionable setups",
  ALL: "All stocks",
  NEAR_RESISTANCE: "Near resistance only",
  NEAR_SUPPORT: "Near support only",
};

// Section title per filter — default "Opportunities", others reflect the selection.
const FILTER_TITLE: Record<GridFilter, string> = {
  ACTIONABLE: "Opportunities",
  ALL: "All Stocks",
  NEAR_RESISTANCE: "Near Resistance",
  NEAR_SUPPORT: "Near Support",
};

function filterStocks(stocks: IntelligenceSnapshot[], filter: GridFilter): IntelligenceSnapshot[] {
  if (filter === "ALL") return stocks;
  if (filter === "NEAR_RESISTANCE") return stocks.filter((s) => s.context.zone === "NEAR_RESISTANCE");
  if (filter === "NEAR_SUPPORT") return stocks.filter((s) => s.context.zone === "NEAR_SUPPORT");
  // ACTIONABLE (default): near a level AND has a directional outlook
  return stocks.filter(
    (s) => s.context.zone !== "MID_RANGE" && s.outlook !== "NO_CLEAR_EDGE",
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
  const [filter, setFilter] = useState<GridFilter>("ACTIONABLE");
  const [mode, setMode] = useState<ScannerMode>("stocks");

  // Poll auth status until connected
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

  // Once we get stocks, kite is definitely connected
  useEffect(() => {
    if (stockMap.size > 0) setKiteConnected(true);
  }, [stockMap.size]);

  const allStocks = useMemo(() => {
    const list: IntelligenceSnapshot[] = [];
    for (const stock of stockMap.values()) {
      if (INDEX_NAMES.has(stock.symbol)) continue;
      list.push(stock);
    }
    list.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      const aActionable = a.context.zone !== "MID_RANGE" ? 1 : 0;
      const bActionable = b.context.zone !== "MID_RANGE" ? 1 : 0;
      return bActionable - aActionable;
    });
    return list;
  }, [stockMap]);

  const filteredStocks = useMemo(() => filterStocks(allStocks, filter), [allStocks, filter]);

  // Top Opportunities — top 5 by confidence among ACTIONABLE stocks (near a level
  // AND has a directional outlook). Only shown if at least one card clears the 0.6
  // floor. Independent of the user's filter dropdown.
  const topOpportunities = useMemo(() => {
    const candidates = allStocks.filter(
      (s) => s.context.zone !== "MID_RANGE" && s.outlook !== "NO_CLEAR_EDGE",
    );
    const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
    const top5 = sorted.slice(0, 5);
    const meetsFloor = top5.some((s) => s.confidence >= 0.6);
    return meetsFloor ? top5 : [];
  }, [allStocks]);

  const topSymbols = useMemo(
    () => new Set(topOpportunities.map((s) => s.symbol)),
    [topOpportunities],
  );

  // The main "Stocks" grid excludes anything already in Top Opportunities.
  const remainingStocks = useMemo(
    () => filteredStocks.filter((s) => !topSymbols.has(s.symbol)),
    [filteredStocks, topSymbols],
  );

  const isLoading = stockMap.size === 0 && kiteConnected;

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-[1400px] mx-auto px-4 py-4 space-y-6">
        {!kiteConnected ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <p className="text-lg">Not connected to Kite</p>
            <p className="text-sm mt-1">
              Click{" "}
              <span className="text-yellow-600 dark:text-yellow-400 font-medium">Connect Kite</span>{" "}
              above to login and start streaming market data.
            </p>
          </div>
        ) : isLoading ? (
          <StockTableSkeleton />
        ) : (
          <>
            <MarketContextBanner market={marketContext} />

            {/* Mode toggle: Stocks / Options */}
            <div className="flex justify-center sm:justify-start">
              <ModeToggle mode={mode} onChange={setMode} />
            </div>

            {/* Indices section — visible in both modes */}
            <section>
              <SectionHeader
                Icon={Activity}
                title="Market Indices"
                subtitle="Live index pulse"
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
                  name="SENSEX"
                  symbol="SENSEX"
                  data={stockMap.get("SENSEX")}
                  accent="amber"
                  Icon={BarChart3}
                />
              </div>
            </section>

            {/* Top Opportunities (stocks mode only, hidden if no card clears floor) */}
            {mode === "stocks" && topOpportunities.length > 0 && (
              <section>
                <SectionHeader
                  Icon={Sparkles}
                  title="Top Opportunities"
                  subtitle={`Best ${topOpportunities.length} setups by confidence`}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {topOpportunities.map((stock) => (
                    <TopOpportunityCard key={stock.symbol} data={stock} />
                  ))}
                </div>
              </section>
            )}

            {/* Stocks view (excluding any stocks already in Top Opportunities) */}
            {mode === "stocks" && (
              <section>
                <SectionHeader
                  Icon={LayoutGrid}
                  title={FILTER_TITLE[filter]}
                  subtitle={`Showing ${remainingStocks.length} of ${allStocks.length}`}
                  right={
                    <Select
                      value={filter}
                      onValueChange={(value) => setFilter(value as GridFilter)}
                      items={(Object.keys(FILTER_LABEL) as GridFilter[]).map((key) => ({
                        value: key,
                        label: FILTER_LABEL[key],
                      }))}
                    >
                      <SelectTrigger className="min-w-[160px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(FILTER_LABEL) as GridFilter[]).map((key) => (
                          <SelectItem key={key} value={key}>
                            {FILTER_LABEL[key]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  }
                />

                {remainingStocks.length === 0 ? (
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-900/40 px-6 py-12 text-center text-sm text-zinc-500">
                    {topOpportunities.length > 0
                      ? "All matching stocks are in Top Opportunities above."
                      : "No stocks match this filter right now."}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {remainingStocks.map((stock) => (
                      <IntelligenceCard key={stock.symbol} data={stock} />
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Options view */}
            {mode === "options" && (
              <section>
                <SectionHeader
                  Icon={PhoneCall}
                  title="Index Options"
                  subtitle="CALL / PUT bias derived from each index's intelligence"
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
                <p className="mt-4 text-[11px] text-zinc-500">
                  Options insight comes from the underlying index intelligence. Greeks, OI and IV
                  are not yet supported.
                </p>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
