"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import type { StockData, SupportResistanceResult } from "@/lib/types";
import { INDEX_NAMES } from "@/lib/constants";

interface TopOpportunitiesProps {
  stockMap: Map<string, StockData>;
  srLevels: Record<string, SupportResistanceResult>;
}

function getScore(stock: StockData): number {
  return stock.signal?.score ?? 0;
}

function scoreColor(score: number): string {
  if (score >= 9) return "text-green-400 border-green-500 bg-green-500/10";
  if (score >= 7) return "text-green-500 border-green-500/50 bg-green-500/5";
  if (score >= 5) return "text-yellow-500 border-yellow-500/50 bg-yellow-500/5";
  return "text-zinc-400 border-zinc-500/50 bg-muted";
}

function signalTypeDisplay(type?: string): { label: string; color: string } {
  switch (type) {
    case "BREAKOUT": return { label: "BREAKOUT", color: "text-orange-500 bg-orange-500/10" };
    case "BREAKDOWN": return { label: "BREAKDOWN", color: "text-red-500 bg-red-500/10" };
    case "BOUNCE": return { label: "BOUNCE", color: "text-green-500 bg-green-500/10" };
    case "REJECTION": return { label: "REJECTION", color: "text-blue-500 bg-blue-500/10" };
    default: return { label: "", color: "" };
  }
}

function getEntry(
  stock: StockData,
  sr: SupportResistanceResult | undefined,
): string {
  const signal = stock.signal;
  if (!signal || !sr) return `₹${stock.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

  switch (signal.type) {
    case "BOUNCE":
      return sr.support !== null ? `Near support ₹${sr.support.toFixed(2)}` : `₹${stock.price.toFixed(2)}`;
    case "REJECTION":
      return sr.resistance !== null ? `Near resistance ₹${sr.resistance.toFixed(2)}` : `₹${stock.price.toFixed(2)}`;
    case "BREAKOUT":
      return sr.resistance !== null ? `Above ₹${sr.resistance.toFixed(2)}` : `₹${stock.price.toFixed(2)}`;
    case "BREAKDOWN":
      return sr.support !== null ? `Below ₹${sr.support.toFixed(2)}` : `₹${stock.price.toFixed(2)}`;
    default:
      return `₹${stock.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  }
}

function getStoploss(
  signal: StockData["signal"],
  sr: SupportResistanceResult | undefined,
): string | null {
  if (!signal || !sr) return null;
  switch (signal.type) {
    case "BOUNCE": return sr.support !== null ? `₹${sr.support.toFixed(2)}` : null;
    case "REJECTION": return sr.resistance !== null ? `₹${sr.resistance.toFixed(2)}` : null;
    case "BREAKOUT": return sr.resistance !== null ? `₹${sr.resistance.toFixed(2)}` : null;
    case "BREAKDOWN": return sr.support !== null ? `₹${sr.support.toFixed(2)}` : null;
    default: return null;
  }
}

function getRisk(sr: SupportResistanceResult | undefined): { label: string; color: string } {
  if (!sr) return { label: "Unknown", color: "text-muted-foreground" };
  const minDist = Math.min(
    sr.supportZone?.distancePercent ?? 100,
    sr.resistanceZone?.distancePercent ?? 100,
  );
  if (minDist < 1) return { label: "Low", color: "text-green-500" };
  if (minDist < 3) return { label: "Medium", color: "text-yellow-500" };
  return { label: "High", color: "text-red-500" };
}

function getStatus(stock: StockData, sr: SupportResistanceResult | undefined): string {
  const signal = stock.signal;
  if (!signal) return "";
  const stage = signal.stage;

  if (stage === "CONFIRMED") {
    if (signal.type === "BREAKOUT") return "Near breakout (prepare)";
    if (signal.type === "BREAKDOWN") return "Near breakdown";
    return "Fresh setup";
  }
  if (stage === "PRESSURE") return "Pressure confirmed";
  if (stage === "MOMENTUM") return "Developing";
  if (stage === "ACTIVITY") return "Waiting for confirmation";

  const score = signal.score ?? 0;
  if (score >= 7) return "Fresh setup";
  if (score >= 5) return "Developing";
  return "Waiting for confirmation";
}

export function TopOpportunities({ stockMap, srLevels }: TopOpportunitiesProps) {
  const router = useRouter();

  const opportunities = useMemo(() => {
    return Array.from(stockMap.values())
      .filter(
        (s) =>
          s.signal &&
          s.signal.action !== "WAIT" &&
          !INDEX_NAMES.has(s.symbol) &&
          getScore(s) >= 3
      )
      .sort((a, b) => getScore(b) - getScore(a))
      .slice(0, 6);
  }, [stockMap]);

  if (opportunities.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        No high-confidence setups right now
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {opportunities.map((stock) => {
        const signal = stock.signal!;
        const isBuy = signal.action === "BUY";
        const score = getScore(stock);
        const sr = srLevels[stock.symbol];
        const typeDisplay = signalTypeDisplay(signal.type);
        const entry = getEntry(stock, sr);
        const stoploss = getStoploss(signal, sr);
        const risk = getRisk(sr);
        const status = getStatus(stock, sr);
        const positive = stock.change >= 0;

        return (
          <Card
            key={stock.symbol}
            className={`relative cursor-pointer overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg border-l-4 ${
              isBuy ? "border-l-green-500" : "border-l-red-500"
            }`}
            onClick={() => router.push(`/stock/${encodeURIComponent(stock.symbol)}`)}
          >
            {/* Gradient */}
            <div className={`absolute inset-0 opacity-[0.03] ${
              isBuy ? "bg-gradient-to-br from-green-500 to-transparent" : "bg-gradient-to-br from-red-500 to-transparent"
            }`} />

            <div className="relative p-4 space-y-3">
              {/* Row 1: Symbol + Score */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-foreground">{stock.symbol}</span>
                  <span className={`text-xs font-mono tabular-nums ${
                    positive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                  }`}>
                    {positive ? "+" : ""}{stock.change.toFixed(2)}%
                  </span>
                </div>
                <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 text-sm font-black ${scoreColor(score)}`}>
                  {score}
                </div>
              </div>

              {/* Row 2: Signal Type Badge */}
              {typeDisplay.label ? (
                <span className={`inline-flex text-xs font-bold uppercase px-2 py-1 rounded ${typeDisplay.color}`}>
                  {typeDisplay.label}
                </span>
              ) : (
                <span className={`inline-flex text-xs font-bold uppercase px-2 py-1 rounded ${
                  isBuy ? "text-green-500 bg-green-500/10" : "text-red-500 bg-red-500/10"
                }`}>
                  {isBuy ? "BUY" : "SELL"}
                </span>
              )}

              {/* Row 3: Entry + Stoploss + Risk */}
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ENTRY</span>
                  <span className={`font-mono font-semibold ${isBuy ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                    {entry}
                  </span>
                </div>
                {stoploss && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">STOPLOSS</span>
                    <span className="font-mono text-orange-500">{stoploss}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">RISK</span>
                  <span className={`font-semibold ${risk.color}`}>{risk.label}</span>
                </div>
              </div>

              {/* Row 4: WHY (1 line) */}
              {signal.reasons[0] && (
                <p className="text-[11px] text-muted-foreground line-clamp-1">
                  {signal.reasons[0]}
                </p>
              )}

              {/* Row 5: Status */}
              {status && (
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
                  <span>⏱</span>
                  <span>{status}</span>
                </div>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
