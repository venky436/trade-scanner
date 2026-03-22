"use client";

import { useEffect, useState } from "react";
import {
  BarChart3,
  Zap,
  Eye,
  Shield,
  Crosshair,
} from "lucide-react";
import { MarketOverview } from "./market-overview";
import { WatchlistCards } from "./watchlist-cards";
import { TopOpportunities } from "./top-opportunities";
import { ScannerDashboard } from "./scanner-dashboard";
import { StockTableSkeleton } from "./stock-table-skeleton";
import { useMarketData } from "@/hooks/use-market-data";
import type { SupportResistanceResult } from "@/lib/types";
import { apiFetch } from "@/lib/api";

// Module-level cache so S/R levels survive component remounts
let srLevelsCache: Record<string, SupportResistanceResult> = {};

export function Dashboard() {
  const { stockMap } = useMarketData();
  const [kiteConnected, setKiteConnected] = useState(false);
  const [srLevels, setSrLevels] = useState<Record<string, SupportResistanceResult>>(srLevelsCache);

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
    return () => { active = false; clearInterval(interval); };
  }, []);

  // Once we get stocks, kite is definitely connected
  useEffect(() => {
    if (stockMap.size > 0) setKiteConnected(true);
  }, [stockMap.size]);

  // Fetch S/R levels — immediately when stocks appear, then again after 10s
  // (server may still be loading data on first connect)
  const hasStocks = stockMap.size > 0;
  useEffect(() => {
    if (!hasStocks) return;
    let active = true;
    async function fetchLevels() {
      try {
        const res = await apiFetch("/api/stocks/levels");
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
    // Re-fetch after 10s to pick up data loaded after initial connect
    const retry = setTimeout(fetchLevels, 10_000);
    return () => { active = false; clearTimeout(retry); };
  }, [hasStocks]);

  const isLoading = stockMap.size === 0 && kiteConnected;

  return (
    <main className="min-h-screen bg-background">
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

            {/* Best Setups (score ≥ 8) */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Zap className="size-4 text-yellow-500 fill-yellow-500" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Best Setups
                </h2>
                <span className="text-xs text-muted-foreground/60">
                  These are actionable
                </span>
              </div>
              <TopOpportunities stockMap={stockMap} srLevels={srLevels} minScore={8} maxItems={5} />
            </div>

            {/* Watchlist (score 6-7) */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Eye className="size-4 text-blue-400" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Watchlist
                </h2>
                <span className="text-xs text-muted-foreground/60">
                  Monitor only — not yet actionable
                </span>
              </div>
              <TopOpportunities stockMap={stockMap} srLevels={srLevels} minScore={6} maxScore={8} maxItems={5} />
            </div>

            {/* Trade Setups (Breakout/Bounce/Rejection/Breakdown) */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Crosshair className="size-4 text-orange-500" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Trade Setups
                </h2>
                <span className="text-xs text-muted-foreground/60">
                  Active patterns near key levels
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
