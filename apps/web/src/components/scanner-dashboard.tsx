"use client";

import { useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import type { StockData, SupportResistanceResult } from "@/lib/types";
import { INDEX_NAMES } from "@/lib/constants";

let hasAnimatedSR = false;

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
  const shouldAnimate = useRef(!hasAnimatedSR);
  useEffect(() => { hasAnimatedSR = true; }, []);

  const isGreen = color === "green";
  const accentDot = isGreen ? "bg-green-400 shadow-sm shadow-green-400/50" : "bg-red-400 shadow-sm shadow-red-400/50";
  const levelColor = isGreen ? "text-green-400" : "text-red-400";
  const accentLine = isGreen
    ? "bg-gradient-to-r from-green-500/60 via-green-400/30 to-transparent"
    : "bg-gradient-to-r from-red-500/60 via-red-400/30 to-transparent";
  const distColor = (dist: number) => {
    if (dist < 0.1) return isGreen ? "text-green-400 font-bold" : "text-red-400 font-bold";
    if (dist < 0.5) return "text-yellow-400";
    return "text-muted-foreground/60";
  };

  return (
    <div className="relative overflow-hidden rounded-2xl backdrop-blur-xl bg-white/[0.02] border border-border/20">
      {/* Top accent line */}
      <div className={`absolute top-0 left-0 right-0 h-[2px] ${accentLine}`} />

      <div className="p-4">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <span className={`inline-block h-2 w-2 rounded-full ${accentDot}`} />
          <h3 className="text-sm font-bold tracking-wide text-foreground">{title}</h3>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ring-1 ${
            isGreen ? "text-green-400/70 ring-green-500/20 bg-green-500/8" : "text-red-400/70 ring-red-500/20 bg-red-500/8"
          }`}>
            {rows.length}
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 py-6 text-center">
            No stocks nearby
          </p>
        ) : (
          <div>
            {/* Column headers */}
            <div className="grid grid-cols-[1fr_minmax(70px,auto)_minmax(70px,auto)_minmax(50px,auto)] gap-x-3 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40 pb-2 mb-1">
              <span>Symbol</span>
              <span className="text-right">Price</span>
              <span className="text-right">{levelLabel}</span>
              <span className="text-right">Dist</span>
            </div>

            {/* Rows */}
            <div className="space-y-0.5">
              {rows.map((row, i) => (
                <div
                  key={row.symbol}
                  className={`group grid grid-cols-[1fr_minmax(70px,auto)_minmax(70px,auto)_minmax(50px,auto)] gap-x-3 py-2 text-xs cursor-pointer hover:bg-white/[0.03] rounded-lg -mx-2 px-2 transition-all duration-200 ${shouldAnimate.current ? "animate-fade-in-up" : ""}`}
                  style={shouldAnimate.current ? { animationDelay: `${i * 40}ms` } : undefined}
                  onClick={() => router.push(`/stock/${encodeURIComponent(row.symbol)}`)}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-foreground">{row.symbol}</span>
                    <ArrowUpRight className="size-3 text-muted-foreground/0 group-hover:text-muted-foreground/50 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </div>
                  <span className="text-right font-mono tabular-nums text-muted-foreground">
                    {row.price.toFixed(2)}
                  </span>
                  <span className={`text-right font-mono tabular-nums font-semibold ${levelColor}`}>
                    {row.level.toFixed(2)}
                  </span>
                  <span className={`text-right font-mono tabular-nums ${distColor(row.distancePercent)}`}>
                    {row.distancePercent.toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
