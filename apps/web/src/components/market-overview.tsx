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
            className={`
              group relative cursor-pointer overflow-hidden rounded-2xl
              px-5 py-5 transition-all duration-300
              ${positive
                ? "bg-gradient-to-br from-green-500/[0.08] via-green-500/[0.03] to-transparent border border-green-500/20"
                : "bg-gradient-to-br from-red-500/[0.08] via-red-500/[0.03] to-transparent border border-red-500/20"
              }
              backdrop-blur-xl
            `}
            onClick={() => router.push(`/stock/${encodeURIComponent(idx.symbol)}`)}
          >
            {/* Glass shine effect */}
            <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-transparent rounded-2xl" />

            {/* Top accent glow */}
            <div className={`absolute top-0 left-4 right-4 h-px ${positive ? "bg-green-500/50" : "bg-red-500/50"}`} />

            {/* Navigation hint */}
            <ArrowUpRight className="absolute top-3 right-3 size-3.5 text-muted-foreground/0 group-hover:text-muted-foreground/40 transition-all duration-300" />

            {/* Content */}
            <div className="relative flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className={`inline-block h-2 w-2 rounded-full ${positive ? "bg-green-500" : "bg-red-500"} animate-pulse`} />
                  <p className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider truncate">
                    {label}
                  </p>
                </div>
                <p className="text-2xl font-bold font-mono tabular-nums text-foreground">
                  {idx.price.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </p>
              </div>

              <div className="flex flex-col items-end gap-0.5 shrink-0">
                <div className="flex items-center gap-1">
                  {positive ? (
                    <TrendingUp className="size-4 text-green-500" />
                  ) : (
                    <TrendingDown className="size-4 text-red-500" />
                  )}
                  <span className={`text-sm font-mono font-bold tabular-nums ${positive ? "text-green-500" : "text-red-500"}`}>
                    {positive ? "+" : ""}{absChange.toFixed(2)}
                  </span>
                </div>
                <span className={`text-xs font-mono tabular-nums ${positive ? "text-green-500/60" : "text-red-500/60"}`}>
                  {positive ? "+" : ""}{idx.change.toFixed(2)}%
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
