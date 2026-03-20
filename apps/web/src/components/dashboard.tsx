"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Header } from "./header";
import { StockTable } from "./stock-table";
import { StockTableSkeleton } from "./stock-table-skeleton";
import { SRCards } from "./sr-cards";
import { useMarketData } from "@/hooks/use-market-data";
import type { SortKey, SortDirection, SupportResistanceResult, PatternSignal } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4002";

// Module-level cache so S/R levels survive component remounts (navigation)
let srLevelsCache: Record<string, SupportResistanceResult> = {};
let patternsCache: Record<string, PatternSignal> = {};

export function Dashboard() {
  const { stockMap, isConnected } = useMarketData();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("symbol");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [kiteConnected, setKiteConnected] = useState(false);
  const [srLevels, setSrLevels] = useState<Record<string, SupportResistanceResult>>(srLevelsCache);
  const [patterns, setPatterns] = useState<Record<string, PatternSignal>>(patternsCache);

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

  // Fetch S/R levels once stocks are available (skip if cached)
  const hasStocks = stockMap.size > 0;
  const hasCachedLevels = Object.keys(srLevelsCache).length > 0;
  useEffect(() => {
    if (!hasStocks || hasCachedLevels) return;
    let active = true;

    async function fetchLevels() {
      try {
        const res = await fetch(`${API_URL}/api/stocks/levels`);
        if (!res.ok) {
          console.warn("[SR] levels fetch failed:", res.status, res.statusText);
          return;
        }
        const data = await res.json();
        if (active && data.levels) {
          srLevelsCache = data.levels;
          setSrLevels(data.levels);
        }
      } catch (err) {
        console.warn("[SR] levels fetch error:", err);
      }
    }

    fetchLevels();
    return () => { active = false; };
  }, [hasStocks, hasCachedLevels]);

  // Fetch candlestick patterns after S/R levels are loaded
  const hasSrLevels = Object.keys(srLevels).length > 0;
  useEffect(() => {
    if (!hasSrLevels) return;
    let active = true;

    async function fetchPatterns() {
      try {
        const res = await fetch(`${API_URL}/api/stocks/patterns`);
        if (!res.ok) return;
        const data = await res.json();
        if (active && data.patterns) {
          patternsCache = data.patterns;
          setPatterns(data.patterns);
        }
      } catch (err) {
        console.warn("[Pattern] fetch error:", err);
      }
    }

    fetchPatterns();
    const interval = setInterval(fetchPatterns, 5 * 60 * 1000);
    return () => { active = false; clearInterval(interval); };
  }, [hasSrLevels]);

  const handleSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) {
        setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDirection(key === "symbol" ? "asc" : "desc");
      }
    },
    [sortKey]
  );

  const filteredAndSorted = useMemo(() => {
    let result = Array.from(stockMap.values());

    if (searchQuery) {
      const q = searchQuery.toUpperCase();
      result = result.filter((s) => s.symbol.toUpperCase().includes(q));
    }

    result.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];

      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDirection === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      const diff = (aVal as number) - (bVal as number);
      return sortDirection === "asc" ? diff : -diff;
    });

    return result;
  }, [stockMap, searchQuery, sortKey, sortDirection]);

  const isLoading = stockMap.size === 0 && kiteConnected;

  return (
    <main className="p-4 max-w-[1400px] mx-auto">
      <Header
        isConnected={isConnected}
        kiteConnected={kiteConnected}
        stockCount={filteredAndSorted.length}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />
      {Object.keys(srLevels).length > 0 && (
        <SRCards stockMap={stockMap} levels={srLevels} patterns={patterns} />
      )}
      <Card className="border-border/50">
        <CardContent className="p-0">
          {!kiteConnected ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <p className="text-lg">Not connected to Kite</p>
              <p className="text-sm mt-1">
                Click <span className="text-yellow-400 font-medium">Connect Kite</span> above to login and start streaming market data.
              </p>
            </div>
          ) : isLoading ? (
            <StockTableSkeleton />
          ) : (
            <StockTable
              stocks={filteredAndSorted}
              sortKey={sortKey}
              sortDirection={sortDirection}
              onSort={handleSort}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
