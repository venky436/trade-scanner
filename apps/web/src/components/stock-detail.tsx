"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CandlestickChart } from "./candlestick-chart";
import { useMarketData } from "@/hooks/use-market-data";
import type {
  StockData,
  SupportResistanceResult,
  MomentumSignal,
  PressureSignal,
  PressureTrend,
  SignalAction,
  SignalType,
} from "@/lib/types";
import { apiFetch } from "@/lib/api";

// Module-level cache for SR levels (survives remounts)
let srCache: Record<string, SupportResistanceResult> = {};

// ── Helpers ──────────────────────────────────────────────────────────

function formatPrice(price: number): string {
  return price.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatVolume(vol: number): string {
  if (vol >= 1_00_00_000) return (vol / 1_00_00_000).toFixed(2) + " Cr";
  if (vol >= 1_00_000) return (vol / 1_00_000).toFixed(2) + " L";
  if (vol >= 1_000) return (vol / 1_000).toFixed(1) + "K";
  return vol.toLocaleString("en-IN");
}

function computeScore(stock: StockData): number {
  // Use phase-adjusted finalScore if available, else raw score
  if (stock.signal?.finalScore) return stock.signal.finalScore;
  if (stock.signal?.score) return stock.signal.score;

  let score = 0;
  const signal = stock.signal;
  if (!signal || signal.action === "WAIT") return 0;

  score += signal.confidence === "HIGH" ? 4 : signal.confidence === "MEDIUM" ? 2.5 : 1;

  if (stock.pressure) score += stock.pressure.confidence * 2;

  if (stock.pattern) {
    const aligns =
      (signal.action === "BUY" && stock.pattern.direction === "BULLISH") ||
      (signal.action === "SELL" && stock.pattern.direction === "BEARISH");
    score += aligns ? 2 : 0.5;
  }

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
  if (score >= 8) return "TRADE ✅";
  if (score >= 6) return "WATCH ⚠️";
  return "AVOID ❌";
}

function scoreBarColor(score: number): string {
  if (score >= 8) return "bg-green-500";
  if (score >= 5) return "bg-yellow-500";
  return "bg-zinc-500";
}

function humanizeDetailReason(reason: string): string {
  if (reason.startsWith("STRONG_UP momentum")) return "Strong buying momentum — price accelerating upward 📈";
  if (reason.startsWith("STRONG_DOWN momentum")) return "Strong selling pressure — price declining fast 📉";
  if (reason.startsWith("UP momentum")) return "Upward momentum building 📈";
  if (reason.startsWith("DOWN momentum")) return "Downward momentum detected 📉";
  if (reason.includes("Approaching resistance — potential rejection")) return "Price very close to resistance — high chance of rejection ⚠️";
  if (reason.includes("Approaching support — potential bounce")) return "Price near support — possible bounce opportunity 🟢";
  if (reason.includes("Near resistance — waiting")) return "Too close to resistance to buy safely ⚠️";
  if (reason.includes("Near support — waiting")) return "Too close to support to sell safely 🟢";
  if (reason.startsWith("Active:")) return `Stock ${reason.replace("Active: ", "").replace(" move", "")} move today — active trading`;
  if (reason.includes("STRONG_BUY pressure")) return "Strong buying volume detected 📈";
  if (reason.includes("STRONG_SELL pressure")) return "Strong selling volume detected 📉";
  if (reason.includes("BUY pressure")) return "Buying pressure building";
  if (reason.includes("SELL pressure")) return "Selling pressure building";
  if (reason.includes("Near resistance")) return "Price near resistance level ⚠️";
  if (reason.includes("Near support")) return "Price near support level 🟢";
  return reason;
}

function momentumLabel(signal: MomentumSignal): { text: string; icon: React.ReactNode; color: string } {
  switch (signal) {
    case "STRONG_UP":
      return { text: "Strong Up", icon: <TrendingUp className="size-3" />, color: "text-green-600 dark:text-green-400" };
    case "UP":
      return { text: "Up", icon: <ArrowUpRight className="size-3" />, color: "text-green-600 dark:text-green-400" };
    case "FLAT":
      return { text: "Sideways", icon: <Minus className="size-3" />, color: "text-muted-foreground" };
    case "DOWN":
      return { text: "Down", icon: <ArrowDownRight className="size-3" />, color: "text-red-600 dark:text-red-400" };
    case "STRONG_DOWN":
      return { text: "Strong Down", icon: <TrendingDown className="size-3" />, color: "text-red-600 dark:text-red-400" };
  }
}

function pressureLabel(signal: PressureSignal): { text: string; color: string } {
  switch (signal) {
    case "STRONG_BUY":
      return { text: "Strong Buy", color: "text-green-600 dark:text-green-400 bg-green-500/10" };
    case "BUY":
      return { text: "Buy", color: "text-green-600 dark:text-green-400 bg-green-500/10" };
    case "NEUTRAL":
      return { text: "Neutral", color: "text-muted-foreground bg-muted" };
    case "SELL":
      return { text: "Sell", color: "text-red-600 dark:text-red-400 bg-red-500/10" };
    case "STRONG_SELL":
      return { text: "Strong Sell", color: "text-red-600 dark:text-red-400 bg-red-500/10" };
  }
}

function trendIcon(trend: PressureTrend): string {
  switch (trend) {
    case "rising": return "rising ↗";
    case "falling": return "falling ↘";
    case "mixed": return "mixed ↔";
  }
}

function formatPatternName(pattern: string): string {
  return pattern
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

function signalTypeLabel(type: SignalType): string {
  switch (type) {
    case "BOUNCE": return "Support Bounce";
    case "REJECTION": return "Resistance Rejection";
    case "BREAKOUT": return "Breakout";
    case "BREAKDOWN": return "Breakdown";
  }
}

function signalActionColor(action: SignalAction): string {
  switch (action) {
    case "BUY": return "bg-green-500/20 text-green-600 dark:text-green-400";
    case "SELL": return "bg-red-500/20 text-red-600 dark:text-red-400";
    case "WAIT": return "bg-muted text-muted-foreground";
  }
}

function signalBorderColor(action: SignalAction): string {
  switch (action) {
    case "BUY": return "border-l-green-500";
    case "SELL": return "border-l-red-500";
    case "WAIT": return "border-l-muted";
  }
}

function accelerationLabel(accel: string): { text: string; icon: string } {
  switch (accel) {
    case "INCREASING": return { text: "Accelerating", icon: "↗" };
    case "DECREASING": return { text: "Decelerating", icon: "↘" };
    default: return { text: "Stable", icon: "→" };
  }
}

// ── Period Presets ────────────────────────────────────────────────────

interface PeriodPreset {
  label: string;
  interval: string;
  days: number;
}

const PERIOD_PRESETS: PeriodPreset[] = [
  { label: "1D", interval: "5m", days: 1 },
  { label: "5D", interval: "5m", days: 5 },
  { label: "10D", interval: "5m", days: 10 },
  { label: "1M", interval: "15m", days: 30 },
  { label: "3M", interval: "1D", days: 90 },
  { label: "1Y", interval: "1D", days: 365 },
];

const INTERVAL_OPTIONS = ["5m", "15m", "30m", "1H"] as const;

// ── Component ────────────────────────────────────────────────────────

export function StockDetail({ symbol }: { symbol: string }) {
  const { stockMap, isConnected } = useMarketData();
  const [interval, setIntervalState] = useState("5m");
  const [days, setDays] = useState<number>(5);
  const [activePreset, setActivePreset] = useState<string>("5D");
  const [srLevels, setSrLevels] = useState<SupportResistanceResult | null>(
    srCache[symbol] ?? null
  );
  const [onDemandStock, setOnDemandStock] = useState<StockData | null>(null);
  const [dataSource, setDataSource] = useState<"live" | "on-demand" | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  const liveStock = stockMap.get(symbol) ?? null;

  // Fetch on-demand snapshot if stock not in live data
  useEffect(() => {
    if (liveStock) {
      setDataSource("live");
      return;
    }

    let active = true;
    setSnapshotLoading(true);

    async function fetchSnapshot() {
      try {
        const res = await apiFetch(`/api/stocks/${encodeURIComponent(symbol)}/snapshot`);
        if (!res.ok) return;
        const data = await res.json();
        if (active && data.symbol) {
          setOnDemandStock({
            symbol: data.symbol,
            price: data.price,
            open: data.open,
            high: data.high,
            low: data.low,
            close: data.close,
            volume: data.volume,
            change: data.change,
            timestamp: data.computedAt ?? Date.now(),
            signal: data.signal ?? undefined,
            momentum: data.momentum ?? undefined,
            pressure: data.pressure?.status === "UNAVAILABLE" ? undefined : data.pressure ?? undefined,
          });
          if (data.srLevels) {
            setSrLevels(data.srLevels);
            srCache[symbol] = data.srLevels;
          }
          setDataSource("on-demand");
        }
      } catch {
        // ignore
      } finally {
        if (active) setSnapshotLoading(false);
      }
    }

    fetchSnapshot();

    // Auto-refresh every 10s for on-demand stocks
    const refreshInterval = setInterval(fetchSnapshot, 10_000);

    return () => { active = false; clearInterval(refreshInterval); };
  }, [symbol, liveStock]);

  const stock = liveStock ?? onDemandStock;

  // Fetch SR levels
  useEffect(() => {
    if (srCache[symbol]) {
      setSrLevels(srCache[symbol]);
      return;
    }

    let active = true;
    async function fetchLevels() {
      try {
        const res = await apiFetch("/api/stocks/levels");
        if (!res.ok) return;
        const data = await res.json();
        if (active && data.levels) {
          srCache = data.levels;
          if (data.levels[symbol]) {
            setSrLevels(data.levels[symbol]);
          }
        }
      } catch {
        // ignore
      }
    }
    fetchLevels();
    return () => { active = false; };
  }, [symbol]);

  const change = stock?.change ?? 0;
  const absChange = stock ? stock.price - stock.open : 0;
  const isPositive = change > 0;
  const changeColor = isPositive
    ? "text-green-600 dark:text-green-400"
    : change < 0
      ? "text-red-600 dark:text-red-400"
      : "text-muted-foreground";
  const changeSign = isPositive ? "+" : "";

  const dayRangePercent =
    stock && stock.high > stock.low
      ? ((stock.price - stock.low) / (stock.high - stock.low)) * 100
      : 50;

  // Validate S/R orientation — swap if inverted relative to current price
  // Validate S/R orientation — swap if inverted relative to current price
  const srLevelsCorrected = useMemo((): SupportResistanceResult | null => {
    if (!srLevels || !stock) return srLevels;
    if (srLevels.support != null && srLevels.resistance != null) {
      if (srLevels.support > stock.price && srLevels.resistance < stock.price) {
        return {
          ...srLevels,
          support: srLevels.resistance,
          resistance: srLevels.support,
          supportZone: srLevels.resistanceZone,
          resistanceZone: srLevels.supportZone,
          summary: {
            hasNearbySupport: srLevels.summary.hasNearbyResistance,
            hasNearbyResistance: srLevels.summary.hasNearbySupport,
          },
        };
      }
    }
    return srLevels;
  }, [srLevels, stock]);

  // Use corrected S/R everywhere below
  const srData = srLevelsCorrected;

  const score = stock ? computeScore(stock) : 0;
  const signal = stock?.signal;
  const momentum = stock?.momentum;
  const pressure = stock?.pressure;
  const pattern = stock?.pattern;

  function handlePreset(preset: PeriodPreset) {
    setActivePreset(preset.label);
    setIntervalState(preset.interval);
    setDays(preset.days);
  }

  function handleInterval(iv: string) {
    setActivePreset("");
    setIntervalState(iv);
  }

  if (snapshotLoading && !stock) {
    return (
      <main className="p-4 max-w-[1400px] mx-auto">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
          <ArrowLeft className="size-4" />
          Back to Scanner
        </Link>
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <div className="size-8 border-2 border-green-500/30 border-t-green-500 rounded-full animate-spin mb-4" />
          <p className="text-sm font-medium">Loading stock analysis...</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Computing signals for {symbol}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="p-4 max-w-[1400px] mx-auto space-y-4">
      {/* ── Section 1: Header ── */}
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft className="size-4" />
          Back to Scanner
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold">{symbol}</h1>
            <Badge variant="outline">NSE</Badge>
            {dataSource === "on-demand" && (
              <Badge variant="outline" className="text-[10px] border-yellow-500/30 text-yellow-500">
                On-demand
              </Badge>
            )}
            {momentum && (
              <Badge
                className={`gap-1 ${
                  srData?.summary.hasNearbyResistance && (momentum.signal === "STRONG_UP" || momentum.signal === "UP")
                    ? "text-yellow-500 bg-transparent border"
                    : srData?.summary.hasNearbySupport && (momentum.signal === "STRONG_DOWN" || momentum.signal === "DOWN")
                      ? "text-yellow-500 bg-transparent border"
                      : `${momentumLabel(momentum.signal).color} bg-transparent border`
                }`}
              >
                {srData?.summary.hasNearbyResistance && (momentum.signal === "STRONG_UP" || momentum.signal === "UP")
                  ? "⚠️ At Resistance"
                  : srData?.summary.hasNearbySupport && (momentum.signal === "STRONG_DOWN" || momentum.signal === "DOWN")
                    ? "⚠️ At Support"
                    : <>{momentumLabel(momentum.signal).icon}{momentumLabel(momentum.signal).text}</>}
              </Badge>
            )}
          </div>

          {stock && (
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-mono font-bold tabular-nums">
                ₹{formatPrice(stock.price)}
              </span>
              <span className={`text-lg font-mono tabular-nums ${changeColor}`}>
                {isPositive ? <TrendingUp className="inline size-4 mb-0.5" /> : change < 0 ? <TrendingDown className="inline size-4 mb-0.5" /> : null}
                {" "}{changeSign}{absChange.toFixed(2)} ({changeSign}{change.toFixed(2)}%)
              </span>
            </div>
          )}
        </div>
      </div>

      {/* On-demand note */}
      {dataSource === "on-demand" && (
        <p className="text-[11px] text-muted-foreground/60 flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-yellow-500/50 animate-pulse" />
          Data refreshes every 10 seconds — not real-time
        </p>
      )}

      {/* ── Section 2: Decision + Score Row ── */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Trade Decision Box (left) */}
        {stock && (
          <TradeDecisionBox
            stock={stock}
            signal={signal ?? undefined}
            score={score}
            srLevels={srData}
            momentum={momentum ?? undefined}
          />
        )}

        {/* Signal Card — hidden (content merged into TradeDecisionBox) */}
        <Card className="hidden">
          <CardContent className="p-4 space-y-3">
            {signal && signal.action !== "WAIT" ? (
              <>
                {/* Signal Type (context-aware label) + Score */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {(() => {
                      // Context-aware label instead of raw BUY/SELL
                      const nearRes = srData?.summary.hasNearbyResistance;
                      const nearSup = srData?.summary.hasNearbySupport;
                      let label = signal.type ? signalTypeLabel(signal.type) : signal.action;
                      let color = signalActionColor(signal.action);

                      if (signal.type === "REJECTION" || (nearRes && signal.action === "SELL")) {
                        label = "Rejection Setup";
                        color = "text-blue-500 bg-blue-500/10";
                      } else if (signal.type === "BOUNCE" || (nearSup && signal.action === "BUY")) {
                        label = "Bounce Setup";
                        color = "text-green-500 bg-green-500/10";
                      } else if (signal.type === "BREAKOUT") {
                        label = "Breakout";
                        color = "text-orange-500 bg-orange-500/10";
                      } else if (signal.type === "BREAKDOWN") {
                        label = "Breakdown";
                        color = "text-red-500 bg-red-500/10";
                      }

                      return (
                        <span className={`text-sm font-black uppercase px-2.5 py-1 rounded ${color}`}>
                          {label}
                        </span>
                      );
                    })()}
                    {signal.stage && signal.stage !== "CONFIRMED" && (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
                        {signal.stage === "ACTIVITY" ? "Preliminary" : signal.stage === "MOMENTUM" ? "Developing" : "Partial"}
                      </span>
                    )}
                  </div>
                  <div className={`flex items-center justify-center w-12 h-12 rounded-full border-2 text-lg font-black ${
                    score >= 8 ? "border-green-500 text-green-500 bg-green-500/5" :
                    score >= 5 ? "border-yellow-500 text-yellow-500 bg-yellow-500/5" :
                    "border-zinc-500 text-zinc-400 bg-muted"
                  }`}>
                    {score}
                  </div>
                </div>

                {/* Score context note */}
                {score >= 6 && (srData?.summary.hasNearbyResistance || srData?.summary.hasNearbySupport) && (
                  <p className="text-[11px] text-yellow-600 dark:text-yellow-400">
                    ⚠️ Score is {score}/10 but location is risky (near {srData?.summary.hasNearbyResistance ? "resistance" : "support"})
                  </p>
                )}

                {/* Entry/SL/Risk — only for CONFIRMED/PRESSURE and NOT near dangerous S/R */}
                {signal.stage && (signal.stage === "CONFIRMED" || signal.stage === "PRESSURE") && !(
                  (srData?.summary.hasNearbyResistance && signal.action === "BUY") ||
                  (srData?.summary.hasNearbySupport && signal.action === "SELL")
                ) && (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground font-medium">ENTRY</span>
                      <span className={`font-mono font-semibold ${signal.action === "BUY" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                        {signal.type === "BOUNCE" && srData?.support != null
                          ? `Near support ₹${srData.support.toFixed(2)}`
                          : signal.type === "REJECTION" && srData?.resistance != null
                            ? `Near resistance ₹${srData.resistance.toFixed(2)}`
                            : signal.type === "BREAKOUT" && srData?.resistance != null
                              ? `Above ₹${srData.resistance.toFixed(2)}`
                              : signal.type === "BREAKDOWN" && srData?.support != null
                                ? `Below ₹${srData.support.toFixed(2)}`
                                : `₹${formatPrice(stock?.price ?? 0)}`}
                      </span>
                    </div>
                    {srData && signal.type && (
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground font-medium">STOPLOSS</span>
                        <span className="font-mono text-orange-500">
                          {signal.type === "BOUNCE" && srData.support != null ? `₹${srData.support.toFixed(2)}` :
                           signal.type === "REJECTION" && srData.resistance != null ? `₹${srData.resistance.toFixed(2)}` :
                           signal.type === "BREAKOUT" && srData.resistance != null ? `₹${srData.resistance.toFixed(2)}` :
                           signal.type === "BREAKDOWN" && srData.support != null ? `₹${srData.support.toFixed(2)}` : "—"}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground font-medium">RISK</span>
                      {(() => {
                        const dist = Math.min(
                          srData?.supportZone?.distancePercent ?? 100,
                          srData?.resistanceZone?.distancePercent ?? 100,
                        );
                        const risk = dist < 1 ? { label: "Low", color: "text-green-500" } :
                                     dist < 3 ? { label: "Medium", color: "text-yellow-500" } :
                                     { label: "High", color: "text-red-500" };
                        return <span className={`font-semibold ${risk.color}`}>{risk.label}</span>;
                      })()}
                    </div>
                  </div>
                )}

                {/* Why This Matters — max 3 clean bullet points */}
                {signal.reasons.length > 0 && (
                  <div className="border-t border-border/50 pt-3">
                    <p className="text-[11px] font-semibold uppercase text-muted-foreground mb-1.5">Why This Matters</p>
                    <ul className="space-y-1.5">
                      {signal.reasons.slice(0, 2).map((r, i) => (
                        <li key={i} className="text-sm text-muted-foreground">
                          {humanizeDetailReason(r)}
                        </li>
                      ))}
                      {/* Conclusion as final bullet */}
                      <li className="text-sm font-medium text-foreground">
                        {srData?.summary.hasNearbyResistance && signal.action === "SELL"
                          ? "👉 Wait for breakout or rejection"
                          : srData?.summary.hasNearbySupport && signal.action === "BUY"
                            ? "👉 Good entry if bounce confirmed"
                            : signal.stage === "ACTIVITY" || signal.stage === "MOMENTUM"
                              ? "👉 Wait for confirmation"
                              : score >= 8
                                ? "👉 Actionable setup"
                                : "👉 Monitor for confirmation"}
                      </li>
                    </ul>
                  </div>
                )}

                {/* What to Wait For (when near S/R) */}
                {srData && (srData.summary.hasNearbyResistance || srData.summary.hasNearbySupport) && (
                  <div className="border-t border-border/50 pt-3">
                    <p className="text-[11px] font-semibold uppercase text-muted-foreground mb-1.5">What to Watch</p>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {srData.resistance != null && srData.summary.hasNearbyResistance && (
                        <li>• Break above ₹{srData.resistance.toFixed(2)} → Breakout</li>
                      )}
                      {srData.support != null && srData.summary.hasNearbySupport && (
                        <li>• Hold above ₹{srData.support.toFixed(2)} → Bounce confirmation</li>
                      )}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <div className="py-6 text-center">
                <p className="text-muted-foreground">No active signal — watching for setups</p>
                {srData && (
                  <div className="mt-3 text-xs text-muted-foreground">
                    {srData.resistance != null && <p>Watch resistance at ₹{srData.resistance.toFixed(2)}</p>}
                    {srData.support != null && <p>Watch support at ₹{srData.support.toFixed(2)}</p>}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Score Breakdown Card */}
        <Card className="border border-border/20 rounded-2xl backdrop-blur-xl bg-white/[0.02]">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Score Breakdown</h3>
              {score >= 8 && (
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-green-500/10 text-green-600 dark:text-green-400">
                  High Probability
                </span>
              )}
            </div>

            {/* Score display */}
            <div className="space-y-2">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold tabular-nums">{score}/10</span>
                <span className="text-sm text-muted-foreground">{scoreLabel(score)}</span>
              </div>
              <div className="w-full h-2 rounded-full bg-muted">
                <div className={`h-full rounded-full transition-all ${scoreBarColor(score)}`} style={{ width: `${score * 10}%` }} />
              </div>
              <div className="flex gap-3 text-[10px] text-muted-foreground/60">
                <span>8-10 TRADE</span>
                <span>6-7 WATCH</span>
                <span>&lt;6 AVOID</span>
              </div>
            </div>

            {/* Engine breakdown bars */}
            {signal?.scoreBreakdown ? (
              <div className="space-y-2.5">
                {[
                  { label: "Pressure", value: signal.scoreBreakdown.pressure, color: "bg-blue-500" },
                  { label: "Momentum", value: signal.scoreBreakdown.momentum, color: "bg-purple-500" },
                  { label: "S/R", value: signal.scoreBreakdown.sr, color: "bg-yellow-500" },
                  { label: "Volatility", value: signal.scoreBreakdown.volatility, color: "bg-orange-500" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-mono font-semibold tabular-nums">
                        {value}/10
                        <span className="ml-1 font-normal">
                          {value >= 8 ? "✅" : value < 5 ? "⚠️" : ""}
                        </span>
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-muted">
                      <div className={`h-full rounded-full ${color}`} style={{ width: `${value * 10}%` }} />
                    </div>
                  </div>
                ))}
                {/* Pattern badge (not part of score — visual bonus) */}
                {pattern && (
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-xs text-muted-foreground">Pattern:</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                      pattern.direction === "BULLISH" ? "bg-green-500/15 text-green-500" : "bg-red-500/15 text-red-500"
                    }`}>
                      {formatPatternName(pattern.pattern)} ({pattern.direction === "BULLISH" ? "Bullish" : "Bearish"})
                    </span>
                  </div>
                )}
                {/* Weakness summary */}
                {(() => {
                  const weak = [
                    { label: "Pressure", value: signal.scoreBreakdown!.pressure },
                    { label: "Momentum", value: signal.scoreBreakdown!.momentum },
                    { label: "S/R", value: signal.scoreBreakdown!.sr },
                  ].filter(e => e.value < 5);
                  if (weak.length === 0) return null;
                  return (
                    <p className="text-[11px] text-yellow-600 dark:text-yellow-400 mt-2">
                      👉 Weak {weak.map(w => w.label).join(" + ")} reduces confidence
                    </p>
                  );
                })()}
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Momentum</span>
                  <span className={momentum ? momentumLabel(momentum.signal).color : ""}>
                    {momentum ? momentumLabel(momentum.signal).text : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pressure</span>
                  <span>{pressure ? `${pressureLabel(pressure.signal).text} (${trendIcon(pressure.trend)})` : "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pattern</span>
                  <span>{pattern ? formatPatternName(pattern.pattern) : "—"}</span>
                </div>
              </div>
            )}

            {/* Risk visualization */}
            {srData && (
              <div className="border-t border-border/50 pt-3 space-y-1.5 text-xs">
                {srData.supportZone && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">→ Support</span>
                    <span className={srData.supportZone.distancePercent < 1 ? "text-yellow-500" : srData.supportZone.distancePercent > 3 ? "text-green-500" : "text-muted-foreground"}>
                      {srData.supportZone.distancePercent.toFixed(2)}%
                      {srData.supportZone.distancePercent < 1 ? " danger zone ⚠️" : srData.supportZone.distancePercent > 3 ? " safe ✅" : " moderate"}
                    </span>
                  </div>
                )}
                {srData.resistanceZone && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">→ Resistance</span>
                    <span className={srData.resistanceZone.distancePercent < 1 ? "text-red-500" : srData.resistanceZone.distancePercent > 3 ? "text-green-500" : "text-muted-foreground"}>
                      {srData.resistanceZone.distancePercent.toFixed(2)}%
                      {srData.resistanceZone.distancePercent < 1 ? " danger zone ⚠️" : srData.resistanceZone.distancePercent > 3 ? " safe ✅" : " moderate"}
                    </span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Section 3: Chart ── */}
      <Card className="border border-border/20 rounded-2xl backdrop-blur-xl bg-white/[0.02]">
        <CardContent className="p-4 space-y-3">
          {/* Chart header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold">Price Chart</h3>
              {isConnected && (
                <Badge variant="outline" className="gap-1.5 text-green-600 dark:text-green-400 border-green-500/50">
                  <span className="inline-block h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  LIVE
                </Badge>
              )}
              {srData?.summary.hasNearbyResistance && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-red-500/10 text-red-500">
                  Near Resistance ⚠️
                </span>
              )}
              {srData?.summary.hasNearbySupport && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-green-500/10 text-green-500">
                  Near Support 🟢
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Period presets */}
              <div className="flex gap-1">
                {PERIOD_PRESETS.map((p) => (
                  <Button
                    key={p.label}
                    variant={activePreset === p.label ? "default" : "outline"}
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => handlePreset(p)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>

              <span className="text-muted-foreground text-xs hidden sm:block">|</span>

              {/* Interval overrides */}
              <div className="flex gap-1">
                {INTERVAL_OPTIONS.map((iv) => (
                  <Button
                    key={iv}
                    variant={!activePreset && interval === iv ? "default" : "outline"}
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => handleInterval(iv)}
                  >
                    {iv}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="h-[400px] md:h-[500px]">
            <CandlestickChart
              symbol={symbol}
              interval={interval}
              tick={stock}
              days={days}
              supportLevel={srData?.support}
              resistanceLevel={srData?.resistance}
              supportTouches={srData?.supportZone?.touches}
              resistanceTouches={srData?.resistanceZone?.touches}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Section 4: Details Row ── */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Key Levels Card */}
        <Card className="border border-border/20 rounded-2xl backdrop-blur-xl bg-white/[0.02]">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Key Levels</h3>
              {signal?.srType && (
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                  signal.srType === "INTRADAY"
                    ? "bg-blue-500/15 text-blue-500"
                    : "bg-zinc-500/15 text-zinc-400"
                }`}>
                  {signal.srType === "INTRADAY" ? "INTRADAY" : "DAILY"}
                </span>
              )}
            </div>

            {srData ? (
              <>
                {/* Support */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" />
                      <span className="text-sm font-medium">Support</span>
                    </div>
                    <span className="text-sm font-mono font-semibold tabular-nums text-green-600 dark:text-green-400">
                      {srData.support !== null ? `₹${formatPrice(srData.support)}` : "—"}
                    </span>
                  </div>
                  {srData.supportZone && (
                    <p className="text-xs text-muted-foreground pl-[18px]">
                      ₹{srData.supportZone.min.toFixed(2)} – ₹{srData.supportZone.max.toFixed(2)} ({srData.supportZone.touches} touches)
                    </p>
                  )}
                </div>

                {/* Resistance */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
                      <span className="text-sm font-medium">Resistance</span>
                    </div>
                    <span className="text-sm font-mono font-semibold tabular-nums text-red-600 dark:text-red-400">
                      {srData.resistance !== null ? `₹${formatPrice(srData.resistance)}` : "—"}
                    </span>
                  </div>
                  {srData.resistanceZone && (
                    <p className="text-xs text-muted-foreground pl-[18px]">
                      ₹{srData.resistanceZone.min.toFixed(2)} – ₹{srData.resistanceZone.max.toFixed(2)} ({srData.resistanceZone.touches} touches)
                    </p>
                  )}
                </div>

                {/* Divider + Distance stats */}
                <div className="border-t border-border/50 pt-3 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Distance to Support</span>
                    <span className="font-mono tabular-nums">
                      {srData.supportZone ? `${srData.supportZone.distancePercent.toFixed(2)}%` : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Distance to Resistance</span>
                    <span className="font-mono tabular-nums">
                      {srData.resistanceZone ? `${srData.resistanceZone.distancePercent.toFixed(2)}%` : "—"}
                    </span>
                  </div>
                </div>

                {/* Day Range bar */}
                {stock && (
                  <div className="border-t border-border/50 pt-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                      <span>Day Range</span>
                      <span>₹{formatPrice(stock.low)} — ₹{formatPrice(stock.high)}</span>
                    </div>
                    <div className="relative h-2 rounded-full bg-muted">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-red-500 to-green-500"
                        style={{ width: `${Math.min(Math.max(dayRangePercent, 0), 100)}%` }}
                      />
                      <div
                        className="absolute top-1/2 w-3 h-3 rounded-full bg-foreground border-2 border-background"
                        style={{
                          left: `${Math.min(Math.max(dayRangePercent, 0), 100)}%`,
                          transform: "translate(-50%, -50%)",
                        }}
                      />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-2 w-full" />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Volume & Market Data Card */}
        <Card className="border border-border/20 rounded-2xl backdrop-blur-xl bg-white/[0.02]">
          <CardContent className="p-5 space-y-4">
            <h3 className="text-sm font-semibold">Volume & Market Data</h3>

            {stock ? (
              <>
                {/* OHLCV grid */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <KVRow label="Open" value={`₹${formatPrice(stock.open)}`} />
                  <KVRow label="High" value={`₹${formatPrice(stock.high)}`} />
                  <KVRow label="Low" value={`₹${formatPrice(stock.low)}`} />
                  <KVRow label="Close" value={`₹${formatPrice(stock.close)}`} />
                  <KVRow label="Volume" value={formatVolume(stock.volume)} />
                  <KVRow
                    label="Change"
                    value={`${changeSign}${change.toFixed(2)}%`}
                    valueColor={changeColor}
                  />
                </div>

                {/* Volume Analysis */}
                {pressure && (
                  <div className="border-t border-border/50 pt-3 space-y-3">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Volume Analysis</p>

                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Pressure</span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${pressureLabel(pressure.signal).color}`}>
                          {pressureLabel(pressure.signal).text}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Trend</span>
                        <span>{trendIcon(pressure.trend)}</span>
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Confidence</span>
                          <span className="font-mono tabular-nums">{Math.round(pressure.confidence * 100)}%</span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-blue-500 transition-all"
                            style={{ width: `${pressure.confidence * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-3/4" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

// ── Sub-components (inline) ──────────────────────────────────────────

function EntryZoneBox({
  signal,
  srLevels,
}: {
  signal: NonNullable<StockData["signal"]>;
  srLevels: SupportResistanceResult | null;
}) {
  const isBuy = signal.action === "BUY";
  const zone = isBuy ? srLevels?.supportZone : srLevels?.resistanceZone;
  const color = isBuy ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400";
  const borderColor = isBuy ? "border-green-500/30" : "border-red-500/30";

  return (
    <div className={`rounded-lg border ${borderColor} p-3 space-y-1`}>
      <p className="text-[10px] font-semibold uppercase text-muted-foreground">
        {isBuy ? "Entry Zone" : "Decision Zone"}
      </p>
      <p className={`text-sm font-mono font-semibold tabular-nums ${color}`}>
        {zone ? `₹${zone.min.toFixed(2)} – ₹${zone.max.toFixed(2)}` : "—"}
      </p>
    </div>
  );
}

function InvalidationBox({
  signal,
  srLevels,
}: {
  signal: NonNullable<StockData["signal"]>;
  srLevels: SupportResistanceResult | null;
}) {
  let invalidation: string | null = null;
  if (srLevels && signal.type) {
    switch (signal.type) {
      case "BOUNCE":
        if (srLevels.support !== null) invalidation = `Below ₹${srLevels.support.toFixed(2)}`;
        break;
      case "REJECTION":
        if (srLevels.resistance !== null) invalidation = `Above ₹${srLevels.resistance.toFixed(2)}`;
        break;
      case "BREAKOUT":
        if (srLevels.resistance !== null) invalidation = `Below ₹${srLevels.resistance.toFixed(2)}`;
        break;
      case "BREAKDOWN":
        if (srLevels.support !== null) invalidation = `Above ₹${srLevels.support.toFixed(2)}`;
        break;
    }
  }

  return (
    <div className="rounded-lg border border-orange-500/30 p-3 space-y-1">
      <p className="text-[10px] font-semibold uppercase text-muted-foreground">Invalidation</p>
      <p className="text-sm font-mono font-semibold tabular-nums text-orange-600 dark:text-orange-400">
        {invalidation ?? "—"}
      </p>
    </div>
  );
}

function TagRow({
  label,
  tags,
  dotColor,
}: {
  label: string;
  tags: string[];
  dotColor: string;
}) {
  if (tags.length === 0) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[10px] font-semibold uppercase text-muted-foreground w-20 shrink-0">
        {label}
      </span>
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-foreground"
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor}`} />
          {tag}
        </span>
      ))}
    </div>
  );
}

function KVRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono tabular-nums ${valueColor ?? ""}`}>{value}</span>
    </div>
  );
}

// ── Trade Decision Box ──

function TradeDecisionBox({
  stock,
  signal,
  score,
  srLevels,
  momentum,
}: {
  stock: StockData;
  signal?: StockData["signal"];
  score: number;
  srLevels: SupportResistanceResult | null;
  momentum?: StockData["momentum"];
}) {
  const nearResistance = srLevels?.summary.hasNearbyResistance;
  const nearSupport = srLevels?.summary.hasNearbySupport;
  const momUp = momentum?.signal === "STRONG_UP" || momentum?.signal === "UP";
  const momDown = momentum?.signal === "STRONG_DOWN" || momentum?.signal === "DOWN";
  const resistance = srLevels?.resistance;
  const support = srLevels?.support;
  const price = stock.price;

  // Market phase
  const marketPhase = signal?.marketPhase;
  const phaseWarning = signal?.warningMessage;
  const effectiveScore = signal?.finalScore ?? score;

  // Decision logic
  let decision: "TRADE" | "WATCH" | "AVOID" | "WAIT";
  let decisionColor: string;
  let decisionIcon: string;
  let reason: string;
  let contextLine: string | null = null;

  // Market phase overrides (highest priority)
  if (marketPhase === "OPENING") {
    decision = "WAIT";
    decisionColor = "text-yellow-500 border-yellow-500/30 bg-yellow-500/5";
    decisionIcon = "⏳";
    reason = "Market just opened — signals restricted";
    contextLine = phaseWarning ?? "Wait for market to stabilize";
  } else if (marketPhase === "STABILIZING") {
    decision = "WAIT";
    decisionColor = "text-orange-500 border-orange-500/30 bg-orange-500/5";
    decisionIcon = "⏳";
    reason = "Market stabilizing — only confirmed signals";
    contextLine = phaseWarning ?? "Wait for confirmed patterns";
  }
  // S/R context overrides
  else if (nearResistance && momUp && signal?.action !== "WAIT") {
    decision = "WAIT";
    decisionColor = "text-yellow-500 border-yellow-500/30 bg-yellow-500/5";
    decisionIcon = "⚠️";
    const dist = srLevels?.resistanceZone?.distancePercent;
    reason = "Avoid entering now — high probability decision zone";
    contextLine = `Price is just ${dist ? dist.toFixed(1) + "% " : ""}below resistance ⚠️`;
  } else if (nearSupport && momDown && signal?.action !== "WAIT") {
    decision = "WAIT";
    decisionColor = "text-yellow-500 border-yellow-500/30 bg-yellow-500/5";
    decisionIcon = "⚠️";
    const dist = srLevels?.supportZone?.distancePercent;
    reason = "Avoid entering now — watch for bounce or breakdown";
    contextLine = `Price is just ${dist ? dist.toFixed(1) + "% " : ""}above support ⚠️`;
  } else if (score >= 8 && signal?.type) {
    decision = "TRADE";
    decisionColor = "text-green-500 border-green-500/30 bg-green-500/5";
    decisionIcon = "✅";
    reason = "Strong setup — act now";
  } else if (score >= 6) {
    decision = "WATCH";
    decisionColor = "text-yellow-500 border-yellow-500/30 bg-yellow-500/5";
    decisionIcon = "⚠️";
    reason = "Setup developing — waiting for confirmation";
  } else {
    decision = "AVOID";
    decisionColor = "text-zinc-400 border-border/50 bg-muted/50";
    decisionIcon = "❌";
    reason = "Low confidence — no clear setup";
  }

  // Smart plan levels
  const breakoutLevel = resistance != null ? `₹${resistance.toFixed(2)}` : null;
  // Rejection level: slightly below resistance (0.8% buffer) instead of far support
  const rejectionLevel = resistance != null
    ? `₹${(resistance * 0.992).toFixed(2)}`
    : support != null
      ? `₹${support.toFixed(2)}`
      : null;
  // Bounce level: slightly above support
  const bounceLevel = support != null ? `₹${support.toFixed(2)}` : null;
  // Breakdown level: slightly below support
  const breakdownLevel = support != null
    ? `₹${(support * 0.992).toFixed(2)}`
    : null;

  // Market context
  const marketContext = momentum?.signal === "STRONG_UP" ? "Strong Bullish"
    : momentum?.signal === "UP" ? "Slight Bullish"
    : momentum?.signal === "FLAT" ? "Sideways"
    : momentum?.signal === "DOWN" ? "Slight Bearish"
    : momentum?.signal === "STRONG_DOWN" ? "Strong Bearish"
    : "—";

  // Momentum vs S/R interpretation
  let interpretation: string | null = null;
  if (nearResistance && momUp) {
    interpretation = "Momentum is strong 📈 but resistance is very close ⚠️ — breakout OR rejection likely";
  } else if (nearSupport && momDown) {
    interpretation = "Momentum is bearish 📉 but support is close 🟢 — bounce OR breakdown likely";
  }

  // Zone ranges
  const resistanceZone = srLevels?.resistanceZone
    ? `₹${srLevels.resistanceZone.min.toFixed(0)} – ₹${srLevels.resistanceZone.max.toFixed(0)}`
    : null;
  const supportZone = srLevels?.supportZone
    ? `₹${srLevels.supportZone.min.toFixed(0)} – ₹${srLevels.supportZone.max.toFixed(0)}`
    : null;

  // Score interpretation
  const scoreLabel = score >= 8 ? "High confidence"
    : score >= 6 ? "Moderate confidence"
    : "Low confidence";

  // Market state tag (combines momentum + structure)
  const marketState = nearResistance && momUp ? "Bullish but at resistance"
      : nearResistance && momDown ? "Bearish at resistance"
      : nearSupport && momUp ? "Bullish near support"
      : nearSupport && momDown ? "Bearish but at support"
      : momUp ? "Bullish trend"
      : momDown ? "Bearish trend"
      : "Sideways";

    // One-line summary
  const summary = nearResistance
    ? "Price is near resistance — wait for rejection or breakout"
    : nearSupport
      ? "Price is near support — wait for bounce or breakdown"
      : decision === "TRADE"
        ? "Conditions aligned — trade setup ready"
        : "Setup developing — monitor for entry";

  return (
    <Card className={`border ${decisionColor} rounded-2xl backdrop-blur-xl bg-white/[0.02]`}>
      <CardContent className="p-4 space-y-2">
        {/* 1. Header + Badge */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wide">
            {decisionIcon} {decision === "WAIT" ? "WAIT" : decision === "TRADE" ? "TRADE NOW" : decision}
          </h3>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
            decision === "TRADE" ? "bg-green-500/15 text-green-500" :
            decision === "WATCH" || decision === "WAIT" ? "bg-yellow-500/15 text-yellow-500" :
            "bg-muted text-muted-foreground"
          }`}>
            {marketState}
          </span>
        </div>

        {/* 2. One-line summary (SIGNATURE UX) */}
        <p className="text-xs text-muted-foreground">{summary}</p>

        {/* 2.5. Market Phase Warning Banner */}
        {phaseWarning && (marketPhase === "OPENING" || marketPhase === "STABILIZING") && (
          <div className={`text-xs font-medium px-3 py-1.5 rounded-lg ${
            marketPhase === "OPENING"
              ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20"
              : "bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20"
          }`}>
            {marketPhase === "OPENING" ? "⏳" : "⏳"} {phaseWarning}
          </div>
        )}

        {/* 3. Location (DOMINANT) — only the strongest signal */}
        {nearResistance && (
          <p className="text-base font-black text-red-500">
            ⚠️ NEAR RESISTANCE
            {srLevels?.resistanceZone && (
              <span className="text-xs font-normal text-muted-foreground ml-2">{srLevels.resistanceZone.distancePercent.toFixed(1)}% away</span>
            )}
          </p>
        )}
        {nearSupport && !nearResistance && (
          <p className="text-base font-black text-green-500">
            🟢 NEAR SUPPORT
            {srLevels?.supportZone && (
              <span className="text-xs font-normal text-muted-foreground ml-2">{srLevels.supportZone.distancePercent.toFixed(1)}% away</span>
            )}
          </p>
        )}

        {/* 4. No-entry (only for WAIT — single clean line) */}
        {(decision === "WAIT" || decision === "AVOID") && (
          <p className="text-xs font-semibold text-yellow-600 dark:text-yellow-400">🚫 No safe entry at current price</p>
        )}

        {/* 5. Plan — PRIMARY + ALTERNATIVE (improved wording) */}
        {(breakoutLevel || rejectionLevel || bounceLevel || breakdownLevel) && (
          <div className="space-y-1 text-sm border-t border-border/30 pt-2">
            {nearResistance && (
              <>
                <p className="text-[10px] font-bold uppercase text-muted-foreground">Primary</p>
                <p className="text-foreground font-medium">✔ SELL below <span className="font-mono text-red-600 dark:text-red-400">{rejectionLevel}</span> → rejection breakdown</p>
                <p className="text-[10px] font-bold uppercase text-muted-foreground mt-1">Alternative</p>
                <p className="text-muted-foreground">✔ BUY above <span className="font-mono">{breakoutLevel}</span> → breakout move</p>
              </>
            )}
            {nearSupport && !nearResistance && (
              <>
                <p className="text-[10px] font-bold uppercase text-muted-foreground">Primary</p>
                <p className="text-foreground font-medium">✔ BUY near <span className="font-mono text-green-600 dark:text-green-400">{bounceLevel}</span> → bounce reversal</p>
                <p className="text-[10px] font-bold uppercase text-muted-foreground mt-1">Alternative</p>
                <p className="text-muted-foreground">✔ SELL below <span className="font-mono">{breakdownLevel}</span> → support breakdown</p>
              </>
            )}
            {!nearResistance && !nearSupport && (
              <>
                {breakoutLevel && <p className="text-foreground">✔ BUY above <span className="font-mono text-green-600 dark:text-green-400">{breakoutLevel}</span></p>}
                {bounceLevel && <p className="text-foreground">✔ SELL below <span className="font-mono text-red-600 dark:text-red-400">{bounceLevel}</span></p>}
              </>
            )}
          </div>
        )}

        {/* 6. Why This Matters (from signal reasons) */}
        {signal && signal.reasons.length > 0 && (
          <div className="border-t border-border/30 pt-2">
            <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Why This Matters</p>
            {signal.reasons.slice(0, 2).map((r, i) => (
              <p key={i} className="text-xs text-muted-foreground">{humanizeDetailReason(r)}</p>
            ))}
          </div>
        )}

        {/* 6. What to Watch */}
        {srLevels && (srLevels.summary.hasNearbyResistance || srLevels.summary.hasNearbySupport) && (
          <div className="text-xs text-muted-foreground">
            {srLevels.resistance != null && srLevels.summary.hasNearbyResistance && (
              <p>• Break above ₹{srLevels.resistance.toFixed(2)} → Breakout</p>
            )}
            {srLevels.support != null && srLevels.summary.hasNearbySupport && (
              <p>• Hold above ₹{srLevels.support.toFixed(2)} → Bounce</p>
            )}
          </div>
        )}

        {/* 7. Zones */}
        {(resistanceZone || supportZone) && (
          <div className="flex gap-4 text-xs border-t border-border/30 pt-2">
            {resistanceZone && (
              <span className="text-muted-foreground">📍 Resistance: <span className="text-red-500 font-mono">{resistanceZone}</span></span>
            )}
            {supportZone && (
              <span className="text-muted-foreground">📍 Support: <span className="text-green-500 font-mono">{supportZone}</span></span>
            )}
          </div>
        )}

        {/* 6. Footer — Score with decision link + timing */}
        <div className="space-y-1.5 border-t border-border/30 pt-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              <span className="font-bold text-foreground">{score}/10</span>
              {" → "}
              <span className={
                decision === "TRADE" ? "text-green-500 font-semibold" :
                decision === "WAIT" || decision === "WATCH" ? "text-yellow-500 font-semibold" :
                "text-zinc-400"
              }>
                {decision === "TRADE" ? "Enter now"
                  : decision === "WAIT" ? "Watch only (no entry)"
                  : decision === "WATCH" ? "Watch only (no entry)"
                  : "Skip (low confidence)"}
              </span>
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground/60">
            ⏱ Re-evaluate in 5–10 min
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
