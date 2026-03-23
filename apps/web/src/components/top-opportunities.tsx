"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Target } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { StockData, SupportResistanceResult } from "@/lib/types";
import { INDEX_NAMES } from "@/lib/constants";

interface TopOpportunitiesProps {
  stockMap: Map<string, StockData>;
  srLevels: Record<string, SupportResistanceResult>;
  minScore?: number;
  maxScore?: number;
  maxItems?: number;
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

export function TopOpportunities({ stockMap, srLevels, minScore = 3, maxScore, maxItems = 6 }: TopOpportunitiesProps) {
  const router = useRouter();

  const opportunities = useMemo(() => {
    return Array.from(stockMap.values())
      .filter(
        (s) =>
          s.signal &&
          s.signal.action !== "WAIT" &&
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
      {opportunities.map((stock) => {
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

        // Score → decision text
        const scoreDecision = score >= 8 ? "Enter now"
          : isWait ? "Not safe to enter"
          : score >= 6 ? "Watch only"
          : "Skip";

        return (
          <Card
            key={stock.symbol}
            className="cursor-pointer overflow-hidden transition-all duration-300 rounded-2xl border border-border/20 backdrop-blur-xl bg-white/[0.02] dark:bg-white/[0.02]"
            onClick={() => router.push(`/stock/${encodeURIComponent(stock.symbol)}`)}
          >
            {/* Glass shine */}
            <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-transparent rounded-2xl pointer-events-none" />

            <div className="relative p-4 space-y-2.5">
              {/* Row 1: Signal label + Symbol + Score */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${signalLabel.color}`}>
                    {signalLabel.label}
                  </span>
                  <span className="text-sm font-bold text-foreground">{stock.symbol}</span>
                  {stock.pattern && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                      stock.pattern.direction === "BULLISH" ? "bg-green-500/15 text-green-500" : "bg-red-500/15 text-red-500"
                    }`}>
                      {stock.pattern.pattern.split("_").map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(" ")}
                    </span>
                  )}
                  <span className={`text-xs font-mono tabular-nums ${
                    positive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                  }`}>
                    {positive ? "+" : ""}{stock.change.toFixed(2)}%
                  </span>
                </div>
                <div className={`flex items-center justify-center w-8 h-8 rounded-full border-2 text-xs font-black ${scoreColor(score)}`}>
                  {score}
                </div>
              </div>

              {/* Row 2: DOMINANT location + distance */}
              {nearRes && (
                <p className="text-sm font-black text-red-500">
                  ⚠️ NEAR RESISTANCE
                  {resDist != null && <span className="text-[10px] font-normal text-muted-foreground ml-1">{resDist.toFixed(1)}% away</span>}
                </p>
              )}
              {nearSup && !nearRes && (
                <p className="text-sm font-black text-green-500">
                  🟢 NEAR SUPPORT
                  {supDist != null && <span className="text-[10px] font-normal text-muted-foreground ml-1">{supDist.toFixed(1)}% away</span>}
                </p>
              )}

              {/* Row 3: No-entry warning OR primary plan */}
              {isWait ? (
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold text-yellow-600 dark:text-yellow-400">
                    🚫 No entry — wait for confirmation
                  </p>
                  {primaryPlan && (
                    <p className="text-[11px] text-muted-foreground">
                      ✔ {primaryPlan}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground line-clamp-1">
                  {signal.reasons[0]
                    ? signal.reasons[0].startsWith("STRONG") ? "Strong momentum building" : signal.reasons[0]
                    : "Setup developing"}
                </p>
              )}

              {/* Row 3.5: Phase warning */}
              {signal.warningMessage && (signal.marketPhase === "OPENING" || signal.marketPhase === "STABILIZING") && (
                <p className={`text-[10px] font-medium ${
                  signal.marketPhase === "OPENING" ? "text-yellow-600 dark:text-yellow-400" : "text-orange-600 dark:text-orange-400"
                }`}>
                  ⏳ {signal.warningMessage}
                </p>
              )}

              {/* Row 4: Score decision + timing */}
              <div className="flex items-center justify-between text-[10px] border-t border-border/30 pt-2">
                <span className="text-muted-foreground">
                  <span className="font-bold text-foreground">{score}/10</span>
                  {" → "}
                  <span className={
                    score >= 8 ? "text-green-500 font-semibold" :
                    isWait ? "text-yellow-500 font-semibold" :
                    "text-muted-foreground"
                  }>
                    {scoreDecision}
                  </span>
                </span>
                <span className="text-muted-foreground/60">⏱ 5–10 min</span>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
