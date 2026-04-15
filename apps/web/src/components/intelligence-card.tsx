"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDown,
  ArrowDownRight,
  ArrowUp,
  ArrowUpRight,
  Flame,
  Gauge,
  Minus,
  Pause,
  TrendingDown,
  Zap,
} from "lucide-react";
import type {
  Bias,
  ConfidenceLabel,
  IntelligenceSnapshot,
  MomentumLabel,
  Outlook,
  PressureLabel,
  VolatilityLabel,
  Zone,
} from "@/lib/types";

interface IntelligenceCardProps {
  data: IntelligenceSnapshot;
}

// ── Zone (left accent stripe) ──

const ZONE_LEFT_BORDER: Record<Zone, string> = {
  NEAR_RESISTANCE: "border-l-rose-500/70 dark:border-l-rose-500/70",
  NEAR_SUPPORT: "border-l-emerald-500/70 dark:border-l-emerald-500/70",
  MID_RANGE: "border-l-zinc-300 dark:border-l-zinc-700",
};

const ZONE_LABEL: Record<Zone, string> = {
  NEAR_RESISTANCE: "Near Resistance",
  NEAR_SUPPORT: "Near Support",
  MID_RANGE: "Mid Range",
};

const ZONE_HOVER_SHADOW: Record<Zone, string> = {
  NEAR_RESISTANCE: "hover:shadow-rose-500/10",
  NEAR_SUPPORT: "hover:shadow-emerald-500/10",
  MID_RANGE: "hover:shadow-zinc-500/5",
};

// ── Outlook (hero) ──

interface OutlookStyle {
  icon: LucideIcon;
  label: string;
  bg: string;
  border: string;
  iconBg: string;
  iconColor: string;
  textColor: string;
}

const OUTLOOK_STYLES: Record<Outlook, OutlookStyle> = {
  BREAKOUT_LIKELY: {
    icon: Flame,
    label: "Breakout Likely",
    bg: "bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent dark:from-emerald-500/15",
    border: "border-emerald-500/40",
    iconBg: "bg-emerald-500/15 dark:bg-emerald-500/20",
    iconColor: "text-emerald-600 dark:text-emerald-400",
    textColor: "text-emerald-700 dark:text-emerald-100",
  },
  BOUNCE_EXPECTED: {
    icon: ArrowUpRight,
    label: "Bounce Expected",
    bg: "bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent dark:from-emerald-500/15",
    border: "border-emerald-500/40",
    iconBg: "bg-emerald-500/15 dark:bg-emerald-500/20",
    iconColor: "text-emerald-600 dark:text-emerald-400",
    textColor: "text-emerald-700 dark:text-emerald-100",
  },
  REJECTION_POSSIBLE: {
    icon: ArrowDownRight,
    label: "Rejection Possible",
    bg: "bg-gradient-to-br from-rose-500/10 via-rose-500/5 to-transparent dark:from-rose-500/15",
    border: "border-rose-500/40",
    iconBg: "bg-rose-500/15 dark:bg-rose-500/20",
    iconColor: "text-rose-600 dark:text-rose-400",
    textColor: "text-rose-700 dark:text-rose-100",
  },
  BREAKDOWN_RISK: {
    icon: TrendingDown,
    label: "Breakdown Risk",
    bg: "bg-gradient-to-br from-rose-500/10 via-rose-500/5 to-transparent dark:from-rose-500/15",
    border: "border-rose-500/40",
    iconBg: "bg-rose-500/15 dark:bg-rose-500/20",
    iconColor: "text-rose-600 dark:text-rose-400",
    textColor: "text-rose-700 dark:text-rose-100",
  },
  NO_CLEAR_EDGE: {
    icon: Pause,
    label: "No Clear Edge",
    bg: "bg-gradient-to-br from-zinc-200/60 via-zinc-100/30 to-transparent dark:from-zinc-700/30 dark:via-zinc-800/20",
    border: "border-zinc-300 dark:border-zinc-700/60",
    iconBg: "bg-zinc-200 dark:bg-zinc-700/50",
    iconColor: "text-zinc-600 dark:text-zinc-400",
    textColor: "text-zinc-800 dark:text-zinc-200",
  },
};

// ── Metric labels ──

const MOMENTUM_SHORT: Record<MomentumLabel, string> = {
  STRONG_UP: "Strong Up",
  WEAK_UP: "Weak Up",
  NEUTRAL: "Neutral",
  WEAK_DOWN: "Weak Down",
  STRONG_DOWN: "Strong Down",
};

const PRESSURE_SHORT: Record<PressureLabel, string> = {
  BUY: "Buy",
  NEUTRAL: "Neutral",
  SELL: "Sell",
};

const VOL_SHORT: Record<VolatilityLabel, string> = {
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
  BULLISH: "text-emerald-700 dark:text-emerald-400/80",
  BEARISH: "text-rose-700 dark:text-rose-400/80",
  NEUTRAL: "text-zinc-500 dark:text-zinc-500",
};

