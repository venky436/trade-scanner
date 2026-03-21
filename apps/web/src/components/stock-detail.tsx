"use client";

import { useEffect, useState } from "react";
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

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4002";

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
  // Use server-computed score if available
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
  if (score >= 8) return "great";
  if (score >= 6) return "good";
  if (score >= 4) return "fair";
  return "weak";
}

function scoreBarColor(score: number): string {
  if (score >= 8) return "bg-green-500";
  if (score >= 5) return "bg-yellow-500";
  return "bg-zinc-500";
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
  const [days, setDays] = useState<number>(1);
  const [activePreset, setActivePreset] = useState<string>("1D");
  const [srLevels, setSrLevels] = useState<SupportResistanceResult | null>(
    srCache[symbol] ?? null
  );

  const stock = stockMap.get(symbol) ?? null;

  // Fetch SR levels
  useEffect(() => {
    if (srCache[symbol]) {
      setSrLevels(srCache[symbol]);
      return;
    }

    let active = true;
    async function fetchLevels() {
      try {
        const res = await fetch(`${API_URL}/api/stocks/levels`);
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
            {momentum && (
              <Badge
                className={`gap-1 ${momentumLabel(momentum.signal).color} bg-transparent border`}
              >
                {momentumLabel(momentum.signal).icon}
                {momentumLabel(momentum.signal).text}
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

      {/* ── Section 2: Decision Row ── */}
      <div className="grid md:grid-cols-5 gap-4">
        {/* Decision Card (3/5) */}
        <Card className={`md:col-span-3 border-border/50 border-l-4 ${signal ? signalBorderColor(signal.action) : "border-l-muted"}`}>
          <CardContent className="p-5 space-y-4">
            {signal && signal.action !== "WAIT" ? (
              <>
                {/* Signal Type + Score */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {signal.type ? (
                      <span className={`text-sm font-black uppercase px-2.5 py-1 rounded ${
                        signal.type === "BREAKOUT" ? "text-orange-500 bg-orange-500/10" :
                        signal.type === "BREAKDOWN" ? "text-red-500 bg-red-500/10" :
                        signal.type === "BOUNCE" ? "text-green-500 bg-green-500/10" :
                        "text-blue-500 bg-blue-500/10"
                      }`}>
                        {signalTypeLabel(signal.type)}
                      </span>
                    ) : (
                      <span className={`text-sm font-black uppercase px-2.5 py-1 rounded ${signalActionColor(signal.action)}`}>
                        {signal.action}
                      </span>
                    )}
                    {signal.stage && signal.stage !== "CONFIRMED" && (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
                        {signal.stage === "ACTIVITY" ? "Preliminary" : signal.stage === "MOMENTUM" ? "Momentum only" : "Partial"}
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

                {/* ACTION line */}
                <div className="space-y-2 text-sm">
                  {/* Entry */}
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground font-medium">ENTRY</span>
                    <span className={`font-mono font-semibold ${signal.action === "BUY" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                      {signal.type === "BOUNCE" && srLevels?.support != null
                        ? `Near support ₹${srLevels.support.toFixed(2)}`
                        : signal.type === "REJECTION" && srLevels?.resistance != null
                          ? `Near resistance ₹${srLevels.resistance.toFixed(2)}`
                          : signal.type === "BREAKOUT" && srLevels?.resistance != null
                            ? `Above ₹${srLevels.resistance.toFixed(2)}`
                            : signal.type === "BREAKDOWN" && srLevels?.support != null
                              ? `Below ₹${srLevels.support.toFixed(2)}`
                              : `₹${formatPrice(stock?.price ?? 0)}`}
                    </span>
                  </div>
                  {/* Stoploss */}
                  {srLevels && signal.type && (
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground font-medium">STOPLOSS</span>
                      <span className="font-mono text-orange-500">
                        {signal.type === "BOUNCE" && srLevels.support != null ? `₹${srLevels.support.toFixed(2)}` :
                         signal.type === "REJECTION" && srLevels.resistance != null ? `₹${srLevels.resistance.toFixed(2)}` :
                         signal.type === "BREAKOUT" && srLevels.resistance != null ? `₹${srLevels.resistance.toFixed(2)}` :
                         signal.type === "BREAKDOWN" && srLevels.support != null ? `₹${srLevels.support.toFixed(2)}` : "—"}
                      </span>
                    </div>
                  )}
                  {/* Risk */}
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground font-medium">RISK</span>
                    {(() => {
                      const dist = Math.min(
                        srLevels?.supportZone?.distancePercent ?? 100,
                        srLevels?.resistanceZone?.distancePercent ?? 100,
                      );
                      const risk = dist < 1 ? { label: "Low", color: "text-green-500" } :
                                   dist < 3 ? { label: "Medium", color: "text-yellow-500" } :
                                   { label: "High", color: "text-red-500" };
                      return <span className={`font-semibold ${risk.color}`}>{risk.label}</span>;
                    })()}
                  </div>
                </div>

                {/* Why This Trade */}
                {signal.reasons.length > 0 && (
                  <div className="border-t border-border/50 pt-3">
                    <p className="text-[11px] font-semibold uppercase text-muted-foreground mb-1.5">Why This Trade</p>
                    <ul className="space-y-1">
                      {signal.reasons.slice(0, 3).map((r, i) => (
                        <li key={i} className="text-sm text-muted-foreground flex items-start gap-1.5">
                          <span className="mt-0.5 text-foreground">•</span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* What to Wait For (when near S/R) */}
                {srLevels && (srLevels.summary.hasNearbyResistance || srLevels.summary.hasNearbySupport) && (
                  <div className="border-t border-border/50 pt-3">
                    <p className="text-[11px] font-semibold uppercase text-muted-foreground mb-1.5">What to Watch</p>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {srLevels.resistance != null && srLevels.summary.hasNearbyResistance && (
                        <li>• Break above ₹{srLevels.resistance.toFixed(2)} → Breakout</li>
                      )}
                      {srLevels.support != null && srLevels.summary.hasNearbySupport && (
                        <li>• Hold above ₹{srLevels.support.toFixed(2)} → Bounce confirmation</li>
                      )}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <div className="py-6 text-center">
                <p className="text-muted-foreground">No active signal — watching for setups</p>
                {srLevels && (
                  <div className="mt-3 text-xs text-muted-foreground">
                    {srLevels.resistance != null && <p>Watch resistance at ₹{srLevels.resistance.toFixed(2)}</p>}
                    {srLevels.support != null && <p>Watch support at ₹{srLevels.support.toFixed(2)}</p>}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Score Breakdown Card (2/5) */}
        <Card className="md:col-span-2 border-border/50">
          <CardContent className="p-5 space-y-4">
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
            </div>

            {/* Engine breakdown bars */}
            {signal?.scoreBreakdown ? (
              <div className="space-y-2.5">
                {[
                  { label: "Pressure", value: signal.scoreBreakdown.pressure, color: "bg-blue-500" },
                  { label: "Momentum", value: signal.scoreBreakdown.momentum, color: "bg-purple-500" },
                  { label: "S/R", value: signal.scoreBreakdown.sr, color: "bg-yellow-500" },
                  { label: "Pattern", value: signal.scoreBreakdown.pattern, color: "bg-green-500" },
                  { label: "Volatility", value: signal.scoreBreakdown.volatility, color: "bg-orange-500" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-mono font-semibold tabular-nums">{value}/10</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-muted">
                      <div className={`h-full rounded-full ${color}`} style={{ width: `${value * 10}%` }} />
                    </div>
                  </div>
                ))}
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
            {srLevels && (
              <div className="border-t border-border/50 pt-3 space-y-1.5 text-xs">
                {srLevels.supportZone && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">To Support</span>
                    <span className={srLevels.supportZone.distancePercent < 2 ? "text-green-500" : "text-muted-foreground"}>
                      {srLevels.supportZone.distancePercent.toFixed(2)}% {srLevels.supportZone.distancePercent < 1 ? "✅" : ""}
                    </span>
                  </div>
                )}
                {srLevels.resistanceZone && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">To Resistance</span>
                    <span className={srLevels.resistanceZone.distancePercent < 1 ? "text-red-500" : "text-muted-foreground"}>
                      {srLevels.resistanceZone.distancePercent.toFixed(2)}% {srLevels.resistanceZone.distancePercent < 1 ? "⚠️" : ""}
                    </span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Section 3: Chart ── */}
      <Card className="border-border/50">
        <CardContent className="p-4 space-y-3">
          {/* Chart header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Price Chart</h3>
              {isConnected && (
                <Badge variant="outline" className="gap-1.5 text-green-600 dark:text-green-400 border-green-500/50">
                  <span className="inline-block h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  LIVE
                </Badge>
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
              supportLevel={srLevels?.support}
              resistanceLevel={srLevels?.resistance}
              supportTouches={srLevels?.supportZone?.touches}
              resistanceTouches={srLevels?.resistanceZone?.touches}
              supportZoneMin={srLevels?.supportZone?.min}
              supportZoneMax={srLevels?.supportZone?.max}
              resistanceZoneMin={srLevels?.resistanceZone?.min}
              resistanceZoneMax={srLevels?.resistanceZone?.max}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Section 4: Details Row ── */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Key Levels Card */}
        <Card className="border-border/50">
          <CardContent className="p-5 space-y-4">
            <h3 className="text-sm font-semibold">Key Levels</h3>

            {srLevels ? (
              <>
                {/* Support */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" />
                      <span className="text-sm font-medium">Support</span>
                    </div>
                    <span className="text-sm font-mono font-semibold tabular-nums text-green-600 dark:text-green-400">
                      {srLevels.support !== null ? `₹${formatPrice(srLevels.support)}` : "—"}
                    </span>
                  </div>
                  {srLevels.supportZone && (
                    <p className="text-xs text-muted-foreground pl-[18px]">
                      ₹{srLevels.supportZone.min.toFixed(2)} – ₹{srLevels.supportZone.max.toFixed(2)} ({srLevels.supportZone.touches} touches)
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
                      {srLevels.resistance !== null ? `₹${formatPrice(srLevels.resistance)}` : "—"}
                    </span>
                  </div>
                  {srLevels.resistanceZone && (
                    <p className="text-xs text-muted-foreground pl-[18px]">
                      ₹{srLevels.resistanceZone.min.toFixed(2)} – ₹{srLevels.resistanceZone.max.toFixed(2)} ({srLevels.resistanceZone.touches} touches)
                    </p>
                  )}
                </div>

                {/* Divider + Distance stats */}
                <div className="border-t border-border/50 pt-3 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Distance to Support</span>
                    <span className="font-mono tabular-nums">
                      {srLevels.supportZone ? `${srLevels.supportZone.distancePercent.toFixed(2)}%` : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Distance to Resistance</span>
                    <span className="font-mono tabular-nums">
                      {srLevels.resistanceZone ? `${srLevels.resistanceZone.distancePercent.toFixed(2)}%` : "—"}
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
        <Card className="border-border/50">
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
