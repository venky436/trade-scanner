"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowDownRight,
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  BarChart3,
  Compass,
  Crosshair,
  Flame,
  Gauge,
  Lightbulb,
  Minus,
  Pause,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { CandlestickChart, type ChartTick } from "./candlestick-chart";
import { useMarketData } from "@/hooks/use-market-data";
import { useAuth } from "@/context/auth-context";
import { apiFetch } from "@/lib/api";
import { AddToWatchZoneButton } from "./watch-zone";
import type {
  Bias,
  ConfidenceLabel,
  IntelligenceSnapshot,
  MomentumLabel,
  Outlook,
  PressureLabel,
  StockDetailSnapshot,
  VolatilityLabel,
  Zone,
} from "@/lib/types";

interface StockDetailProps {
  symbol: string;
}

// ── Zone styling ──

const ZONE_LABEL: Record<Zone, string> = {
  NEAR_RESISTANCE: "Near Resistance",
  NEAR_SUPPORT: "Near Support",
  MID_RANGE: "Mid Range",
};

const ZONE_GRADIENT: Record<Zone, string> = {
  NEAR_RESISTANCE:
    "from-rose-500/10 via-rose-500/5 to-transparent dark:from-rose-500/15",
  NEAR_SUPPORT:
    "from-emerald-500/10 via-emerald-500/5 to-transparent dark:from-emerald-500/15",
  MID_RANGE:
    "from-zinc-200/40 via-zinc-100/20 to-transparent dark:from-zinc-700/20 dark:via-zinc-800/10",
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

// ── Outlook hero styling ──

interface OutlookStyle {
  icon: LucideIcon;
  label: string;
  bg: string;
  border: string;
  iconBg: string;
  iconColor: string;
  textColor: string;
  glow: string;
}

const OUTLOOK_STYLES: Record<Outlook, OutlookStyle> = {
  BREAKOUT_LIKELY: {
    icon: Flame,
    label: "Breakout Likely",
    bg: "bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent dark:from-emerald-500/20 dark:via-emerald-500/8",
    border: "border-emerald-500/40",
    iconBg: "bg-emerald-500/15 dark:bg-emerald-500/25",
    iconColor: "text-emerald-600 dark:text-emerald-300",
    textColor: "text-emerald-700 dark:text-emerald-100",
    glow: "shadow-emerald-500/10",
  },
  BOUNCE_EXPECTED: {
    icon: ArrowUpRight,
    label: "Bounce Expected",
    bg: "bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent dark:from-emerald-500/20 dark:via-emerald-500/8",
    border: "border-emerald-500/40",
    iconBg: "bg-emerald-500/15 dark:bg-emerald-500/25",
    iconColor: "text-emerald-600 dark:text-emerald-300",
    textColor: "text-emerald-700 dark:text-emerald-100",
    glow: "shadow-emerald-500/10",
  },
  REJECTION_POSSIBLE: {
    icon: ArrowDownRight,
    label: "Rejection Possible",
    bg: "bg-gradient-to-br from-rose-500/15 via-rose-500/5 to-transparent dark:from-rose-500/20 dark:via-rose-500/8",
    border: "border-rose-500/40",
    iconBg: "bg-rose-500/15 dark:bg-rose-500/25",
    iconColor: "text-rose-600 dark:text-rose-300",
    textColor: "text-rose-700 dark:text-rose-100",
    glow: "shadow-rose-500/10",
  },
  BREAKDOWN_RISK: {
    icon: TrendingDown,
    label: "Breakdown Risk",
    bg: "bg-gradient-to-br from-rose-500/15 via-rose-500/5 to-transparent dark:from-rose-500/20 dark:via-rose-500/8",
    border: "border-rose-500/40",
    iconBg: "bg-rose-500/15 dark:bg-rose-500/25",
    iconColor: "text-rose-600 dark:text-rose-300",
    textColor: "text-rose-700 dark:text-rose-100",
    glow: "shadow-rose-500/10",
  },
  NO_CLEAR_EDGE: {
    icon: Pause,
    label: "No Clear Edge",
    bg: "bg-gradient-to-br from-zinc-200/60 via-zinc-100/30 to-transparent dark:from-zinc-700/30 dark:via-zinc-800/15",
    border: "border-zinc-300 dark:border-zinc-700/60",
    iconBg: "bg-zinc-200 dark:bg-zinc-700/50",
    iconColor: "text-zinc-600 dark:text-zinc-300",
    textColor: "text-zinc-800 dark:text-zinc-100",
    glow: "shadow-zinc-500/5",
  },
};

// ── Metric labels ──

const MOMENTUM_LABEL: Record<MomentumLabel, string> = {
  STRONG_UP: "Strong Up",
  WEAK_UP: "Weak Up",
  NEUTRAL: "Neutral",
  WEAK_DOWN: "Weak Down",
  STRONG_DOWN: "Strong Down",
};

const PRESSURE_LABEL: Record<PressureLabel, string> = {
  BUY: "Buy",
  NEUTRAL: "Neutral",
  SELL: "Sell",
};

const VOL_LABEL: Record<VolatilityLabel, string> = {
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

// ── Confidence ──

const CONFIDENCE_FILL: Record<ConfidenceLabel, string> = {
  HIGH: "bg-gradient-to-r from-emerald-500 to-emerald-400",
  MEDIUM: "bg-gradient-to-r from-amber-500 to-amber-400",
  LOW: "bg-gradient-to-r from-zinc-600 to-zinc-500",
};

const CONFIDENCE_TEXT: Record<ConfidenceLabel, string> = {
  HIGH: "text-emerald-700 dark:text-emerald-300",
  MEDIUM: "text-amber-700 dark:text-amber-300",
  LOW: "text-zinc-500 dark:text-zinc-400",
};

// ── Bias ──

const BIAS_LABEL: Record<Bias, string> = {
  BULLISH: "Bullish bias",
  BEARISH: "Bearish bias",
  NEUTRAL: "Neutral bias",
};

const BIAS_DOT: Record<Bias, string> = {
  BULLISH: "bg-emerald-500 dark:bg-emerald-400",
  BEARISH: "bg-rose-500 dark:bg-rose-400",
  NEUTRAL: "bg-zinc-400 dark:bg-zinc-500",
};

const BIAS_TEXT: Record<Bias, string> = {
  BULLISH: "text-emerald-700 dark:text-emerald-300",
  BEARISH: "text-rose-700 dark:text-rose-300",
  NEUTRAL: "text-zinc-500 dark:text-zinc-400",
};

// ── Helpers ──

function MomentumIcon({ label, className }: { label: MomentumLabel; className?: string }) {
  if (label === "STRONG_UP" || label === "WEAK_UP")
    return (
      <ArrowUp
        className={`${className ?? "size-4"} text-emerald-600 dark:text-emerald-400`}
      />
    );
  if (label === "STRONG_DOWN" || label === "WEAK_DOWN")
    return (
      <ArrowDown
        className={`${className ?? "size-4"} text-rose-600 dark:text-rose-400`}
      />
    );
  return <Minus className={`${className ?? "size-4"} text-zinc-500`} />;
}

function scenarioText(intel: IntelligenceSnapshot): string {
  const lvl = intel.context.level !== null ? `₹${intel.context.level.toFixed(2)}` : null;
  switch (intel.outlook) {
    case "BREAKOUT_LIKELY":
      return lvl
        ? `Price could break above ${lvl} and continue higher if buying pressure holds.`
        : "Price could break out of its range if buying pressure holds.";
    case "BREAKDOWN_RISK":
      return lvl
        ? `Price could break below ${lvl} and accelerate lower if selling pressure persists.`
        : "Price could break down out of its range if selling pressure persists.";
    case "BOUNCE_EXPECTED":
      return lvl
        ? `Price is testing support near ${lvl} — a bounce is plausible while buyers stay engaged.`
        : "Price is testing support — a bounce is plausible while buyers stay engaged.";
    case "REJECTION_POSSIBLE":
      return lvl
        ? `Price is testing resistance near ${lvl} — a pullback is plausible if sellers step in.`
        : "Price is testing resistance — a pullback is plausible if sellers step in.";
    case "NO_CLEAR_EDGE":
    default:
      return "No clear directional edge right now — price has room before either level matters.";
  }
}

// Plain-language explanation of the current state — read like a human friend.
function whatThisMeans(intel: IntelligenceSnapshot): string {
  const momentumDir =
    intel.momentum.label === "STRONG_UP" || intel.momentum.label === "WEAK_UP"
      ? "upward"
      : intel.momentum.label === "STRONG_DOWN" || intel.momentum.label === "WEAK_DOWN"
      ? "downward"
      : "flat";
  const pressureDir =
    intel.pressure.label === "BUY"
      ? "buying"
      : intel.pressure.label === "SELL"
      ? "selling"
      : "balanced";

  if (intel.context.zone === "NEAR_SUPPORT") {
    if (momentumDir === "upward")
      return "Price is sitting near a support level and showing upward momentum. Buyers are defending the level, which often leads to a short-term bounce. The stronger the buying pressure, the cleaner the move.";
    if (momentumDir === "downward")
      return "Price is testing a support level but momentum is leaning downward. If the level holds you may see a bounce; if sellers push through, the next leg can be quick.";
    return "Price is at support but the move is quiet. The level is being tested — wait for momentum to confirm which side wins.";
  }

  if (intel.context.zone === "NEAR_RESISTANCE") {
    if (momentumDir === "downward")
      return "Price ran up into resistance and is now showing downward momentum. Sellers are stepping in. A short-term pullback from this level is the more probable scenario.";
    if (momentumDir === "upward")
      return "Price is testing resistance with upward momentum. If buying pressure holds the level can break, but until then the resistance has the edge.";
    return "Price is at resistance but the move is quiet. The level is in play — wait for momentum to show its hand.";
  }

  // MID_RANGE
  if (momentumDir !== "flat" && pressureDir !== "balanced")
    return `Price is mid-range but ${momentumDir} momentum and ${pressureDir} pressure are aligned. There's a directional bias building, but no level to anchor it against yet.`;

  return "Price is mid-range with no clear momentum. There is no actionable setup right now — better to wait for price to reach a level or for the move to pick up.";
}

// Non-directive framing — what to LOOK FOR, never what to do.
function suggestedApproach(intel: IntelligenceSnapshot): string {
  switch (intel.outlook) {
    case "BREAKOUT_LIKELY":
      return "Look for upward continuation setups above the level. Avoid short positions in this zone while buying pressure holds.";
    case "BOUNCE_EXPECTED":
      return "Look for upward setups while the level holds. Avoid shorting into a defended support.";
    case "REJECTION_POSSIBLE":
      return "Look for downside continuation. Avoid long positions while sellers are pressing this level.";
    case "BREAKDOWN_RISK":
      return "Look for downside setups below the level. Avoid longs until buyers reclaim the support.";
    case "NO_CLEAR_EDGE":
    default:
      return "No clear edge — better to wait for a cleaner setup before committing in either direction.";
  }
}

interface RiskItem {
  text: string;
  severity: "high" | "medium" | "low";
}

function riskItems(intel: IntelligenceSnapshot): RiskItem[] {
  const items: RiskItem[] = [];

  if (intel.confidenceLabel === "LOW") {
    items.push({ text: "Low confidence — wait for stronger conviction before acting.", severity: "high" });
  } else if (intel.confidenceLabel === "MEDIUM") {
    items.push({ text: "Confidence not yet HIGH — fake breakout possible if momentum stalls.", severity: "medium" });
  }

  if (intel.volatility.label === "LOW") {
    items.push({ text: "Low volatility — moves may stall before reaching targets.", severity: "medium" });
  }

  if (intel.bias === "NEUTRAL" && intel.outlook !== "NO_CLEAR_EDGE") {
    items.push({ text: "Neutral bias — momentum and pressure are not aligned.", severity: "medium" });
  }

  if (intel.context.zone === "MID_RANGE") {
    items.push({ text: "Mid-range — no level to anchor a setup against.", severity: "low" });
  }

  if (intel.outlook === "BOUNCE_EXPECTED" || intel.outlook === "REJECTION_POSSIBLE") {
    items.push({ text: "Reversals fail when pressure stays one-sided — watch the level carefully.", severity: "low" });
  }

  if (items.length === 0) {
    items.push({ text: "Conditions look aligned — but markets can still surprise. Re-evaluate if any input flips.", severity: "low" });
  }

  return items;
}

const SEVERITY_DOT: Record<RiskItem["severity"], string> = {
  high: "bg-rose-500 dark:bg-rose-400",
  medium: "bg-amber-500 dark:bg-amber-400",
  low: "bg-zinc-400 dark:bg-zinc-500",
};

function SectionHeader({ Icon, title, color }: { Icon: LucideIcon; title: string; color?: string }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <div className={`flex size-7 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-900/60 ring-1 ring-zinc-200 dark:ring-zinc-800/80 ${color ?? ""}`}>
        <Icon className="size-3.5" />
      </div>
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
        {title}
      </h2>
    </div>
  );
}

function MetricRow({
  Icon,
  iconColor,
  label,
  detail,
  score,
  tone,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  label: string;
  detail: string;
  score: number;
  tone: "up" | "down" | "neutral";
}) {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);
  const fill =
    tone === "up"
      ? "bg-gradient-to-r from-emerald-500/80 to-emerald-400/80"
      : tone === "down"
      ? "bg-gradient-to-r from-rose-500/80 to-rose-400/80"
      : "bg-gradient-to-r from-zinc-600 to-zinc-500";

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800/60 bg-zinc-50 dark:bg-zinc-900/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <div
            className={`flex size-6 shrink-0 items-center justify-center rounded-md bg-zinc-200 dark:bg-zinc-800/60 ${iconColor}`}
          >
            <Icon className="size-3.5" />
          </div>
          <div>
            <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{label}</div>
            <div className="mt-0.5 text-[10px] text-zinc-500">{detail}</div>
          </div>
        </div>
        <span className="text-xs font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
          {score.toFixed(2)}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800/80">
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Main ──

export function StockDetail({ symbol }: StockDetailProps) {
  const { stockMap } = useMarketData();
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<StockDetailSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [interval, setInterval] = useState("5m");

  // Live data overlays the REST snapshot (if the symbol is tracked).
  const liveStock = stockMap.get(symbol);

  // Fetch snapshot on mount + every 10s.
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

  // Prefer live WS data for the visible card fields if the symbol is tracked.
  const intel: IntelligenceSnapshot | null = useMemo(() => {
    if (liveStock) return liveStock;
    return snapshot;
  }, [liveStock, snapshot]);

  // Chart S/R lines come from the snapshot endpoint (REST), since they're not in WS payload.
  const supportLevel = snapshot?.levels.support ?? null;
  const resistanceLevel = snapshot?.levels.resistance ?? null;

  // Live chart tick updates use price + timestamp from the live intelligence snapshot.
  const chartTick: ChartTick | null = intel
    ? { price: intel.price, timestamp: intel.timestamp }
    : null;

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

  const outlook = OUTLOOK_STYLES[intel.outlook];
  const OutlookIcon = outlook.icon;

  const momentumTone =
    intel.momentum.label === "STRONG_UP" || intel.momentum.label === "WEAK_UP"
      ? "up"
      : intel.momentum.label === "STRONG_DOWN" || intel.momentum.label === "WEAK_DOWN"
      ? "down"
      : "neutral";

  const pressureTone =
    intel.pressure.label === "BUY" ? "up" : intel.pressure.label === "SELL" ? "down" : "neutral";

  const pressureIconColor =
    intel.pressure.label === "BUY"
      ? "text-emerald-600 dark:text-emerald-400"
      : intel.pressure.label === "SELL"
      ? "text-rose-600 dark:text-rose-400"
      : "text-zinc-500";

  const momentumIconColor =
    intel.momentum.label === "STRONG_UP" || intel.momentum.label === "WEAK_UP"
      ? "text-emerald-600 dark:text-emerald-400"
      : intel.momentum.label === "STRONG_DOWN" || intel.momentum.label === "WEAK_DOWN"
      ? "text-rose-600 dark:text-rose-400"
      : "text-zinc-500";

  const changeTone =
    intel.change > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : intel.change < 0
      ? "text-rose-600 dark:text-rose-400"
      : "text-zinc-500 dark:text-zinc-400";
  const changePositive = intel.change >= 0;
  const ChangeIcon = changePositive ? ArrowUp : ArrowDown;

  const confPct = Math.round(Math.max(0, Math.min(1, intel.confidence)) * 100);

  const risks = riskItems(intel);

  return (
    <main className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">
      {/* Top bar — back + watch zone */}
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

      {/* Hero header: symbol + price + outlook banner */}
      <div
        className={`relative overflow-hidden rounded-2xl border ${ZONE_BORDER[intel.context.zone]} bg-gradient-to-br ${ZONE_GRADIENT[intel.context.zone]} bg-white dark:bg-zinc-950/60 p-6`}
      >
        <div className="flex items-start justify-between gap-4">
          {/* Symbol + zone badge */}
          <div className="flex items-center gap-4">
            <div
              className={`flex size-14 items-center justify-center rounded-2xl ring-1 ring-zinc-200/60 dark:ring-white/5 ${ZONE_ICON_BG[intel.context.zone]}`}
            >
              <TrendingUp className="size-6" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                {symbol}
              </h1>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                  {ZONE_LABEL[intel.context.zone]}
                </span>
                <span className="text-zinc-300 dark:text-zinc-700">·</span>
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                  {snapshot?.dataSource === "on-demand" ? "On-demand" : "Live"}
                </span>
                {snapshot?.dataSource !== "on-demand" && (
                  <span className="size-1.5 animate-pulse rounded-full bg-emerald-500 dark:bg-emerald-400/70" />
                )}
              </div>
            </div>
          </div>

          {/* Price + change */}
          <div className="text-right">
            <div className="text-4xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
              ₹{intel.price.toFixed(2)}
            </div>
            <div
              className={`mt-1 inline-flex items-center gap-1 text-sm font-semibold tabular-nums ${changeTone}`}
            >
              <ChangeIcon className="size-3.5" />
              {changePositive ? "+" : ""}
              {intel.change.toFixed(2)}%
            </div>
          </div>
        </div>

        {/* Outlook hero banner */}
        <div
          className={`mt-6 flex items-center gap-4 rounded-xl border-2 ${outlook.border} ${outlook.bg} px-5 py-4 shadow-lg ${outlook.glow}`}
        >
          <div
            className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${outlook.iconBg}`}
          >
            <OutlookIcon className={`size-6 ${outlook.iconColor}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className={`text-lg font-bold ${outlook.textColor}`}>{outlook.label}</div>
            <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-300/80">
              {scenarioText(intel)}
            </p>
          </div>
        </div>

        {/* Soft glow blob */}
        <div className="pointer-events-none absolute -bottom-20 -right-20 size-48 rounded-full blur-3xl bg-zinc-200/50 dark:bg-zinc-700/10" />
      </div>

      {/* What this means — plain-language explanation */}
      <section className="rounded-2xl border border-amber-500/30 dark:border-amber-500/20 bg-gradient-to-br from-amber-500/8 via-white to-white dark:from-amber-500/8 dark:via-zinc-950/60 dark:to-zinc-950/60 p-5">
        <div className="mb-3 flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-amber-500/15 ring-1 ring-amber-500/20">
            <Lightbulb className="size-3.5 text-amber-600 dark:text-amber-400" />
          </div>
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
            What this means
          </h2>
        </div>
        <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">
          {whatThisMeans(intel)}
        </p>
      </section>

      {/* Suggested Approach — non-directive framing */}
      <section className="rounded-2xl border border-cyan-500/30 dark:border-cyan-500/20 bg-gradient-to-br from-cyan-500/8 via-white to-white dark:from-cyan-500/8 dark:via-zinc-950/60 dark:to-zinc-950/60 p-5">
        <div className="mb-3 flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-cyan-500/15 ring-1 ring-cyan-500/20">
            <Compass className="size-3.5 text-cyan-600 dark:text-cyan-400" />
          </div>
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
            Suggested Approach
          </h2>
        </div>
        <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">
          {suggestedApproach(intel)}
        </p>
      </section>

      {/* 4-section grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 1. Context Summary */}
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-5">
          <SectionHeader Icon={Target} title="Context Summary" color="text-blue-600 dark:text-blue-400" />
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <div>
                <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  {ZONE_LABEL[intel.context.zone]}
                </div>
                {intel.context.level !== null && intel.context.distanceToLevel !== null ? (
                  <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                    Key level at{" "}
                    <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-200">
                      ₹{intel.context.level.toFixed(2)}
                    </span>
                  </div>
                ) : (
                  <div className="mt-1 text-xs text-zinc-500">No level within 1%</div>
                )}
              </div>
              {intel.context.distanceToLevel !== null && (
                <div className="text-right">
                  <div className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                    {intel.context.distanceToLevel.toFixed(2)}%
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">away</div>
                </div>
              )}
            </div>

            {/* Levels list */}
            {snapshot?.levels && (
              <div className="space-y-1.5 border-t border-zinc-200 dark:border-zinc-800/80 pt-3">
                {snapshot.levels.resistance !== null && (
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
                      <Crosshair className="size-3 text-rose-500 dark:text-rose-400/70" />
                      <span>Resistance</span>
                    </div>
                    <span className="font-mono font-semibold tabular-nums text-rose-700 dark:text-rose-300">
                      ₹{snapshot.levels.resistance.toFixed(2)}
                    </span>
                  </div>
                )}
                {snapshot.levels.support !== null && (
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
                      <Crosshair className="size-3 text-emerald-500 dark:text-emerald-400/70" />
                      <span>Support</span>
                    </div>
                    <span className="font-mono font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
                      ₹{snapshot.levels.support.toFixed(2)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* 2. Momentum Explanation */}
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-5">
          <SectionHeader Icon={Activity} title="Momentum Explanation" color="text-purple-600 dark:text-purple-400" />
          <div className="space-y-2.5">
            <MetricRow
              Icon={({ className }) => <MomentumIcon label={intel.momentum.label} className={className} />}
              iconColor={momentumIconColor}
              label={MOMENTUM_LABEL[intel.momentum.label]}
              detail="5-min weighted return"
              score={intel.momentum.score}
              tone={momentumTone}
            />
            <MetricRow
              Icon={Gauge}
              iconColor={pressureIconColor}
              label={`${PRESSURE_LABEL[intel.pressure.label]} pressure`}
              detail="Buyer/seller volume balance"
              score={intel.pressure.score}
              tone={pressureTone}
            />
            <MetricRow
              Icon={Zap}
              iconColor="text-amber-500 dark:text-amber-400/80"
              label={`${VOL_LABEL[intel.volatility.label]} volatility`}
              detail="Intraday range"
              score={intel.volatility.score}
              tone="neutral"
            />
          </div>
        </section>

        {/* 3. Possible Scenario + Confidence */}
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-5">
          <SectionHeader Icon={Sparkles} title="Possible Scenario" color="text-amber-600 dark:text-amber-400" />
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div
                className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${outlook.iconBg}`}
              >
                <OutlookIcon className={`size-4 ${outlook.iconColor}`} />
              </div>
              <div className="min-w-0">
                <div className={`text-sm font-bold ${outlook.textColor}`}>{outlook.label}</div>
                <p className="mt-0.5 text-[11px] text-zinc-600 dark:text-zinc-400">
                  {scenarioText(intel)}
                </p>
              </div>
            </div>

            {/* Confidence bar */}
            <div className="border-t border-zinc-200 dark:border-zinc-800/80 pt-3">
              <div className="mb-1.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Lightbulb className="size-3 text-zinc-500" />
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                    Confidence
                  </span>
                </div>
                <span className={`text-xs font-bold ${CONFIDENCE_TEXT[intel.confidenceLabel]}`}>
                  {intel.confidenceLabel} · {confPct}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800/80">
                <div
                  className={`h-full rounded-full ${CONFIDENCE_FILL[intel.confidenceLabel]} transition-all duration-500`}
                  style={{ width: `${confPct}%` }}
                />
              </div>
            </div>

            {/* Bias */}
            <div className="flex items-center gap-1.5 pt-1">
              <span className={`size-1.5 rounded-full ${BIAS_DOT[intel.bias]}`} />
              <span className={`text-[11px] font-medium ${BIAS_TEXT[intel.bias]}`}>
                {BIAS_LABEL[intel.bias]}
              </span>
            </div>
          </div>
        </section>

        {/* 4. Risk */}
        <section className="rounded-2xl border border-amber-500/30 dark:border-amber-500/20 bg-gradient-to-br from-amber-500/8 via-white to-white dark:from-amber-500/8 dark:via-zinc-950/60 dark:to-zinc-950/60 p-5">
          <SectionHeader Icon={AlertTriangle} title="Risk" color="text-amber-600 dark:text-amber-400" />
          <ul className="space-y-2.5">
            {risks.map((risk, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span
                  className={`mt-1.5 size-1.5 shrink-0 rounded-full ${SEVERITY_DOT[risk.severity]}`}
                />
                <span className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300/90">
                  {risk.text}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Chart */}
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex size-7 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-900/60 ring-1 ring-zinc-200 dark:ring-zinc-800/80">
              <BarChart3 className="size-3.5 text-cyan-600 dark:text-cyan-400" />
            </div>
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
              Price Chart
            </h2>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-900/40 p-1">
            {(["1m", "5m", "15m", "1H", "1D"] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setInterval(opt)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  interval === opt
                    ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
        <div className="h-[320px] w-full">
          <CandlestickChart
            symbol={symbol}
            interval={interval}
            tick={chartTick}
            days={interval === "1D" ? 90 : 5}
            supportLevel={supportLevel}
            resistanceLevel={resistanceLevel}
          />
        </div>
      </section>
    </main>
  );
}
