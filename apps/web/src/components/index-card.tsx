"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { IntelligenceSnapshot } from "@/lib/types";

type Accent = "blue" | "purple" | "amber";

interface IndexCardProps {
  /** Display name shown to user (e.g. "BANKNIFTY") */
  name: string;
  /** Symbol used in stockMap and the /stock/[symbol] route (e.g. "NIFTY BANK") */
  symbol: string;
  data: IntelligenceSnapshot | undefined;
  accent: Accent;
  Icon: LucideIcon;
}

const ACCENT_STYLES: Record<
  Accent,
  {
    gradient: string;
    border: string;
    hoverBorder: string;
    hoverShadow: string;
    iconBg: string;
    iconColor: string;
  }
> = {
  blue: {
    gradient:
      "from-blue-500/10 via-white to-white dark:from-blue-500/10 dark:via-zinc-900/60 dark:to-zinc-900/80",
    border: "border-blue-500/30 dark:border-blue-500/20",
    hoverBorder: "hover:border-blue-500/60 dark:hover:border-blue-500/50",
    hoverShadow: "hover:shadow-blue-500/10",
    iconBg: "bg-blue-500/15",
    iconColor: "text-blue-600 dark:text-blue-400",
  },
  purple: {
    gradient:
      "from-purple-500/10 via-white to-white dark:from-purple-500/10 dark:via-zinc-900/60 dark:to-zinc-900/80",
    border: "border-purple-500/30 dark:border-purple-500/20",
    hoverBorder: "hover:border-purple-500/60 dark:hover:border-purple-500/50",
    hoverShadow: "hover:shadow-purple-500/10",
    iconBg: "bg-purple-500/15",
    iconColor: "text-purple-600 dark:text-purple-400",
  },
  amber: {
    gradient:
      "from-amber-500/10 via-white to-white dark:from-amber-500/10 dark:via-zinc-900/60 dark:to-zinc-900/80",
    border: "border-amber-500/30 dark:border-amber-500/20",
    hoverBorder: "hover:border-amber-500/60 dark:hover:border-amber-500/50",
    hoverShadow: "hover:shadow-amber-500/10",
    iconBg: "bg-amber-500/15",
    iconColor: "text-amber-600 dark:text-amber-400",
  },
};

export function IndexCard({ name, symbol, data, accent, Icon }: IndexCardProps) {
  const styles = ACCENT_STYLES[accent];
  const price = data?.price ?? 0;
  const change = data?.change ?? 0;
  const positive = change > 0;
  const negative = change < 0;

  const ChangeIcon = positive ? ArrowUp : negative ? ArrowDown : Minus;
  const changeColor = positive
    ? "text-emerald-600 dark:text-emerald-400"
    : negative
    ? "text-rose-600 dark:text-rose-400"
    : "text-zinc-500";
  const changeBg = positive
    ? "bg-emerald-500/10 ring-emerald-500/20"
    : negative
    ? "bg-rose-500/10 ring-rose-500/20"
    : "bg-zinc-200/60 ring-zinc-300/60 dark:bg-zinc-800/60 dark:ring-zinc-700/40";

  return (
    <Link
      href={`/stock/${encodeURIComponent(symbol)}`}
      className={`group relative block overflow-hidden rounded-2xl border ${styles.border} ${styles.hoverBorder} bg-gradient-to-br ${styles.gradient} p-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg ${styles.hoverShadow}`}
    >
      {/* Top: icon + name */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`flex size-11 items-center justify-center rounded-xl ${styles.iconBg} ring-1 ring-zinc-200/60 dark:ring-white/5`}
          >
            <Icon className={`size-5 ${styles.iconColor}`} />
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              {name}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
              Index
            </div>
          </div>
        </div>
        {data && (
          <div className="size-2 animate-pulse rounded-full bg-emerald-500 dark:bg-emerald-400/60" />
        )}
      </div>

      {/* Price */}
      <div className="mt-5">
        {data ? (
          <div className="text-3xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
            {price.toLocaleString("en-IN", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
        ) : (
          <div className="h-8 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800/60" />
        )}
      </div>

      {/* Change chip */}
      <div className="mt-2 flex items-center gap-2">
        <div
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${changeBg} ${changeColor}`}
        >
          <ChangeIcon className="size-3" />
          <span className="tabular-nums">
            {positive ? "+" : ""}
            {change.toFixed(2)}%
          </span>
        </div>
        {data && data.change !== -100 && (
          <span className={`text-xs tabular-nums ${changeColor} opacity-70`}>
            {positive ? "+" : ""}
            {((price * change) / (100 + change)).toFixed(2)}
          </span>
        )}
      </div>

      {/* Subtle backdrop glow */}
      <div
        className={`pointer-events-none absolute -bottom-12 -right-12 size-32 rounded-full blur-3xl ${styles.iconBg} opacity-40 transition-opacity group-hover:opacity-60`}
      />
    </Link>
  );
}
