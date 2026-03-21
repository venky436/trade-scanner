"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  TrendingUp,
  TrendingDown,
  Zap,
  ArrowUpFromLine,
  ArrowDownToLine,
  Flame,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import type { StockData, MomentumSignal } from "@/lib/types";
import { INDEX_NAMES } from "@/lib/constants";

interface TopSignalsProps {
  stockMap: Map<string, StockData>;
}

const CONFIDENCE_SCORE: Record<string, number> = {
  HIGH: 9,
  MEDIUM: 7,
  LOW: 3,
};

const MOMENTUM_RANK: Record<MomentumSignal, number> = {
  STRONG_UP: 2,
  UP: 1,
  FLAT: 0,
  DOWN: 1,
  STRONG_DOWN: 2,
};

const MOMENTUM_DISPLAY: Record<
  MomentumSignal,
  { label: string; arrow: string; color: string; bg: string }
> = {
  STRONG_UP: {
    label: "Strong Up",
    arrow: "↑↑",
    color: "text-green-600 dark:text-green-400",
    bg: "bg-green-500/10",
  },
  UP: {
    label: "Up",
    arrow: "↑",
    color: "text-green-600 dark:text-green-400",
    bg: "bg-green-500/10",
  },
  FLAT: {
    label: "Flat",
    arrow: "→",
    color: "text-muted-foreground",
    bg: "bg-muted",
  },
  DOWN: {
    label: "Down",
    arrow: "↓",
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-500/10",
  },
  STRONG_DOWN: {
    label: "Strong Down",
    arrow: "↓↓",
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-500/10",
  },
};

const SIGNAL_TYPE_ICON: Record<string, { icon: LucideIcon; color: string }> = {
  BOUNCE: { icon: ArrowUpFromLine, color: "text-green-500" },
  REJECTION: { icon: ArrowDownToLine, color: "text-red-500" },
  BREAKOUT: { icon: Flame, color: "text-orange-500" },
  BREAKDOWN: { icon: TrendingDown, color: "text-red-500" },
};

function getConfidenceLabel(score: number): "HIGH" | "MEDIUM" | "LOW" {
  if (score >= 8) return "HIGH";
  if (score >= 6) return "MEDIUM";
  return "LOW";
}

function getConfidenceBar(label: string): { width: string; color: string } {
  switch (label) {
    case "HIGH":
      return { width: "100%", color: "bg-green-500" };
    case "MEDIUM":
      return { width: "66%", color: "bg-yellow-500" };
    default:
      return { width: "33%", color: "bg-zinc-400" };
  }
}

function formatSignalType(type: string): string {
  switch (type) {
    case "BOUNCE":
      return "Support Bounce";
    case "REJECTION":
      return "Resistance Rejection";
    case "BREAKOUT":
      return "Breakout";
    case "BREAKDOWN":
      return "Breakdown";
    default:
      return type;
  }
}

