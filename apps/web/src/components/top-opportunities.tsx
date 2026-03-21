"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import type {
  StockData,
  SignalConfidence,
  SupportResistanceResult,
} from "@/lib/types";
import { INDEX_NAMES } from "@/lib/constants";

interface TopOpportunitiesProps {
  stockMap: Map<string, StockData>;
  srLevels: Record<string, SupportResistanceResult>;
}

const CONFIDENCE_ORDER: Record<SignalConfidence, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

function computeScore(stock: StockData): number {
  let score = 0;
  const signal = stock.signal;
  if (!signal || signal.action === "WAIT") return 0;

  // Confidence: HIGH=4, MEDIUM=2.5, LOW=1
  score += signal.confidence === "HIGH" ? 4 : signal.confidence === "MEDIUM" ? 2.5 : 1;

  // Pressure confidence (0-1) scaled to 0-2
  if (stock.pressure) score += stock.pressure.confidence * 2;

  // Pattern match: +2 for pattern aligning with signal direction
  if (stock.pattern) {
    const aligns =
      (signal.action === "BUY" && stock.pattern.direction === "BULLISH") ||
      (signal.action === "SELL" && stock.pattern.direction === "BEARISH");
    score += aligns ? 2 : 0.5;
  }

  // Momentum alignment: +2 for strong aligned momentum
  if (stock.momentum) {
    const bullMom = ["STRONG_UP", "UP"].includes(stock.momentum.signal);
    const bearMom = ["STRONG_DOWN", "DOWN"].includes(stock.momentum.signal);
    if ((signal.action === "BUY" && bullMom) || (signal.action === "SELL" && bearMom)) {
      score += stock.momentum.signal.startsWith("STRONG") ? 2 : 1;
    }
  }

  return Math.min(10, Math.round(score));
}

function scoreLabel(score: number): string {
  if (score >= 8) return "great";
  if (score >= 6) return "good";
  if (score >= 4) return "fair";
  return "weak";
}

function scoreColor(score: number): string {
  if (score >= 8) return "border-green-500 text-green-500";
  if (score >= 5) return "border-yellow-500 text-yellow-500";
  return "border-zinc-500 text-zinc-500";
}

function signalBadge(
  action: "BUY" | "SELL",
  confidence: SignalConfidence
): { label: string; className: string } {
  const isHigh = confidence === "HIGH";
  if (action === "BUY") {
    return {
      label: isHigh ? "TOP SETUP" : "BUY SETUP",
      className: isHigh
        ? "bg-green-500/20 text-green-400"
        : "bg-green-500/10 text-green-500",
    };
  }
  return {
    label: isHigh ? "TOP SETUP" : "SELL SETUP",
    className: isHigh
      ? "bg-orange-500/20 text-orange-400"
      : "bg-orange-500/10 text-orange-500",
  };
}