// ── Helpers ──

function MomentumIcon({ label }: { label: MomentumLabel }) {
  if (label === "STRONG_UP" || label === "WEAK_UP")
    return <ArrowUp className="size-4 text-emerald-400" />;
  if (label === "STRONG_DOWN" || label === "WEAK_DOWN")
    return <ArrowDown className="size-4 text-rose-400" />;
  return <Minus className="size-4 text-zinc-500" />;
}

// ── Main ──

export function IntelligenceCard({ data }: IntelligenceCardProps) {
  const outlook = OUTLOOK_STYLES[data.outlook];
  const OutlookIcon = outlook.icon;

  const changeTone =
    data.change > 0
      ? "text-emerald-400"
      : data.change < 0
      ? "text-rose-400"
      : "text-zinc-400";

  const confPct = Math.round(Math.max(0, Math.min(1, data.confidence)) * 100);

  // Pressure icon color
  const pressureIconColor =
    data.pressure.label === "BUY"
      ? "text-emerald-400"
      : data.pressure.label === "SELL"
      ? "text-rose-400"
      : "text-zinc-500";

  return (
    <Link
      href={`/stock/${encodeURIComponent(data.symbol)}`}
      className={`group block rounded-2xl border border-zinc-200 dark:border-zinc-800/80 border-l-4 ${ZONE_LEFT_BORDER[data.context.zone]} bg-white dark:bg-zinc-950/60 p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-lg ${ZONE_HOVER_SHADOW[data.context.zone]}`}
    >
      {/* Header: symbol + price */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            {data.symbol}
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
            {ZONE_LABEL[data.context.zone]}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
            ₹{data.price.toFixed(2)}
          </div>
          <div className={`text-xs font-semibold tabular-nums ${changeTone}`}>
            {data.change >= 0 ? "+" : ""}
            {data.change.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Outlook hero */}
      <div
        className={`mt-4 flex items-center gap-3 rounded-xl border-2 ${outlook.border} ${outlook.bg} px-3.5 py-3`}
      >
        <div
          className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${outlook.iconBg}`}
        >
          <OutlookIcon className={`size-5 ${outlook.iconColor}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-bold ${outlook.textColor}`}>
            {outlook.label}
          </div>
          {data.context.level !== null && data.context.distanceToLevel !== null ? (
            <div className="mt-0.5 truncate text-[11px] text-zinc-600 dark:text-zinc-400">
              ₹{data.context.level.toFixed(2)} · {data.context.distanceToLevel.toFixed(2)}% away
            </div>
          ) : (
            <div className="mt-0.5 text-[11px] text-zinc-500">No level within 1%</div>
          )}
        </div>
      </div>

      {/* 3-up metric tiles */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800/70 bg-zinc-50 dark:bg-zinc-900/40 px-2.5 py-2">
          <div className="flex items-center justify-between">
            <MomentumIcon label={data.momentum.label} />
            <span className="text-[11px] font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
              {data.momentum.score.toFixed(2)}
            </span>
          </div>
          <div className="mt-1 truncate text-[10px] uppercase tracking-wide text-zinc-500">
            {MOMENTUM_SHORT[data.momentum.label]}
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800/70 bg-zinc-50 dark:bg-zinc-900/40 px-2.5 py-2">
          <div className="flex items-center justify-between">
            <Gauge className={`size-3.5 ${pressureIconColor}`} />
            <span className="text-[11px] font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
              {data.pressure.score.toFixed(2)}
            </span>
          </div>
          <div className="mt-1 truncate text-[10px] uppercase tracking-wide text-zinc-500">
            {PRESSURE_SHORT[data.pressure.label]}
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800/70 bg-zinc-50 dark:bg-zinc-900/40 px-2.5 py-2">
          <div className="flex items-center justify-between">
            <Zap className="size-3.5 text-amber-500 dark:text-amber-400/80" />
            <span className="text-[11px] font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
              {data.volatility.score.toFixed(2)}
            </span>
          </div>
          <div className="mt-1 truncate text-[10px] uppercase tracking-wide text-zinc-500">
            {VOL_SHORT[data.volatility.label]}
          </div>
        </div>
      </div>

      {/* Confidence — prominent bar */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">
            Confidence
          </span>
          <span className={`text-xs font-bold ${CONFIDENCE_TEXT[data.confidenceLabel]}`}>
            {data.confidenceLabel} · {confPct}%
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800/80">
          <div
            className={`h-full rounded-full ${CONFIDENCE_FILL[data.confidenceLabel]} transition-all duration-500`}
            style={{ width: `${confPct}%` }}
          />
        </div>
      </div>

      {/* Bias footer */}
      <div className="mt-3 flex items-center gap-1.5">
        <span className={`size-1.5 rounded-full ${BIAS_DOT[data.bias]}`} />
        <span className={`text-[11px] ${BIAS_TEXT[data.bias]}`}>
          {BIAS_LABEL[data.bias]}
        </span>
      </div>
    </Link>
  );
}
