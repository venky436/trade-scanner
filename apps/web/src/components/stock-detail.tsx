"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BarChart3,
  Crosshair,
  Eye,
  Gauge,
  Layers,
  Lightbulb,
  Maximize2,
  Minus,
  Pause,
  Target,
  TrendingUp,
  Waves,
  X,
  Zap,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { CandlestickChart, type ChartTick } from "./candlestick-chart";
import { useMarketData } from "@/hooks/use-market-data";
import { useAuth } from "@/context/auth-context";
import { apiFetch } from "@/lib/api";
import { AddToWatchZoneButton } from "./watch-zone";
import { AiAnalysisCard } from "./ai-analysis-card";
import { useAiCall } from "@/hooks/use-ai-calls";
import { useServerConfig } from "@/context/config-context";
import type { IntelligenceSnapshot, Outlook, StockDetailSnapshot, Zone } from "@/lib/types";

// Map the outlook (already derived from all factors — zone, momentum,
// pressure, confidence, volume + Donchian gates) into a simple action + setup
// name. Mirrors the same mapping used by MarketCard.
type DetailAction = "BUY" | "SELL" | "WAIT";
const OUTLOOK_TO_ACTION: Record<Outlook, { action: DetailAction; setup: string }> = {
  BOUNCE_EXPECTED: { action: "BUY", setup: "Bounce" },
  BREAKOUT_LIKELY: { action: "BUY", setup: "Breakout" },
  REJECTION_POSSIBLE: { action: "SELL", setup: "Rejection" },
  BREAKDOWN_RISK: { action: "SELL", setup: "Breakdown" },
  NO_CLEAR_EDGE: { action: "WAIT", setup: "No setup" },
};
import {
  formatTimeAgo,
  marketConditions,
  marketInterpretation,
  marketObservation,
  momentumDirection,
  momentumDisplay,
  momentumHeadline,
  pressureDirection,
  pressureDisplay,
  pressureHeadline,
  strengthDescriptor,
  volatilityDisplay,
  volatilityHeadline,
  zoneDisplay,
} from "@/lib/sebi-display";

interface StockDetailProps {
  symbol: string;
}

const ZONE_GRADIENT: Record<Zone, string> = {
  NEAR_RESISTANCE: "from-rose-500/10 via-rose-500/5 to-transparent dark:from-rose-500/15",
  NEAR_SUPPORT: "from-emerald-500/10 via-emerald-500/5 to-transparent dark:from-emerald-500/15",
  MID_RANGE: "from-zinc-200/40 via-zinc-100/20 to-transparent dark:from-zinc-700/20 dark:via-zinc-800/10",
};

const ZONE_BORDER: Record<Zone, string> = {
  NEAR_RESISTANCE: "border-rose-500/30",
  NEAR_SUPPORT: "border-emerald-500/30",
  MID_RANGE: "border-zinc-200 dark:border-zinc-700/60",
};

const ZONE_ICON_BG: Record<Zone, string> = {
  NEAR_RESISTANCE: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  NEAR_SUPPORT: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  MID_RANGE: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400",
};

function directionColor(dir: "up" | "down" | "flat"): string {
  if (dir === "up") return "text-emerald-500 dark:text-emerald-400";
  if (dir === "down") return "text-rose-500 dark:text-rose-400";
  return "text-zinc-400 dark:text-zinc-500";
}

function directionFill(dir: "up" | "down" | "flat"): string {
  if (dir === "up") return "bg-emerald-500 dark:bg-emerald-400";
  if (dir === "down") return "bg-rose-500 dark:bg-rose-400";
  return "bg-zinc-400 dark:bg-zinc-500";
}

function StrengthBar({ score, dir, cells = 8 }: { score: number; dir: "up" | "down" | "flat"; cells?: number }) {
  const filled = Math.max(1, Math.min(cells, Math.round(Math.max(0, Math.min(1, score)) * cells)));
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: cells }).map((_, i) => (
        <span
          key={i}
          className={`h-2 w-3 rounded-sm transition-colors duration-500 ${i < filled ? directionFill(dir) : "bg-zinc-200 dark:bg-zinc-800"}`}
        />
      ))}
    </div>
  );
}

// Same price-flash hook used on home cards — emerald/rose pulse when WS tick
// changes price. Read by the hero header so the detail page also feels live.
function usePriceFlash(price: number): "up" | "down" | null {
  const prev = useRef<number>(price);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (price === prev.current) return;
    setFlash(price > prev.current ? "up" : "down");
    prev.current = price;
    const id = window.setTimeout(() => setFlash(null), 1200);
    return () => window.clearTimeout(id);
  }, [price]);
  return flash;
}

