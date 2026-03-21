"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import type { StockData, SupportResistanceResult } from "@/lib/types";
import { INDEX_NAMES } from "@/lib/constants";

interface ScannerDashboardProps {
  stockMap: Map<string, StockData>;
  srLevels: Record<string, SupportResistanceResult>;
}

interface SRRow {
  symbol: string;
  price: number;
  level: number;
  distancePercent: number;
}

export function ScannerDashboard({ stockMap, srLevels }: ScannerDashboardProps) {
  const { nearSupport, nearResistance } = useMemo(() => {
    const support: SRRow[] = [];
    const resistance: SRRow[] = [];

    for (const [symbol, sr] of Object.entries(srLevels)) {
      const stock = stockMap.get(symbol);
      if (!stock || stock.price <= 0 || INDEX_NAMES.has(symbol)) continue;

      if (sr.summary.hasNearbySupport && sr.support !== null) {
        const dist = ((stock.price - sr.support) / stock.price) * 100;
        if (dist >= 0) {
          support.push({ symbol, price: stock.price, level: sr.support, distancePercent: dist });
        }
      }

      if (sr.summary.hasNearbyResistance && sr.resistance !== null) {
        const dist = ((sr.resistance - stock.price) / stock.price) * 100;
        if (dist >= 0) {
          resistance.push({ symbol, price: stock.price, level: sr.resistance, distancePercent: dist });
        }
      }
    }

    support.sort((a, b) => a.distancePercent - b.distancePercent);
    resistance.sort((a, b) => a.distancePercent - b.distancePercent);

    return {
      nearSupport: support.slice(0, 7),
      nearResistance: resistance.slice(0, 7),
    };
  }, [stockMap, srLevels]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <SRWidget
        title="Near Support"
        rows={nearSupport}
        color="green"
        levelLabel="Support"
      />
      <SRWidget
        title="Near Resistance"
        rows={nearResistance}
        color="red"
        levelLabel="Resist"
      />
    </div>
  );
}

function SRWidget({
  title,
  rows,
  color,
  levelLabel,
}: {
  title: string;
  rows: SRRow[];
  color: "green" | "red";
  levelLabel: string;
}) {
  const router = useRouter();

  const dotColor = color === "green" ? "bg-green-500" : "bg-red-500";
  const levelColor = color === "green"
    ? "text-green-600 dark:text-green-400"
    : "text-red-600 dark:text-red-400";
  const borderColor = color === "green" ? "border-t-green-500" : "border-t-red-500";
  const gradientColor = color === "green"
    ? "from-green-500/5 via-transparent to-transparent"
    : "from-red-500/5 via-transparent to-transparent";

  return (
    <div className={`relative overflow-hidden rounded-xl border border-border/50 border-t-2 ${borderColor}`}>
      {/* Subtle gradient */}
      <div className={`absolute inset-0 bg-gradient-to-br ${gradientColor}`} />

      <div className="relative p-4">
        {/* Header */}
        <div className="flex items-center gap-2 mb-3">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${dotColor}`} />
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <span className="text-[10px] font-bold text-muted-foreground/60 bg-muted rounded-full px-2 py-0.5">
            {rows.length}
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            No stocks nearby
          </p>
        ) : (
          <div className="space-y-0">
            {/* Column headers */}
            <div className="grid grid-cols-[1fr_minmax(70px,auto)_minmax(70px,auto)_minmax(50px,auto)] gap-x-3 text-[10px] font-semibold uppercase text-muted-foreground pb-1.5 border-b border-border/50">
              <span>Symbol</span>
              <span className="text-right">Price</span>
              <span className="text-right">{levelLabel}</span>
              <span className="text-right">Dist</span>
            </div>

            {/* Rows */}
            {rows.map((row) => (
              <div
                key={row.symbol}
                className="group grid grid-cols-[1fr_minmax(70px,auto)_minmax(70px,auto)_minmax(50px,auto)] gap-x-3 py-2 text-xs cursor-pointer hover:bg-muted/40 rounded-md -mx-1 px-1 transition-colors"
                onClick={() =>
                  router.push(`/stock/${encodeURIComponent(row.symbol)}`)
                }
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-foreground">{row.symbol}</span>
                  <ArrowUpRight className="size-3 text-muted-foreground/0 group-hover:text-muted-foreground/50 transition-all" />
                </div>
                <span className="text-right font-mono tabular-nums text-foreground">
                  {row.price.toFixed(2)}
                </span>
                <span className={`text-right font-mono tabular-nums ${levelColor}`}>
                  {row.level.toFixed(2)}
                </span>
                <span className="text-right font-mono tabular-nums text-muted-foreground">
                  {row.distancePercent.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
