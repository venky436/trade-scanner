"use client";

import { useMemo } from "react";
import { Flame, TrendingDown, ArrowUpFromLine, ArrowDownToLine } from "lucide-react";
import type { StockData, SignalType } from "@/lib/types";
import { INDEX_NAMES } from "@/lib/constants";

interface WatchlistCardsProps {
  stockMap: Map<string, StockData>;
}

const CATEGORIES: {
  type: SignalType;
  label: string;
  icon: typeof Flame;
  accent: string;
}[] = [
  { type: "BREAKOUT", label: "Breakout", icon: Flame, accent: "text-orange-500" },
  { type: "BREAKDOWN", label: "Breakdown", icon: TrendingDown, accent: "text-red-500" },
  { type: "BOUNCE", label: "Support Bounce", icon: ArrowUpFromLine, accent: "text-green-500" },
  { type: "REJECTION", label: "Resistance Rejection", icon: ArrowDownToLine, accent: "text-blue-500" },
];

export function WatchlistCards({ stockMap }: WatchlistCardsProps) {
  const counts = useMemo(() => {
    const map: Record<string, number> = {
      BREAKOUT: 0,
      BREAKDOWN: 0,
      BOUNCE: 0,
      REJECTION: 0,
    };

    for (const stock of stockMap.values()) {
      if (INDEX_NAMES.has(stock.symbol)) continue;
      if (stock.signal && stock.signal.action !== "WAIT" && stock.signal.type) {
        map[stock.signal.type] = (map[stock.signal.type] ?? 0) + 1;
      }
    }

    return map;
  }, [stockMap]);

  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
        Watchlists
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        Actionable trade setups near key levels
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {CATEGORIES.map(({ type, label, icon: Icon, accent }) => {
          const count = counts[type] ?? 0;
          return (
            <div
              key={type}
              className="bg-card border border-border/50 rounded-lg p-4 flex items-center gap-3 cursor-default"
            >
              <Icon className={`size-5 ${accent} shrink-0`} />
              <div>
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="text-xs text-muted-foreground">
                  {count} {count === 1 ? "stock" : "stocks"}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
