"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Flame, TrendingDown, ArrowUpFromLine, ArrowDownToLine, ArrowUpRight, X } from "lucide-react";
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
  bg: string;
  iconBg: string;
  glow: string;
}[] = [
  {
    type: "BREAKOUT",
    label: "Breakout",
    icon: Flame,
    accent: "text-orange-500",
    bg: "bg-gradient-to-br from-orange-500/10 via-transparent to-transparent",
    iconBg: "bg-orange-500/15",
    glow: "hover:shadow-orange-500/10",
  },
  {
    type: "BREAKDOWN",
    label: "Breakdown",
    icon: TrendingDown,
    accent: "text-red-500",
    bg: "bg-gradient-to-br from-red-500/10 via-transparent to-transparent",
    iconBg: "bg-red-500/15",
    glow: "hover:shadow-red-500/10",
  },
  {
    type: "BOUNCE",
    label: "Support Bounce",
    icon: ArrowUpFromLine,
    accent: "text-green-500",
    bg: "bg-gradient-to-br from-green-500/10 via-transparent to-transparent",
    iconBg: "bg-green-500/15",
    glow: "hover:shadow-green-500/10",
  },
  {
    type: "REJECTION",
    label: "Resistance Rejection",
    icon: ArrowDownToLine,
    accent: "text-blue-500",
    bg: "bg-gradient-to-br from-blue-500/10 via-transparent to-transparent",
    iconBg: "bg-blue-500/15",
    glow: "hover:shadow-blue-500/10",
  },
];

export function WatchlistCards({ stockMap }: WatchlistCardsProps) {
  const router = useRouter();
  const [expandedType, setExpandedType] = useState<SignalType | null>(null);

  const { counts, stocksByType } = useMemo(() => {
    const counts: Record<string, number> = {
      BREAKOUT: 0, BREAKDOWN: 0, BOUNCE: 0, REJECTION: 0,
    };
    const stocksByType: Record<string, StockData[]> = {
      BREAKOUT: [], BREAKDOWN: [], BOUNCE: [], REJECTION: [],
    };

    for (const stock of stockMap.values()) {
      if (INDEX_NAMES.has(stock.symbol)) continue;
      if (stock.signal && stock.signal.action !== "WAIT" && stock.signal.type) {
        counts[stock.signal.type] = (counts[stock.signal.type] ?? 0) + 1;
        stocksByType[stock.signal.type]?.push(stock);
      }
    }

    // Sort each category by score descending
    for (const type of Object.keys(stocksByType)) {
      stocksByType[type].sort((a, b) => (b.signal?.score ?? 0) - (a.signal?.score ?? 0));
      stocksByType[type] = stocksByType[type].slice(0, 5); // top 5
    }

    return { counts, stocksByType };
  }, [stockMap]);

  return (
    <div className="space-y-3">
      {/* Category cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {CATEGORIES.map(({ type, label, icon: Icon, accent, bg, iconBg, glow }) => {
          const count = counts[type] ?? 0;
          const isExpanded = expandedType === type;

          return (
            <div
              key={type}
              onClick={() => setExpandedType(isExpanded ? null : type)}
              className={`relative overflow-hidden rounded-xl border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg cursor-pointer ${glow} ${
                isExpanded ? "border-border ring-1 ring-border" : "border-border/50"
              }`}
            >
              <div className={`absolute inset-0 ${bg}`} />

              <div className="relative flex items-center gap-3">
                <div className={`flex items-center justify-center size-10 rounded-lg ${iconBg} shrink-0`}>
                  <Icon className={`size-5 ${accent}`} />
                </div>

                <div>
                  <p className="text-sm font-semibold text-foreground">{label}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className={`font-bold ${count > 0 ? accent : ""}`}>{count}</span>
                    {" "}{count === 1 ? "stock" : "stocks"}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Expanded stock list */}
      {expandedType && (
        <div className="rounded-xl border border-border/50 overflow-hidden animate-fade-in-up">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
            <div className="flex items-center gap-2">
              {(() => {
                const cat = CATEGORIES.find((c) => c.type === expandedType);
                if (!cat) return null;
                const Icon = cat.icon;
                return (
                  <>
                    <Icon className={`size-4 ${cat.accent}`} />
                    <span className="text-sm font-semibold">{cat.label}</span>
                    <span className="text-xs text-muted-foreground">
                      Top {stocksByType[expandedType]?.length ?? 0}
                    </span>
                  </>
                );
              })()}
            </div>
            <button
              onClick={() => setExpandedType(null)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>

          {(stocksByType[expandedType]?.length ?? 0) === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              No high-confidence setups right now
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {stocksByType[expandedType]?.map((stock) => {
                const positive = stock.change >= 0;
                return (
                  <div
                    key={stock.symbol}
                    className="group flex items-center justify-between px-4 py-2.5 hover:bg-muted/40 cursor-pointer transition-colors"
                    onClick={() => router.push(`/stock/${encodeURIComponent(stock.symbol)}`)}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-sm text-foreground">{stock.symbol}</span>
                      <span className={`text-xs font-mono tabular-nums ${
                        positive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                      }`}>
                        {positive ? "+" : ""}{stock.change.toFixed(2)}%
                      </span>
                      <ArrowUpRight className="size-3 text-muted-foreground/0 group-hover:text-muted-foreground/50 transition-all" />
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-mono tabular-nums text-foreground">
                        ₹{stock.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                      </span>
                      {stock.signal?.score && (
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                          stock.signal.score >= 8 ? "bg-green-500/15 text-green-600 dark:text-green-400" :
                          stock.signal.score >= 5 ? "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400" :
                          "bg-muted text-muted-foreground"
                        }`}>
                          {stock.signal.score}/10
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
