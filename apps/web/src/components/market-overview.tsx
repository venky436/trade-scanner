"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { TrendingUp, TrendingDown, ArrowUpRight } from "lucide-react";
import type { StockData } from "@/lib/types";
import { OVERVIEW_INDICES } from "@/lib/constants";

interface MarketOverviewProps {
  stockMap: Map<string, StockData>;
}

const SHORT_LABELS: Record<string, string> = {
  "NIFTY 50": "NIFTY 50",
  "NIFTY BANK": "BANK NIFTY",
  "SENSEX": "SENSEX",
  "NIFTY FIN SERVICE": "FIN NIFTY",
};

export function MarketOverview({ stockMap }: MarketOverviewProps) {
  const router = useRouter();

  const indices = useMemo(() => {
    return OVERVIEW_INDICES
      .map((name) => stockMap.get(name))
      .filter((s): s is StockData => s !== undefined);
  }, [stockMap]);

  if (indices.length === 0) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {indices.map((idx) => {
        const positive = idx.change >= 0;
        const absChange = idx.price - idx.open;
        const label = SHORT_LABELS[idx.symbol] ?? idx.symbol;

        return (
          <div
            key={idx.symbol}
            className="group relative cursor-pointer overflow-hidden rounded-xl bg-card/80 backdrop-blur-sm border border-border/50 px-4 py-4 transition-all duration-200 hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-black/20 hover:border-border hover:-translate-y-0.5"
            onClick={() =>
              router.push(`/stock/${encodeURIComponent(idx.symbol)}`)
            }
          >
            {/* Top accent bar */}
            <div
              className={`absolute top-0 left-0 right-0 h-0.5 ${
                positive ? "bg-green-500" : "bg-red-500"
              }`}
            />

            {/* Subtle gradient background */}
            <div
              className={`absolute inset-0 opacity-[0.04] ${
                positive
                  ? "bg-gradient-to-br from-green-500/50 via-transparent to-transparent"
                  : "bg-gradient-to-br from-red-500/50 via-transparent to-transparent"
              }`}
            />

            {/* Navigation hint */}
            <ArrowUpRight className="absolute top-2.5 right-2.5 size-3.5 text-muted-foreground/0 group-hover:text-muted-foreground/50 transition-all" />

            {/* Content */}
            <div className="relative flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                  <p className="text-[11px] text-muted-foreground font-medium truncate">
                    {label}
                  </p>
                </div>
                <p className="text-xl font-bold font-mono tabular-nums text-foreground">
                  {idx.price.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </p>
              </div>

              <div className="flex flex-col items-end gap-0.5 shrink-0">
                <div className="flex items-center gap-1">
                  {positive ? (
                    <TrendingUp className="size-3.5 text-green-600 dark:text-green-400" />
                  ) : (
                    <TrendingDown className="size-3.5 text-red-600 dark:text-red-400" />
                  )}
                  <span
                    className={`text-sm font-mono font-bold tabular-nums ${
                      positive
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {positive ? "+" : ""}
                    {absChange.toFixed(2)}
                  </span>
                </div>
                <span
                  className={`text-xs font-mono tabular-nums ${
                    positive
                      ? "text-green-600/70 dark:text-green-400/70"
                      : "text-red-600/70 dark:text-red-400/70"
                  }`}
                >
                  {positive ? "+" : ""}
                  {idx.change.toFixed(2)}%
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
