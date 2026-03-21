"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Zap,
  Shield,
  Flame,
} from "lucide-react";
import { Header } from "./header";
import { MarketOverview } from "./market-overview";
import { TopOpportunities } from "./top-opportunities";
import { ScannerDashboard } from "./scanner-dashboard";
import { WatchlistCards } from "./watchlist-cards";
import { StockTableSkeleton } from "./stock-table-skeleton";
import { useMarketData } from "@/hooks/use-market-data";
import { INDEX_NAMES } from "@/lib/constants";
import type { SupportResistanceResult } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4002";

// Module-level cache so S/R levels survive component remounts
let srLevelsCache: Record<string, SupportResistanceResult> = {};

export function Dashboard() {
  const { stockMap, isConnected } = useMarketData();
  const [searchQuery, setSearchQuery] = useState("");
  const [kiteConnected, setKiteConnected] = useState(false);
  const [srLevels, setSrLevels] = useState<Record<string, SupportResistanceResult>>(srLevelsCache);

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
    return () => { active = false; clearInterval(interval); };
  }, []);

  // Once we get stocks, kite is definitely connected
  useEffect(() => {
    if (stockMap.size > 0) setKiteConnected(true);
  }, [stockMap.size]);

  // Fetch S/R levels (skip if cached)
  const hasStocks = stockMap.size > 0;
  const hasCachedLevels = Object.keys(srLevelsCache).length > 0;
  useEffect(() => {
    if (!hasStocks || hasCachedLevels) return;
    let active = true;
    async function fetchLevels() {
      try {
        const res = await fetch(`${API_URL}/api/stocks/levels`);
        if (!res.ok) return;
        const data = await res.json();
        if (active && data.levels) {
          srLevelsCache = data.levels;
          setSrLevels(data.levels);
        }
      } catch {
        // ignore
      }
    }
    fetchLevels();
    return () => { active = false; };
  }, [hasStocks, hasCachedLevels]);

  const stockCount = useMemo(
    () => Array.from(stockMap.values()).filter((s) => !INDEX_NAMES.has(s.symbol)).length,
    [stockMap]
  );

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

            {/* Top Opportunities */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Zap className="size-4 text-yellow-500 fill-yellow-500" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Top Opportunities
                </h2>
                <span className="text-xs text-muted-foreground/60">
                  Best setups right now
                </span>
              </div>
              <TopOpportunities stockMap={stockMap} srLevels={srLevels} />
            </div>

            {/* Watchlists (Breakout/Rejection) */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Flame className="size-4 text-orange-500" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Watchlists
                </h2>
                <span className="text-xs text-muted-foreground/60">
                  Actionable setups near key levels
                </span>
              </div>
              <WatchlistCards stockMap={stockMap} />
            </div>

            {/* S/R Widgets */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Shield className="size-4 text-purple-500" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Key Levels
                </h2>
                <span className="text-xs text-muted-foreground/60">
                  Stocks near support & resistance
                </span>
              </div>
              <ScannerDashboard stockMap={stockMap} srLevels={srLevels} />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