export function TopSignals({ stockMap }: TopSignalsProps) {
  const router = useRouter();

  const topSignals = useMemo(() => {
    const actionable = Array.from(stockMap.values()).filter(
      (s) =>
        !INDEX_NAMES.has(s.symbol) && s.signal && s.signal.action !== "WAIT"
    );

    const strong = actionable.filter((s) => {
      const score = CONFIDENCE_SCORE[s.signal!.confidence] ?? 3;
      return score >= 7;
    });

    const sorted = strong.sort((a, b) => {
      const scoreA = CONFIDENCE_SCORE[a.signal!.confidence] ?? 3;
      const scoreB = CONFIDENCE_SCORE[b.signal!.confidence] ?? 3;
      if (scoreB !== scoreA) return scoreB - scoreA;

      const momA = MOMENTUM_RANK[a.momentum?.signal ?? "FLAT"];
      const momB = MOMENTUM_RANK[b.momentum?.signal ?? "FLAT"];
      return momB - momA;
    });

    return sorted.slice(0, 5);
  }, [stockMap]);

  if (topSignals.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Zap className="size-4 text-yellow-500 fill-yellow-500" />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Top Signals
        </h2>
        <span className="text-[10px] font-bold text-muted-foreground/60 bg-muted rounded-full px-2 py-0.5">
          {topSignals.length}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {topSignals.map((stock, i) => {
          const signal = stock.signal!;
          const isBuy = signal.action === "BUY";
          const positive = stock.change >= 0;
          const mom = stock.momentum
            ? MOMENTUM_DISPLAY[stock.momentum.signal]
            : null;
          const confScore = CONFIDENCE_SCORE[signal.confidence] ?? 3;
          const confLabel = getConfidenceLabel(confScore);
          const confBar = getConfidenceBar(confLabel);
          const typeInfo = signal.type
            ? SIGNAL_TYPE_ICON[signal.type]
            : null;
          const TypeIcon = typeInfo?.icon;

          return (
            <Card
              key={stock.symbol}
              className={`relative cursor-pointer overflow-hidden transition-all duration-200 hover:shadow-xl hover:shadow-black/5 dark:hover:shadow-black/20 hover:-translate-y-1 border-l-4 animate-fade-in-up ${
                isBuy
                  ? "border-l-green-500 hover:border-l-green-400"
                  : "border-l-red-500 hover:border-l-red-400"
              }`}
              style={{ animationDelay: `${i * 60}ms` }}
              onClick={() =>
                router.push(`/stock/${encodeURIComponent(stock.symbol)}`)
              }
            >
              {/* Subtle gradient overlay */}
              <div
                className={`absolute inset-0 opacity-[0.05] ${
                  isBuy
                    ? "bg-gradient-to-br from-green-500 to-transparent"
                    : "bg-gradient-to-br from-red-500 to-transparent"
                }`}
              />

              <div className="relative p-5 space-y-3">
                {/* Row 1: Action + Signal Type with icon */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`text-2xl font-black tracking-tight ${
                        isBuy
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {signal.action}
                    </span>
                    {signal.type && typeInfo && TypeIcon && (
                      <div
                        className={`flex items-center gap-1 ${typeInfo.color}`}
                      >
                        <TypeIcon className="size-3.5" />
                        <span className="text-xs font-medium">
                          {formatSignalType(signal.type)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Row 2: Symbol + Price/Change */}
                <div className="flex items-center justify-between">
                  <p className="text-lg font-bold text-foreground">
                    {stock.symbol}
                  </p>
                  <div className="text-right">
                    <span className="font-mono tabular-nums text-sm text-foreground">
                      ₹
                      {stock.price.toLocaleString("en-IN", {
                        maximumFractionDigits: 2,
                      })}
                    </span>
                    <span
                      className={`block text-xs font-mono tabular-nums ${
                        positive
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {positive ? "+" : ""}
                      {stock.change.toFixed(2)}%
                    </span>
                  </div>
                </div>

                {/* Row 3: Confidence bar + Momentum pill */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">Confidence</span>
                      <span
                        className={`font-semibold ${
                          confLabel === "HIGH"
                            ? "text-green-600 dark:text-green-400"
                            : confLabel === "MEDIUM"
                              ? "text-yellow-600 dark:text-yellow-400"
                              : "text-muted-foreground"
                        }`}
                      >
                        {confLabel}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${confBar.color}`}
                        style={{ width: confBar.width }}
                      />
                    </div>
                  </div>

                  {mom && (
                    <div
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${mom.bg} ${mom.color}`}
                    >
                      {mom.arrow.includes("↑") ? (
                        <TrendingUp className="size-3" />
                      ) : mom.arrow.includes("↓") ? (
                        <TrendingDown className="size-3" />
                      ) : null}
                      {mom.label}
                    </div>
                  )}
                </div>

                {/* Row 4: Top reasons */}
                {signal.reasons.length > 0 && (
                  <div className="border-t border-border/50 pt-2.5 space-y-0.5">
                    {signal.reasons.slice(0, 2).map((r, ri) => (
                      <p
                        key={ri}
                        className="text-[11px] text-muted-foreground leading-tight flex items-start gap-1"
                      >
                        <span className="mt-px shrink-0">•</span>
                        <span className="line-clamp-1">{r}</span>
                      </p>
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
