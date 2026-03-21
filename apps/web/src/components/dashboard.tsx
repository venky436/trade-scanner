"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, LayoutGrid, Zap } from "lucide-react";
import { Header } from "./header";
import { MarketOverview } from "./market-overview";
import { TopSignals } from "./top-signals";
import { FilterBar, type FilterValue } from "./filter-bar";
import { ScannerTable } from "./scanner-table";
import { StockTableSkeleton } from "./stock-table-skeleton";
import { useMarketData } from "@/hooks/use-market-data";
import { INDEX_NAMES } from "@/lib/constants";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4002";

export function Dashboard() {
  const { stockMap, isConnected } = useMarketData();
  const [searchQuery, setSearchQuery] = useState("");
  const [kiteConnected, setKiteConnected] = useState(false);
  const [filter, setFilter] = useState<FilterValue>("SIGNALS");

  // Poll auth status until connected
  useEffect(() => {
    let active = true;

    async function check() {
      try {
        const res = await fetch(`${API_URL}/api/auth/status`);
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

  // All non-index stocks
  const allStocks = useMemo(
    () => Array.from(stockMap.values()).filter((s) => !INDEX_NAMES.has(s.symbol)),
    [stockMap]
  );

  // Signal counts
  const signalCount = useMemo(
    () => allStocks.filter((s) => s.signal && s.signal.action !== "WAIT").length,
    [allStocks]
  );
  const buyCount = useMemo(
    () => allStocks.filter((s) => s.signal?.action === "BUY").length,
    [allStocks]
  );
  const sellCount = useMemo(
    () => allStocks.filter((s) => s.signal?.action === "SELL").length,
    [allStocks]
  );

  // Filtered + searched stocks for table
  const tableStocks = useMemo(() => {
    let list = allStocks;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((s) => s.symbol.toLowerCase().includes(q));
    }

    switch (filter) {
      case "SIGNALS":
        list = list.filter((s) => s.signal && s.signal.action !== "WAIT");
        break;
      case "BUY":
        list = list.filter((s) => s.signal?.action === "BUY");
        break;
      case "SELL":
        list = list.filter((s) => s.signal?.action === "SELL");
        break;
    }

    return list;
  }, [allStocks, searchQuery, filter]);

  const stockCount = allStocks.length;
  const isLoading = stockMap.size === 0 && kiteConnected;

  return (
    <main className="min-h-screen bg-background">
      <Header
        isConnected={isConnected}
        kiteConnected={kiteConnected}
        stockCount={stockCount}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />
      <div className="max-w-[1400px] mx-auto px-4 py-4 space-y-8">
        {!kiteConnected ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <p className="text-lg">Not connected to Kite</p>
            <p className="text-sm mt-1">
              Click{" "}
              <span className="text-yellow-600 dark:text-yellow-400 font-medium">
                Connect Kite
              </span>{" "}
              above to login and start streaming market data.
            </p>
          </div>
        ) : isLoading ? (
          <StockTableSkeleton />
        ) : (
          <>
            {/* Market Overview */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="size-4 text-blue-500" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Market Pulse
                </h2>
              </div>
              <MarketOverview stockMap={stockMap} />
            </div>

            {/* Top Signals */}
            <TopSignals stockMap={stockMap} />

            {/* Scanner */}
            <div>
              <div className="flex items-center justify-between gap-4 mb-4">
                <div className="flex items-center gap-2">
                  <LayoutGrid className="size-4 text-primary" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    Scanner
                  </h2>
                  <span className="text-xs text-muted-foreground/60">
                    {tableStocks.length} stocks
                  </span>
                </div>
                <FilterBar
                  filter={filter}
                  onFilterChange={setFilter}
                  signalCount={signalCount}
                  buyCount={buyCount}
                  sellCount={sellCount}
                />
              </div>
              <ScannerTable stocks={tableStocks} />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