function formatPatternName(pattern: string): string {
  return pattern
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

export function TopOpportunities({ stockMap, srLevels }: TopOpportunitiesProps) {
  const router = useRouter();

  const opportunities = useMemo(() => {
    return Array.from(stockMap.values())
      .filter(
        (s) =>
          s.signal &&
          s.signal.action !== "WAIT" &&
          !INDEX_NAMES.has(s.symbol)
      )
      .sort((a, b) => {
        const confA = CONFIDENCE_ORDER[a.signal!.confidence];
        const confB = CONFIDENCE_ORDER[b.signal!.confidence];
        if (confA !== confB) return confA - confB;
        const momOrder: Record<string, number> = {
          STRONG_UP: 0, UP: 1, FLAT: 2, DOWN: 3, STRONG_DOWN: 4,
        };
        const momA = a.momentum ? momOrder[a.momentum.signal] ?? 2 : 2;
        const momB = b.momentum ? momOrder[b.momentum.signal] ?? 2 : 2;
        return momA - momB;
      })
      .slice(0, 6);
  }, [stockMap]);

  if (opportunities.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        No active opportunities
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Top Opportunities
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {opportunities.map((stock) => {
          const signal = stock.signal!;
          const isBuy = signal.action === "BUY";
          const score = computeScore(stock);
          const sr = srLevels[stock.symbol];
          const badge = signalBadge(signal.action as "BUY" | "SELL", signal.confidence);

          // Decision Zone
          let decisionZone: string | null = null;
          let decisionZoneColor = "";
          if (sr) {
            if (isBuy && sr.supportZone) {
              decisionZone = `₹${sr.supportZone.min.toFixed(2)} – ₹${sr.supportZone.max.toFixed(2)}`;
              decisionZoneColor = "text-green-600 dark:text-green-400";
            } else if (!isBuy && sr.resistanceZone) {
              decisionZone = `₹${sr.resistanceZone.min.toFixed(2)} – ₹${sr.resistanceZone.max.toFixed(2)}`;
              decisionZoneColor = "text-red-600 dark:text-red-400";
            }
          }

          // Invalidation
          let invalidation: string | null = null;
          if (sr && signal.type) {
            switch (signal.type) {
              case "BOUNCE":
                if (sr.support !== null) invalidation = `Below ₹${sr.support.toFixed(2)}`;
                break;
              case "REJECTION":
                if (sr.resistance !== null) invalidation = `Above ₹${sr.resistance.toFixed(2)}`;
                break;
              case "BREAKOUT":
                if (sr.resistance !== null) invalidation = `Below ₹${sr.resistance.toFixed(2)}`;
                break;
              case "BREAKDOWN":
                if (sr.support !== null) invalidation = `Above ₹${sr.support.toFixed(2)}`;
                break;
            }
          }

          // Tags
          const tags: string[] = [];
          if (sr?.summary.hasNearbyResistance) tags.push("Near Resistance");
          if (sr?.summary.hasNearbySupport) tags.push("Near Support");
          if (
            stock.pressure &&
            (stock.pressure.signal === "STRONG_BUY" || stock.pressure.signal === "STRONG_SELL")
          ) {
            tags.push("Volume Spike");
          }
          if (stock.pattern) tags.push(formatPatternName(stock.pattern.pattern));

          // Primary reason line
          const primaryReason = signal.reasons[0] ?? "";
          const signalTypeLabel = signal.type
            ? signal.type.charAt(0) + signal.type.slice(1).toLowerCase()
            : "";

          return (
            <Card
              key={stock.symbol}
              className="relative cursor-pointer overflow-hidden transition-colors hover:bg-muted/50"
              onClick={() =>
                router.push(`/stock/${encodeURIComponent(stock.symbol)}`)
              }
            >
              <div className="p-4 space-y-3">
                {/* Top row: badge, action, symbol, score */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                    <span
                      className={`text-sm font-bold ${
                        isBuy
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {isBuy ? "↗" : "↘"} {isBuy ? "STRONG BUY" : "STRONG SELL"}
                    </span>
                    <span className="text-sm font-semibold text-foreground">
                      {stock.symbol}
                    </span>
                  </div>
                  {/* Score circle */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <div
                      className={`flex items-center justify-center w-8 h-8 rounded-full border-2 text-sm font-bold ${scoreColor(score)}`}
                    >
                      {score}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {scoreLabel(score)}
                    </span>
                  </div>
                </div>

                {/* Subtitle */}
                {(primaryReason || signalTypeLabel) && (
                  <p className="text-xs text-muted-foreground">
                    {primaryReason}
                    {primaryReason && signalTypeLabel ? " · " : ""}
                    {signalTypeLabel}
                  </p>
                )}

                {/* Why this trade */}
                {signal.reasons.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-1">
                      Why This Trade
                    </p>
                    <ul className="space-y-0.5">
                      {signal.reasons.slice(0, 3).map((r, i) => (
                        <li
                          key={i}
                          className="text-xs text-muted-foreground flex items-start gap-1"
                        >
                          <span className="mt-0.5">•</span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Details: Price, Decision Zone, Invalidation */}
                <div className="space-y-1 text-xs border-t border-border/50 pt-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Price</span>
                    <span className="font-mono font-semibold tabular-nums">
                      ₹{stock.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Decision Zone</span>
                    <span className={`font-mono tabular-nums ${decisionZoneColor}`}>
                      {decisionZone ?? "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Invalidation</span>
                    <span className="font-mono tabular-nums text-orange-500">
                      {invalidation ?? "—"}
                    </span>
                  </div>
                </div>

                {/* Tags */}
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
