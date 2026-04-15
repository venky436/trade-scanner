"use client";

import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Landmark,
  Minus,
  TrendingUp,
  Waves,
} from "lucide-react";
import type { IndexDirection, MarketContext } from "@/lib/types";

interface MarketContextBannerProps {
  market: MarketContext | null;
}

function DirectionIcon({ direction }: { direction: IndexDirection }) {
  if (direction === "UP")
    return <ArrowUp className="size-3.5 text-emerald-600 dark:text-emerald-400" />;
  if (direction === "DOWN")
    return <ArrowDown className="size-3.5 text-rose-600 dark:text-rose-400" />;
  return <Minus className="size-3.5 text-zinc-500" />;
}

function IndexPill({
  name,
  Icon,
  direction,
  changePercent,
}: {
  name: string;
  Icon: LucideIcon;
  direction: IndexDirection;
  changePercent: number;
}) {
  const tone =
    direction === "UP"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/8 dark:text-emerald-300"
      : direction === "DOWN"
      ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:bg-rose-500/8 dark:text-rose-300"
      : "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700/60 dark:bg-zinc-800/40 dark:text-zinc-300";

  return (
    <div
      className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium ${tone}`}
    >
      <Icon className="size-3.5 opacity-80" />
      <span>{name}</span>
      <DirectionIcon direction={direction} />
      <span className="tabular-nums font-semibold">
        {changePercent >= 0 ? "+" : ""}
        {changePercent.toFixed(2)}%
      </span>
    </div>
  );
}

export function MarketContextBanner({ market }: MarketContextBannerProps) {
  if (!market) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-900/40 px-5 py-4 text-xs text-zinc-500">
        <span className="size-1.5 animate-pulse rounded-full bg-zinc-400 dark:bg-zinc-600" />
        Waiting for market data…
      </div>
    );
  }

  const isTrending = market.condition === "TRENDING";
  const ConditionIcon = isTrending ? Activity : Waves;
  const conditionTone = isTrending
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/8 dark:text-emerald-300"
    : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:bg-amber-500/5 dark:text-amber-300";

  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-900/40 px-5 py-4">
      <div
        className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold ${conditionTone}`}
      >
        <ConditionIcon className="size-3.5" />
        <span className="text-[10px] uppercase tracking-wider opacity-70">
          Market
        </span>
        <span>{isTrending ? "Trending" : "Sideways"}</span>
      </div>
      <IndexPill
        name="NIFTY"
        Icon={TrendingUp}
        direction={market.nifty.direction}
        changePercent={market.nifty.changePercent}
      />
      <IndexPill
        name="BANKNIFTY"
        Icon={Landmark}
        direction={market.bankNifty.direction}
        changePercent={market.bankNifty.changePercent}
      />
    </div>
  );
}
