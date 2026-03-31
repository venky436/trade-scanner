"use client";

import { useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Target } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { StockData, SupportResistanceResult } from "@/lib/types";
import { INDEX_NAMES } from "@/lib/constants";
import { AddToWatchZoneButton } from "./watch-zone";
import { useAuth } from "@/context/auth-context";

let hasAnimatedOpportunities = false;

interface TopOpportunitiesProps {
  stockMap: Map<string, StockData>;
  srLevels: Record<string, SupportResistanceResult>;
  minScore?: number;
  maxScore?: number;
  maxItems?: number;
  includeWait?: boolean;
}

function getScore(stock: StockData): number {
  // Use phase-adjusted finalScore if available, fallback to raw score
  return stock.signal?.finalScore ?? stock.signal?.score ?? 0;
}

function scoreColor(score: number): string {
  if (score >= 8) return "border-green-500 text-green-500";
  if (score >= 6) return "border-yellow-500 text-yellow-500";
  return "border-zinc-500 text-zinc-400";
}

// Context-aware signal label (matching detail page)
function getSignalLabel(
  stock: StockData,
  sr: SupportResistanceResult | undefined,
): { label: string; color: string } {
  const signal = stock.signal;
  if (!signal) return { label: "—", color: "" };

  const nearRes = sr?.summary.hasNearbyResistance;
  const nearSup = sr?.summary.hasNearbySupport;

  if (signal.type === "REJECTION" || (nearRes && signal.action === "SELL")) {
    return { label: "Rejection Setup", color: "text-blue-500 bg-blue-500/10" };
  }
  if (signal.type === "BOUNCE" || (nearSup && signal.action === "BUY")) {
    return { label: "Bounce Setup", color: "text-green-500 bg-green-500/10" };
  }
  if (signal.type === "BREAKOUT") {
    return { label: "Breakout", color: "text-orange-500 bg-orange-500/10" };
  }
  if (signal.type === "BREAKDOWN") {
    return { label: "Breakdown", color: "text-red-500 bg-red-500/10" };
  }

  return {
    label: signal.action,
    color: signal.action === "BUY" ? "text-green-500 bg-green-500/15" : "text-red-500 bg-red-500/15",
  };
}

// Decision based on S/R context
function getDecision(
  stock: StockData,
  sr: SupportResistanceResult | undefined,
  score: number,
): { isWait: boolean; primaryPlan: string | null } {
  const signal = stock.signal;
  if (!signal) return { isWait: true, primaryPlan: null };

  const nearRes = sr?.summary.hasNearbyResistance;
  const nearSup = sr?.summary.hasNearbySupport;
  const momUp = stock.momentum?.signal === "STRONG_UP" || stock.momentum?.signal === "UP";
  const momDown = stock.momentum?.signal === "STRONG_DOWN" || stock.momentum?.signal === "DOWN";

  // Near resistance + up momentum = WAIT (rejection likely)
  if (nearRes && momUp) {
    const rejLevel = sr?.resistance != null ? `₹${(sr.resistance * 0.992).toFixed(0)}` : null;
    return {
      isWait: true,
      primaryPlan: rejLevel ? `SELL below ${rejLevel} → rejection` : null,
    };
  }

  // Near support + down momentum = WAIT (bounce likely)
  if (nearSup && momDown) {
    const bounceLevel = sr?.support != null ? `₹${sr.support.toFixed(0)}` : null;
    return {
      isWait: true,
      primaryPlan: bounceLevel ? `BUY near ${bounceLevel} → bounce` : null,
    };
  }

  return { isWait: false, primaryPlan: null };
}

