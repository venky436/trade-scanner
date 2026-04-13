"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Flame,
  Pause,
  TrendingDown,
} from "lucide-react";
import type {
  ConfidenceLabel,
  IntelligenceSnapshot,
  Outlook,
  Zone,
} from "@/lib/types";

interface TopOpportunityCardProps {
  data: IntelligenceSnapshot;
}

// ── Zone (left accent stripe) ──

const ZONE_LEFT_BORDER: Record<Zone, string> = {
  NEAR_RESISTANCE: "border-l-rose-500/70",
  NEAR_SUPPORT: "border-l-emerald-500/70",
  MID_RANGE: "border-l-zinc-300 dark:border-l-zinc-700",
};

const ZONE_LABEL: Record<Zone, string> = {
  NEAR_RESISTANCE: "Near Resistance",
  NEAR_SUPPORT: "Near Support",
  MID_RANGE: "Mid Range",
};

// ── Outlook hero (big, dominant) ──

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
    bg: "bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent dark:from-emerald-500/20 dark:via-emerald-500/8",
    border: "border-emerald-500/40",
    iconBg: "bg-emerald-500/15 dark:bg-emerald-500/25",
    iconColor: "text-emerald-600 dark:text-emerald-300",
    textColor: "text-emerald-700 dark:text-emerald-100",
  },
  BOUNCE_EXPECTED: {
    icon: ArrowUpRight,
    label: "Bounce Expected",
    bg: "bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent dark:from-emerald-500/20 dark:via-emerald-500/8",
    border: "border-emerald-500/40",
    iconBg: "bg-emerald-500/15 dark:bg-emerald-500/25",
    iconColor: "text-emerald-600 dark:text-emerald-300",
    textColor: "text-emerald-700 dark:text-emerald-100",
  },
  REJECTION_POSSIBLE: {
    icon: ArrowDownRight,
    label: "Rejection Possible",
    bg: "bg-gradient-to-br from-rose-500/10 via-rose-500/5 to-transparent dark:from-rose-500/20 dark:via-rose-500/8",
    border: "border-rose-500/40",
    iconBg: "bg-rose-500/15 dark:bg-rose-500/25",
    iconColor: "text-rose-600 dark:text-rose-300",
    textColor: "text-rose-700 dark:text-rose-100",
  },
  BREAKDOWN_RISK: {
    icon: TrendingDown,
    label: "Breakdown Risk",
    bg: "bg-gradient-to-br from-rose-500/10 via-rose-500/5 to-transparent dark:from-rose-500/20 dark:via-rose-500/8",
    border: "border-rose-500/40",
    iconBg: "bg-rose-500/15 dark:bg-rose-500/25",
    iconColor: "text-rose-600 dark:text-rose-300",
    textColor: "text-rose-700 dark:text-rose-100",
  },
  NO_CLEAR_EDGE: {
    icon: Pause,
    label: "No Clear Edge",
    bg: "bg-gradient-to-br from-zinc-200/60 via-zinc-100/30 to-transparent dark:from-zinc-700/30 dark:via-zinc-800/20",
    border: "border-zinc-300 dark:border-zinc-700/60",
    iconBg: "bg-zinc-200 dark:bg-zinc-700/50",
    iconColor: "text-zinc-600 dark:text-zinc-300",
    textColor: "text-zinc-800 dark:text-zinc-100",
  },
};

// Outer card ring — signals "this is a top pick" at a glance
const HIGHLIGHT_RING: Record<Outlook, string> = {
  BREAKOUT_LIKELY: "ring-2 ring-emerald-500/30 dark:ring-emerald-500/40",
  BOUNCE_EXPECTED: "ring-2 ring-emerald-500/30 dark:ring-emerald-500/40",
  REJECTION_POSSIBLE: "ring-2 ring-rose-500/30 dark:ring-rose-500/40",
  BREAKDOWN_RISK: "ring-2 ring-rose-500/30 dark:ring-rose-500/40",
  NO_CLEAR_EDGE: "ring-2 ring-zinc-300 dark:ring-zinc-700",
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

// ── Main ──

export function TopOpportunityCard({ data }: TopOpportunityCardProps) {
  const outlook = OUTLOOK_STYLES[data.outlook];
  const OutlookIcon = outlook.icon;

  const changeTone =
    data.change > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : data.change < 0
      ? "text-rose-600 dark:text-rose-400"
      : "text-zinc-500 dark:text-zinc-400";

  const confPct = Math.round(Math.max(0, Math.min(1, data.confidence)) * 100);

  return (
    <Link
      href={`/stock/${encodeURIComponent(data.symbol)}`}
      className={`group block rounded-2xl border border-zinc-200 dark:border-zinc-800/80 border-l-4 ${ZONE_LEFT_BORDER[data.context.zone]} bg-white dark:bg-zinc-950/60 p-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg ${HIGHLIGHT_RING[data.outlook]}`}
    >
      {/* Header: symbol + zone label + price */}
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

      {/* Outlook hero — big, dominant */}
      <div
        className={`mt-4 flex items-center gap-3.5 rounded-xl border-2 ${outlook.border} ${outlook.bg} px-4 py-4`}
      >
        <div
          className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${outlook.iconBg}`}
        >
          <OutlookIcon className={`size-6 ${outlook.iconColor}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className={`text-lg font-bold leading-tight ${outlook.textColor}`}>
            {outlook.label}
          </div>
          {data.context.level !== null && data.context.distanceToLevel !== null ? (
            <div className="mt-1 truncate text-xs text-zinc-600 dark:text-zinc-400">
              ₹{data.context.level.toFixed(2)} · {data.context.distanceToLevel.toFixed(2)}% away
            </div>
          ) : (
            <div className="mt-1 text-xs text-zinc-500">No level within 1%</div>
          )}
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
    </Link>
  );
}