function SectionHeader({
  Icon,
  title,
  iconColor = "text-zinc-600 dark:text-zinc-400",
  iconBg = "bg-zinc-100 dark:bg-zinc-900/60",
}: {
  Icon: LucideIcon;
  title: string;
  iconColor?: string;
  iconBg?: string;
}) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <div className={`flex size-7 items-center justify-center rounded-lg ${iconBg} ring-1 ring-zinc-200 dark:ring-zinc-800/80`}>
        <Icon className={`size-3.5 ${iconColor}`} />
      </div>
      <h2 className="text-[11px] font-bold uppercase tracking-[0.25em] text-zinc-700 dark:text-zinc-300">
        {title}
      </h2>
    </div>
  );
}

export function StockDetail({ symbol }: StockDetailProps) {
  const { stockMap } = useMarketData();
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<StockDetailSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartInterval, setChartInterval] = useState("5m");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [, setNowTick] = useState(0);

  // Fire AI POST immediately on mount (in parallel with the snapshot fetch
  // below — don't make the user wait for both serially). Also auto-refreshes
  // every 5 min while the page is open. Self-disables when AI mode is off.
  const ai = useAiCall(symbol);

  // Refresh "Updated X min ago" once per minute even without WS ticks.
  useEffect(() => {
    const id = window.setInterval(() => setNowTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const liveStock = stockMap.get(symbol);

  useEffect(() => {
    let active = true;
    async function fetchSnapshot() {
      try {
        const res = await apiFetch(`/api/stocks/${encodeURIComponent(symbol)}/snapshot`);
        if (!res.ok) {
          if (active) setLoading(false);
          return;
        }
        const data = (await res.json()) as StockDetailSnapshot;
        if (active) {
          setSnapshot(data);
          setLoading(false);
        }
      } catch {
        if (active) setLoading(false);
      }
    }
    fetchSnapshot();
    const handle = window.setInterval(fetchSnapshot, 10_000);
    return () => {
      active = false;
      window.clearInterval(handle);
    };
  }, [symbol]);

  // Prefer live WS data if symbol is tracked.
  const intel: IntelligenceSnapshot | null = useMemo(() => {
    if (liveStock) return liveStock;
    return snapshot;
  }, [liveStock, snapshot]);

  // Render-time SR validation. The backend levels cache (computed against a
  // snapshot of currentPrice) can drift as price moves — a "support" level can
  // end up above the live price, or a "resistance" below it. Drop those at
  // render time so we never draw an inverted line. Only validates when we have
  // a live price to compare against; otherwise pass the raw cached value
  // through unchanged (preserves loading/empty behavior). The deeper `?.` on
  // `levels` guards against backend payloads that omit it (defensive — type
  // says required but runtime can occasionally drift).
  const livePriceForSR = intel?.price ?? null;
  const rawSupport = snapshot?.levels?.support ?? null;
  const rawResistance = snapshot?.levels?.resistance ?? null;
  const supportLevel =
    livePriceForSR !== null && rawSupport !== null && rawSupport >= livePriceForSR
      ? null
      : rawSupport;
  const resistanceLevel =
    livePriceForSR !== null && rawResistance !== null && rawResistance <= livePriceForSR
      ? null
      : rawResistance;

  const chartTick: ChartTick | null = intel
    ? { price: intel.price, timestamp: intel.timestamp }
    : null;

  // Hooks must run in the same order every render (Rules of Hooks). Keep
  // `usePriceFlash` UP HERE — calling it after the early-return blocks below
  // caused intermittent "Rendered more hooks than during the previous render"
  // crashes on cold reload (when `intel` was null on render 1, then non-null
  // on render 2 once the snapshot fetch resolved). Pass 0 when intel isn't
  // ready yet — usePriceFlash handles it (no flash on identical prices).
  const flash = usePriceFlash(intel?.price ?? 0);
  const priceFlashColor = flash === "up"
    ? "text-emerald-600 dark:text-emerald-400"
    : flash === "down"
    ? "text-rose-600 dark:text-rose-400"
    : "text-zinc-900 dark:text-zinc-50";

  if (loading && !intel) {
    return (
      <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (!intel) {
    return (
      <div className="max-w-[1400px] mx-auto px-4 py-12 text-center text-sm text-muted-foreground">
        Could not load data for <span className="font-semibold">{symbol}</span>.
        <div className="mt-4">
          <Link href="/" className="text-emerald-400 underline">
            Back to scanner
          </Link>
        </div>
      </div>
    );
  }

  const zone = intel.context.zone;
  const mDir = momentumDirection(intel.momentum.label);
  const pDir = pressureDirection(intel.pressure.label);
  // Volatility tinting follows overall card direction when momentum + pressure
  // agree — same rule as the home MarketCard for visual consistency.
  const volDir: "up" | "down" | "flat" =
    mDir !== "flat" && mDir === pDir ? mDir : "flat";

  const changeUp = intel.change > 0;
  const changeDown = intel.change < 0;
  const ChangeIcon = changeUp ? ArrowUp : changeDown ? ArrowDown : Minus;
  const changeColor = changeUp
    ? "text-emerald-600 dark:text-emerald-400"
    : changeDown
    ? "text-rose-600 dark:text-rose-400"
    : "text-zinc-500";

  // Price-flash hook + color resolved above the early returns (see comment).

  return (
    <main className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="group inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-900/40 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-200"
        >
          <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />
          Back to scanner
        </Link>
        <AddToWatchZoneButton symbol={symbol} price={intel.price} isLoggedIn={!!user} />
      </div>

      {/* Hero */}
      <div className={`relative overflow-hidden rounded-2xl border ${ZONE_BORDER[zone]} bg-gradient-to-br ${ZONE_GRADIENT[zone]} bg-white dark:bg-zinc-950/60 p-7`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`flex size-14 items-center justify-center rounded-2xl ring-1 ring-zinc-200/60 dark:ring-white/5 ${ZONE_ICON_BG[zone]}`}>
              <TrendingUp className="size-6" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                {symbol}
              </h1>
              <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                Real-time market activity overview
              </p>
              <DetailActionBadge intel={intel} />
            </div>
          </div>
          <div className="text-right">
            <div
              className={`text-4xl font-bold tabular-nums transition-colors duration-700 ${priceFlashColor}`}
              style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)" }}
            >
              ₹{intel.price.toFixed(2)}
            </div>
            <div className={`mt-1 inline-flex items-center gap-1 text-sm font-semibold tabular-nums ${changeColor}`}>
              <ChangeIcon className="size-3.5" />
              {changeUp ? "+" : ""}
              {intel.change.toFixed(2)}%
            </div>
            <div className="mt-2 flex items-center justify-end gap-2.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/[0.08] px-2 py-0.5">
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                </span>
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-300">
                  Live
                </span>
              </span>
              <span className="text-[11px] text-zinc-500 tabular-nums">
                {formatTimeAgo(intel.timestamp)}
              </span>
            </div>
          </div>
        </div>
        <div className="pointer-events-none absolute -bottom-20 -right-20 size-48 rounded-full blur-3xl bg-zinc-200/50 dark:bg-zinc-700/10" />
      </div>

      {/* AI Verdict — renders only when AI mode is ON. Hook is lifted to
          this parent (see useAiCall above) so the POST fires as soon as
          the page mounts, in parallel with the snapshot fetch — and auto-
          refreshes every 5 min while the page stays open. */}
      <AiAnalysisCard
        symbol={symbol}
        verdict={ai.verdict}
        isLoading={ai.isLoading}
        error={ai.error}
        refresh={ai.refresh}
      />

      {/* Chart */}
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-5">
        <div className="mb-4 flex items-center justify-between">
          <SectionHeader Icon={BarChart3} title="Price Chart" iconColor="text-cyan-600 dark:text-cyan-400" iconBg="bg-cyan-500/10" />
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-900/40 p-1">
              {(["1m", "5m", "15m", "1H", "1D"] as const).map((opt) => (
                <button
                  key={opt}
                  onClick={() => setChartInterval(opt)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    chartInterval === opt
                      ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm"
                      : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
            <button
              onClick={() => setIsFullscreen(true)}
              className="flex size-8 items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-900/40 text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
              title="Full screen"
            >
              <Maximize2 className="size-3.5" />
            </button>
          </div>
        </div>
        <div className="h-[500px] w-full">
          <CandlestickChart
            symbol={symbol}
            interval={chartInterval}
            tick={chartTick}
            days={chartInterval === "1D" ? 90 : 5}
            supportLevel={supportLevel}
            resistanceLevel={resistanceLevel}
          />
        </div>
      </section>

      {/* Analytical cards — 4-up grid: Market Context, Momentum, Pressure, Volatility */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Market Context */}
        <section className={`rounded-2xl border ${ZONE_BORDER[zone]} bg-gradient-to-br ${ZONE_GRADIENT[zone]} bg-white dark:bg-zinc-950/60 p-6`}>
          <SectionHeader Icon={Target} title="Market Context" iconColor="text-blue-600 dark:text-blue-400" iconBg="bg-blue-500/10" />
          <div className="space-y-4">
            <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {zoneDisplay(zone)}
            </div>
            {intel.context.level !== null && intel.context.distanceToLevel !== null ? (
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                Key level at{" "}
                <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-200">
                  ₹{intel.context.level.toFixed(2)}
                </span>
                {" · "}
                <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-200">
                  {intel.context.distanceToLevel.toFixed(2)}%
                </span>
                {" away"}
              </div>
            ) : (
              <div className="text-sm text-zinc-500">No level within 1% of current price</div>
            )}

            {snapshot?.levels && (
              <div className="space-y-2 border-t border-zinc-200 dark:border-zinc-800/80 pt-3">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
                    <Crosshair className="size-3 text-rose-500 dark:text-rose-400/70" />
                    <span>Resistance</span>
                  </div>
                  {resistanceLevel !== null ? (
                    <span className="font-mono font-semibold tabular-nums text-rose-700 dark:text-rose-300">
                      ₹{resistanceLevel.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-[11px] italic text-zinc-500 dark:text-zinc-500">
                      No level within 5%
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
                    <Crosshair className="size-3 text-emerald-500 dark:text-emerald-400/70" />
                    <span>Support</span>
                  </div>
                  {supportLevel !== null ? (
                    <span className="font-mono font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
                      ₹{supportLevel.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-[11px] italic text-zinc-500 dark:text-zinc-500">
                      No level within 5%
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Momentum Analysis */}
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-6">
          <SectionHeader Icon={Activity} title="Momentum Analysis" iconColor="text-purple-600 dark:text-purple-400" iconBg="bg-purple-500/10" />
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {mDir === "up" && <ArrowUp className={`size-7 ${directionColor("up")}`} strokeWidth={2.75} />}
              {mDir === "down" && <ArrowDown className={`size-7 ${directionColor("down")}`} strokeWidth={2.75} />}
              {mDir === "flat" && <Minus className={`size-7 ${directionColor("flat")}`} strokeWidth={2.75} />}
              <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
                {momentumDisplay(intel.momentum.label)}
              </div>
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {momentumHeadline(intel.momentum.label)}
            </p>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-[0.25em] text-zinc-500">Strength</span>
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  {strengthDescriptor(intel.momentum.score)}
                </span>
              </div>
              <StrengthBar score={intel.momentum.score} dir={mDir} />
            </div>
          </div>
        </section>

        {/* Pressure Analysis — N/A for indices (no order-book volume).
            For stocks, full readings as before. */}
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-6">
          <SectionHeader Icon={Gauge} title="Pressure Analysis" iconColor="text-cyan-600 dark:text-cyan-400" iconBg="bg-cyan-500/10" />
          {intel.pressure.label === "NOT_APPLICABLE" ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Minus className={`size-7 ${directionColor("flat")}`} strokeWidth={2.75} />
                <div className="text-2xl font-bold text-zinc-500 dark:text-zinc-400">
                  Not Applicable
                </div>
              </div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {pressureHeadline(intel.pressure.label)}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-500">
                Indices are computed from constituent stocks and have no traded volume of their own. Buying / selling pressure is measured from order-book flow, which only exists on individual stocks.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                {pDir === "up" && <ArrowUp className={`size-7 ${directionColor("up")}`} strokeWidth={2.75} />}
                {pDir === "down" && <ArrowDown className={`size-7 ${directionColor("down")}`} strokeWidth={2.75} />}
                {pDir === "flat" && <Minus className={`size-7 ${directionColor("flat")}`} strokeWidth={2.75} />}
                <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
                  {pressureDisplay(intel.pressure.label)}
                </div>
              </div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {pressureHeadline(intel.pressure.label)}
              </p>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-[0.25em] text-zinc-500">Strength</span>
                  <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    {strengthDescriptor(intel.pressure.score)}
                  </span>
                </div>
                <StrengthBar score={intel.pressure.score} dir={pDir} />
              </div>
            </div>
          )}
        </section>

        {/* Volatility State */}
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-6">
          <SectionHeader Icon={Zap} title="Volatility State" iconColor="text-amber-600 dark:text-amber-400" iconBg="bg-amber-500/10" />
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Waves className="size-7 text-amber-500 dark:text-amber-400" strokeWidth={2.5} />
              <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
                {volatilityDisplay(intel.volatility.label)}
              </div>
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {volatilityHeadline(intel.volatility.label)}
            </p>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-[0.25em] text-zinc-500">Magnitude</span>
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  {strengthDescriptor(intel.volatility.score)}
                </span>
              </div>
              <StrengthBar score={intel.volatility.score} dir={volDir} />
            </div>
          </div>
        </section>
      </div>

      {/* Market Observation — single descriptive sentence */}
      <section className="rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/5 via-white to-white dark:from-emerald-500/8 dark:via-zinc-950/60 dark:to-zinc-950/60 p-6">
        <SectionHeader Icon={Eye} title="Market Observation" iconColor="text-emerald-600 dark:text-emerald-400" iconBg="bg-emerald-500/10" />
        <p className="text-lg leading-relaxed text-zinc-800 dark:text-zinc-100">
          {marketObservation(intel)}
        </p>
      </section>

      {/* Market Interpretation — paragraph reading current conditions */}
      <section className="rounded-2xl border border-cyan-500/25 bg-gradient-to-br from-cyan-500/5 via-white to-white dark:from-cyan-500/8 dark:via-zinc-950/60 dark:to-zinc-950/60 p-6">
        <SectionHeader Icon={Lightbulb} title="Market Interpretation" iconColor="text-cyan-600 dark:text-cyan-400" iconBg="bg-cyan-500/10" />
        <p className="text-base leading-relaxed text-zinc-700 dark:text-zinc-200">
          {marketInterpretation(intel)}
        </p>
      </section>

      {/* Market Conditions — bullet list */}
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-6">
        <SectionHeader Icon={Layers} title="Market Conditions" iconColor="text-zinc-600 dark:text-zinc-400" />
        <ul className="space-y-3">
          {marketConditions(intel).map((line, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-zinc-400 dark:bg-zinc-600" />
              <span className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                {line}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Fullscreen chart overlay */}
      {isFullscreen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-zinc-950">
          <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800/80 px-5 py-3">
            <div className="flex items-center gap-3">
              <BarChart3 className="size-4 text-cyan-600 dark:text-cyan-400" />
              <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                {symbol}
              </span>
              <span className="text-xs tabular-nums text-zinc-500">
                ₹{intel.price.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-900/40 p-1">
                {(["1m", "5m", "15m", "1H", "1D"] as const).map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setChartInterval(opt)}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      chartInterval === opt
                        ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm"
                        : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setIsFullscreen(false)}
                className="flex size-8 items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-800/80 text-zinc-500 transition-colors hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400"
                title="Close"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 p-4">
            <CandlestickChart
              symbol={symbol}
              interval={chartInterval}
              tick={chartTick}
              days={chartInterval === "1D" ? 90 : 5}
              supportLevel={supportLevel}
              resistanceLevel={resistanceLevel}
            />
          </div>
        </div>
      )}
    </main>
  );
}

// Action + confidence chip rendered under the symbol title in the hero. Reads
// the existing snapshot's outlook + confidence — no new data path.
// Hidden when AI mode is ON (AI Analysis card below is the verdict source then).
function DetailActionBadge({ intel }: { intel: IntelligenceSnapshot }) {
  const { aiModeEnabled } = useServerConfig();
  if (aiModeEnabled) return null;

  const { action, setup } = OUTLOOK_TO_ACTION[intel.outlook];
  const confPct = Math.round(Math.max(0, Math.min(1, intel.confidence)) * 100);

  const actionBadge =
    action === "BUY"
      ? "bg-gradient-to-r from-emerald-500 to-emerald-400 text-white shadow-sm shadow-emerald-500/30 ring-1 ring-emerald-300/40"
      : action === "SELL"
      ? "bg-gradient-to-r from-rose-500 to-rose-400 text-white shadow-sm shadow-rose-500/30 ring-1 ring-rose-300/40"
      : "bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 ring-1 ring-zinc-300 dark:ring-zinc-700";

  const ActionIcon = action === "BUY" ? ArrowUp : action === "SELL" ? ArrowDown : Pause;

  const confTone =
    intel.confidenceLabel === "HIGH"
      ? "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 ring-emerald-500/30"
      : intel.confidenceLabel === "MEDIUM"
      ? "text-amber-700 dark:text-amber-300 bg-amber-500/10 ring-amber-500/30"
      : "text-zinc-600 dark:text-zinc-400 bg-zinc-500/10 ring-zinc-500/20";

  return (
    <div className="mt-3 flex items-center gap-2">
      <span
        className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold tracking-wider ${actionBadge}`}
      >
        <ActionIcon className="size-3.5" strokeWidth={3.5} />
        {action}
      </span>
      <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{setup}</span>
      <span
        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold ring-1 ${confTone}`}
      >
        <span className="text-[9px] uppercase tracking-widest opacity-70">Conf</span>
        <span className="tabular-nums">{confPct}%</span>
      </span>
    </div>
  );
}