export function TopOpportunities({ stockMap, srLevels, minScore = 3, maxScore, maxItems = 6, includeWait = false }: TopOpportunitiesProps) {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const shouldAnimate = useRef(!hasAnimatedOpportunities);
  useEffect(() => { hasAnimatedOpportunities = true; }, []);

  const opportunities = useMemo(() => {
    return Array.from(stockMap.values())
      .filter(
        (s) =>
          s.signal &&
          (includeWait || s.signal.action !== "WAIT") &&
          !INDEX_NAMES.has(s.symbol) &&
          getScore(s) >= minScore &&
          (maxScore == null || getScore(s) < maxScore)
      )
      .sort((a, b) => {
        // 1. Closest to S/R level first
        const srA = srLevels[a.symbol];
        const srB = srLevels[b.symbol];
        const distA = Math.min(srA?.supportZone?.distancePercent ?? 100, srA?.resistanceZone?.distancePercent ?? 100);
        const distB = Math.min(srB?.supportZone?.distancePercent ?? 100, srB?.resistanceZone?.distancePercent ?? 100);
        if (Math.abs(distA - distB) > 1) return distA - distB;
        // 2. Highest score
        const scoreDiff = getScore(b) - getScore(a);
        if (scoreDiff !== 0) return scoreDiff;
        // 3. Strongest momentum
        const momRank: Record<string, number> = { STRONG_UP: 5, UP: 4, FLAT: 3, DOWN: 2, STRONG_DOWN: 1 };
        const momA = momRank[a.momentum?.signal ?? "FLAT"] ?? 3;
        const momB = momRank[b.momentum?.signal ?? "FLAT"] ?? 3;
        return momB - momA;
      })
      .slice(0, maxItems);
  }, [stockMap, minScore, maxScore, maxItems]);

  if (opportunities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Target className="size-10 mb-3 text-muted-foreground/20" />
        <p className="text-sm font-medium">No setups found</p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          High-confidence opportunities will appear here during market hours
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {opportunities.map((stock, i) => {
        const signal = stock.signal!;
        const score = getScore(stock);
        const sr = srLevels[stock.symbol];
        const signalLabel = getSignalLabel(stock, sr);
        const { isWait, primaryPlan } = getDecision(stock, sr, score);
        const positive = stock.change >= 0;

        const nearRes = sr?.summary.hasNearbyResistance;
        const nearSup = sr?.summary.hasNearbySupport;
        const resDist = sr?.resistanceZone?.distancePercent;
        const supDist = sr?.supportZone?.distancePercent;

        const scoreDecision = score >= 8 ? "Enter now"
          : isWait ? "Not safe to enter"
          : score >= 6 ? "Watch only"
          : "Skip";

        const accentBorder = score >= 8 ? "border-l-green-500" :
          score >= 6 ? "border-l-yellow-500" : "border-l-zinc-600";

        return (
          <div
            key={stock.symbol}
            className={`group relative cursor-pointer overflow-hidden rounded-2xl backdrop-blur-xl bg-white/[0.02] border border-border/20 border-l-[3px] ${accentBorder} transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg ${shouldAnimate.current ? "animate-fade-in-up" : ""}`}
            style={shouldAnimate.current ? { animationDelay: `${i * 60}ms` } : undefined}
            onClick={() => router.push(`/stock/${encodeURIComponent(stock.symbol)}`)}
          >
            {/* Content */}
            <div className="p-4 space-y-2.5">
              {/* Header: Signal + Symbol + Change + Score Ring */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ring-1 ${
                      signalLabel.color.includes("green") ? "ring-green-500/20" :
                      signalLabel.color.includes("blue") ? "ring-blue-500/20" :
                      signalLabel.color.includes("orange") ? "ring-orange-500/20" :
                      "ring-red-500/20"
                    } ${signalLabel.color}`}>
                      {signalLabel.label}
                    </span>
                    {stock.pattern && (
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ring-1 ${
                        stock.pattern.direction === "BULLISH"
                          ? "bg-green-500/10 text-green-400 ring-green-500/15"
                          : "bg-red-500/10 text-red-400 ring-red-500/15"
                      }`}>
                        {stock.pattern.pattern.split("_").map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(" ")}
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-base font-extrabold text-foreground tracking-tight">{stock.symbol}</span>
                    <span className={`text-xs font-mono font-bold tabular-nums ${
                      positive ? "text-green-400" : "text-red-400"
                    }`}>
                      {positive ? "+" : ""}{stock.change.toFixed(2)}%
                    </span>
                  </div>
                </div>

                {/* Score Ring + Add Button */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <div className="relative w-10 h-10">
                    <svg className="w-full h-full -rotate-90" viewBox="0 0 40 40">
                      <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="3" className="text-white/[0.06]" />
                      <circle
                        cx="20" cy="20" r="16" fill="none"
                        strokeWidth="3" strokeLinecap="round"
                        strokeDasharray={`${score * 10.05} 100.5`}
                        className={score >= 8 ? "stroke-green-400" : score >= 6 ? "stroke-yellow-400" : "stroke-zinc-500"}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className={`text-xs font-extrabold tabular-nums ${
                        score >= 8 ? "text-green-400" : score >= 6 ? "text-yellow-400" : "text-zinc-400"
                      }`}>{score}</span>
                    </div>
                  </div>
                  <AddToWatchZoneButton
                    symbol={stock.symbol}
                    price={stock.price}
                    signalAction={signal.action}
                    signalType={signal.type}
                    isLoggedIn={isAuthenticated}
                  />
                </div>
              </div>

              {/* S/R Location */}
              {nearRes && (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-500/8 ring-1 ring-red-500/10">
                  <span className="text-sm">⚠️</span>
                  <span className="text-xs font-bold text-red-400">NEAR RESISTANCE</span>
                  {resDist != null && <span className="text-[10px] text-red-400/50">{resDist.toFixed(1)}% away</span>}
                </div>
              )}
              {nearSup && !nearRes && (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-green-500/8 ring-1 ring-green-500/10">
                  <span className="text-sm">🟢</span>
                  <span className="text-xs font-bold text-green-400">NEAR SUPPORT</span>
                  {supDist != null && <span className="text-[10px] text-green-400/50">{supDist.toFixed(1)}% away</span>}
                </div>
              )}

              {/* Context / Warning */}
              {isWait ? (
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold text-yellow-400/80 flex items-center gap-1">
                    <span>🚫</span> No entry — wait for confirmation
                  </p>
                  {primaryPlan && (
                    <p className="text-[11px] text-muted-foreground/70 pl-4">✔ {primaryPlan}</p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground/70 leading-relaxed">
                  {signal.reasons[0]
                    ? signal.reasons[0].startsWith("STRONG") ? "Strong momentum building" : signal.reasons[0]
                    : "Setup developing"}
                </p>
              )}

              {/* Phase warning */}
              {signal.warningMessage && (signal.marketPhase === "OPENING" || signal.marketPhase === "STABILIZING") && (
                <p className={`text-[10px] font-medium flex items-center gap-1 ${
                  signal.marketPhase === "OPENING" ? "text-yellow-400/70" : "text-orange-400/70"
                }`}>
                  <span>⏳</span> {signal.warningMessage}
                </p>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between pt-2 border-t border-white/[0.04]">
                <div className="flex items-center gap-1.5">
                  <span className={`text-sm font-bold tabular-nums ${
                    score >= 8 ? "text-green-400" : score >= 6 ? "text-yellow-400" : "text-zinc-400"
                  }`}>{score}/10</span>
                  <span className={`text-[10px] font-medium ${
                    score >= 8 ? "text-green-400/70" : isWait ? "text-yellow-400/70" : "text-muted-foreground/50"
                  }`}>
                    {scoreDecision}
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground/30">5–10 min</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
