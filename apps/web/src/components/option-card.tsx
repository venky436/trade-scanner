"use client";

import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowDown,
  ArrowDownRight,
  ArrowUp,
  ArrowUpRight,
  Flame,
  Layers,
  Pause,
  PhoneCall,
  PhoneOff,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type { ConfidenceLabel, IntelligenceSnapshot, Outlook } from "@/lib/types";
import {
  STRIKE_SPACING,
  getATMStrikes,
  toOptionInsight,
  type OptionBias,
  type Strike,
} from "@/lib/option-insight";

interface OptionCardProps {
  /** Display name shown to user (e.g. "NIFTY") */
  displayName: string;
  /** Symbol used to look up intelligence in stockMap (e.g. "NIFTY 50") */
  indexSymbol: string;
  /** Live intelligence for the underlying index (may be undefined while loading) */
  data: IntelligenceSnapshot | undefined;
  /** Optional add-to-watchlist control rendered in the header */
  watchButton?: React.ReactNode;
}

// ── Outlook hero styling (light + dark) ──

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

// ── Option Insight hero (the new primary section) ──

interface BiasStyle {
  icon: LucideIcon;
  label: string;
  bg: string;
  border: string;
  iconBg: string;
  iconColor: string;
  textColor: string;
}

const BIAS_STYLES: Record<OptionBias, BiasStyle> = {
  CALL: {
    icon: PhoneCall,
    label: "CALL side stronger",
    bg: "bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent dark:from-emerald-500/20",
    border: "border-emerald-500/50",
    iconBg: "bg-emerald-500/20 dark:bg-emerald-500/25",
    iconColor: "text-emerald-600 dark:text-emerald-300",
    textColor: "text-emerald-700 dark:text-emerald-100",
  },
  PUT: {
    icon: PhoneOff,
    label: "PUT side stronger",
    bg: "bg-gradient-to-br from-rose-500/15 via-rose-500/5 to-transparent dark:from-rose-500/20",
    border: "border-rose-500/50",
    iconBg: "bg-rose-500/20 dark:bg-rose-500/25",
    iconColor: "text-rose-600 dark:text-rose-300",
    textColor: "text-rose-700 dark:text-rose-100",
  },
  NEUTRAL: {
    icon: Pause,
    label: "No clear edge",
    bg: "bg-gradient-to-br from-zinc-200/60 via-zinc-100/30 to-transparent dark:from-zinc-700/30 dark:via-zinc-800/20",
    border: "border-zinc-300 dark:border-zinc-700/60",
    iconBg: "bg-zinc-200 dark:bg-zinc-700/50",
    iconColor: "text-zinc-600 dark:text-zinc-300",
    textColor: "text-zinc-800 dark:text-zinc-100",
  },
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

// ── Helpers ──

function StrikeChip({ strike, bias }: { strike: Strike; bias: OptionBias }) {
  // Highlight the side that matches the bias (CALL side highlights CE chips, etc.)
  const isHighlighted =
    (bias === "CALL" && strike.side === "CE") ||
    (bias === "PUT" && strike.side === "PE");

  const tone = isHighlighted
    ? strike.side === "CE"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
    : "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800/70 dark:bg-zinc-900/40 dark:text-zinc-400";

  return (
    <div
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold tabular-nums ${tone}`}
    >
      <span>{strike.price.toLocaleString("en-IN")}</span>
      <span className="opacity-70">{strike.side}</span>
      {strike.isAtm && (
        <span className="ml-0.5 text-[9px] uppercase tracking-wider opacity-60">
          ATM
        </span>
      )}
    </div>
  );
}

// ── Main ──

export function OptionCard({ displayName, indexSymbol, data, watchButton }: OptionCardProps) {
  // Loading state
  if (!data) {
    return (
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-6">
        <div className="flex items-center gap-3">
          <div className="size-10 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800/60" />
          <div>
            <div className="h-4 w-24 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/60" />
            <div className="mt-1 h-3 w-16 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/60" />
          </div>
        </div>
        <div className="mt-6 h-20 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800/40" />
        <div className="mt-3 h-20 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800/40" />
      </div>
    );
  }

  const insight = toOptionInsight(data);
  const biasStyle = BIAS_STYLES[insight.bias];
  const BiasIcon = biasStyle.icon;

  const outlook = OUTLOOK_STYLES[data.outlook];
  const OutlookIcon = outlook.icon;

  const spacing = STRIKE_SPACING[indexSymbol] ?? 50;
  const strikes = getATMStrikes(data.price, spacing);

  const changePositive = data.change >= 0;
  const changeColor = changePositive
    ? "text-emerald-600 dark:text-emerald-400"
    : data.change < 0
    ? "text-rose-600 dark:text-rose-400"
    : "text-zinc-500";
  const ChangeIcon = changePositive ? ArrowUp : ArrowDown;

  const confPct = Math.round(Math.max(0, Math.min(1, data.confidence)) * 100);

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-zinc-100 ring-1 ring-zinc-200 dark:bg-zinc-900/60 dark:ring-zinc-800/80">
            <TrendingUp className="size-5 text-zinc-600 dark:text-zinc-400" />
          </div>
          <div>
            <div className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              {displayName}
            </div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
              Index Options
            </div>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <div className="text-right">
            <div className="text-xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
              {data.price.toLocaleString("en-IN", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
            <div
              className={`mt-0.5 inline-flex items-center gap-1 text-xs font-semibold tabular-nums ${changeColor}`}
            >
              <ChangeIcon className="size-3" />
              {changePositive ? "+" : ""}
              {data.change.toFixed(2)}%
            </div>
          </div>
          {watchButton}
        </div>
      </div>

      {/* Outlook context (smaller, secondary) */}
      <div
        className={`mt-4 flex items-center gap-3 rounded-xl border ${outlook.border} ${outlook.bg} px-3 py-2`}
      >
        <div
          className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${outlook.iconBg}`}
        >
          <OutlookIcon className={`size-4 ${outlook.iconColor}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">
            Index outlook
          </div>
          <div className={`text-xs font-semibold ${outlook.textColor}`}>{outlook.label}</div>
        </div>
      </div>

      {/* Option Insight — PRIMARY hero */}
      <div
        className={`mt-3 rounded-xl border-2 ${biasStyle.border} ${biasStyle.bg} p-4`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${biasStyle.iconBg}`}
          >
            <BiasIcon className={`size-5 ${biasStyle.iconColor}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
              Option Insight
            </div>
            <div className={`text-base font-bold ${biasStyle.textColor}`}>{biasStyle.label}</div>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
              {insight.reasoning}
            </p>
          </div>
        </div>
      </div>

      {/* Strike chips */}
      {strikes.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-1.5">
            <Layers className="size-3 text-zinc-500" />
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">
              Strikes near the money
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {strikes.map((s) => (
              <StrikeChip key={`${s.price}-${s.side}`} strike={s} bias={insight.bias} />
            ))}
          </div>
        </div>
      )}

      {/* Confidence */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Activity className="size-3 text-zinc-500" />
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">
              Confidence
            </span>
          </div>
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
    </div>
  );
}
