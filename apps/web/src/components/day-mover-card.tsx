"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Gauge,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Waves,
} from "lucide-react";
import type { DayMover, VolatileRecentCandle } from "@/lib/types";

interface DayMoverCardProps {
  data: DayMover;
}

// Magnitude tier — drives the intensity of the green/red gradient. Tuned so
// a 3-5% mover sits at "notable", 5-10% at "big", and >10% at "outlier".
function magnitudeTier(absMove: number): "notable" | "big" | "outlier" {
  if (absMove >= 10) return "outlier";
  if (absMove >= 5) return "big";
  return "notable";
}

// Direction × tier → border-hover, gradient, chip styling. Greens for gainers,
// roses for losers.
const TIER_GRADIENT: Record<"up" | "down", Record<"notable" | "big" | "outlier", string>> = {
  up: {
    notable: "from-emerald-500/25 via-emerald-500/0 to-transparent",
    big: "from-emerald-500/40 via-teal-500/0 to-transparent",
    outlier: "from-emerald-500/55 via-lime-500/0 to-transparent",
  },
  down: {
    notable: "from-rose-500/25 via-rose-500/0 to-transparent",
    big: "from-rose-500/40 via-orange-500/0 to-transparent",
    outlier: "from-rose-500/55 via-red-500/0 to-transparent",
  },
};

const TIER_BORDER_HOVER: Record<"up" | "down", string> = {
  up: "hover:border-emerald-500/45 hover:shadow-emerald-500/15",
  down: "hover:border-rose-500/45 hover:shadow-rose-500/15",
};

const DIR_HERO_TONE: Record<"up" | "down", string> = {
  up: "text-emerald-600 dark:text-emerald-300",
  down: "text-rose-600 dark:text-rose-300",
};

const DIR_CHIP: Record<"up" | "down", { label: string; cls: string }> = {
  up: {
    label: "Gainer",
    cls: "border-emerald-400/50 bg-emerald-500/[0.10] text-emerald-700 dark:text-emerald-300",
  },
  down: {
    label: "Loser",
    cls: "border-rose-400/50 bg-rose-500/[0.10] text-rose-700 dark:text-rose-300",
  },
};

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

export function DayMoverCard({ data }: DayMoverCardProps) {
  const tier = magnitudeTier(data.absDayMovePct);
  const direction = data.direction;
  const dirChip = DIR_CHIP[direction];
  const flash = usePriceFlash(data.price);

  const priceColor =
    flash === "up"
      ? "text-emerald-600 dark:text-emerald-400"
      : flash === "down"
      ? "text-rose-600 dark:text-rose-400"
      : "text-zinc-900 dark:text-zinc-50";

  const DirIcon = direction === "up" ? TrendingUp : TrendingDown;
  const movePrefix = data.dayMovePct >= 0 ? "+" : "";

  return (
    <Link
      href={`/stock/${encodeURIComponent(data.symbol)}`}
      className={`group relative block overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl ${TIER_BORDER_HOVER[direction]}`}
    >
      {/* Direction × tier gradient top edge */}
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r ${TIER_GRADIENT[direction][tier]}`} />
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b ${TIER_GRADIENT[direction][tier]} opacity-60`} />

      {/* Tier chip */}
      <div className="absolute right-4 top-4">
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] ${dirChip.cls}`}>
          {tier === "outlier" && <Sparkles className="size-3" strokeWidth={2.8} />}
          <DirIcon className="size-3" strokeWidth={2.8} />
          {dirChip.label}
        </span>
      </div>

      {/* Symbol */}
      <div className="relative">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {data.displayName ?? data.symbol}
          </span>
          {data.displayName && <FutChip />}
        </div>
      </div>

      {/* HERO — the big signed Day Move % */}
      <div className="relative mt-3">
        <div className={`flex items-baseline gap-2 ${DIR_HERO_TONE[direction]}`}>
          <DirIcon className="size-7 shrink-0" strokeWidth={2.6} />
          <span
            className="text-4xl font-black tabular-nums leading-none"
            style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)" }}
          >
            {movePrefix}{data.dayMovePct.toFixed(2)}%
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span
            className={`text-xl font-bold tabular-nums transition-colors duration-700 ${priceColor}`}
            style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)" }}
          >
            ₹{data.price.toFixed(2)}
          </span>
          <span className="text-[11px] font-semibold tabular-nums text-zinc-400 dark:text-zinc-500">
            from ₹{data.dayOpen.toFixed(2)} open
          </span>
        </div>
      </div>

      {/* Day H / L distances + RVOL — single compact row */}
      <DistancesRow
        dayHigh={data.dayHigh}
        dayLow={data.dayLow}
        distHighAbs={data.distanceFromHighAbs}
        distHighPct={data.distanceFromHighPct}
        distLowAbs={data.distanceFromLowAbs}
        distLowPct={data.distanceFromLowPct}
      />

      {/* RVOL + day range bar */}
      <div className="mt-4 grid grid-cols-[auto_1fr] items-center gap-3">
        <RvolPill rvol={data.rvol} />
        <DayRangeBar
          low={data.dayLow}
          high={data.dayHigh}
          position={data.dayRangePosition}
          direction={direction}
        />
      </div>

      {/* Last 3 closed candles */}
      <RecentCandlesList candles={data.recentCandles} />

      {/* Footer */}
      <CardFooter zone={data.zone} pattern={data.pattern} />
    </Link>
  );
}

// Index-future visual differentiator. Rendered only when displayName is set.
function FutChip() {
  return (
    <span className="shrink-0 inline-flex items-center rounded-md border border-amber-400/40 bg-amber-500/[0.10] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">
      Fut
    </span>
  );
}

function DistancesRow({
  dayHigh,
  dayLow,
  distHighAbs,
  distHighPct,
  distLowAbs,
  distLowPct,
}: {
  dayHigh: number;
  dayLow: number;
  distHighAbs: number;
  distHighPct: number;
  distLowAbs: number;
  distLowPct: number;
}) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-2">
      <DistanceTile
        Icon={ArrowUpToLine}
        label="High"
        levelPrice={dayHigh}
        distAbs={distHighAbs}
        distPct={distHighPct}
        accent="rose"
      />
      <DistanceTile
        Icon={ArrowDownToLine}
        label="Low"
        levelPrice={dayLow}
        distAbs={distLowAbs}
        distPct={distLowPct}
        accent="emerald"
      />
    </div>
  );
}

function DistanceTile({
  Icon,
  label,
  levelPrice,
  distAbs,
  distPct,
  accent,
}: {
  Icon: typeof ArrowUpToLine;
  label: string;
  levelPrice: number;
  distAbs: number;
  distPct: number;
  accent: "rose" | "emerald";
}) {
  const tones =
    accent === "rose"
      ? "border-rose-400/30 bg-rose-500/[0.06] text-rose-600 dark:text-rose-300"
      : "border-emerald-400/30 bg-emerald-500/[0.06] text-emerald-600 dark:text-emerald-300";
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-900/30 px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <div className={`flex size-5 items-center justify-center rounded-md border ${tones}`}>
          <Icon className="size-3" strokeWidth={2.6} />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
          {label}
        </span>
        <span className="ml-auto text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
          ₹{levelPrice.toFixed(2)}
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
          ₹{distAbs.toFixed(2)}
        </span>
        <span className="text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
          ({distPct.toFixed(2)}%)
        </span>
      </div>
    </div>
  );
}

function RvolPill({ rvol }: { rvol: number }) {
  const tone =
    rvol >= 2.5
      ? "border-violet-400/40 bg-violet-500/[0.10] text-violet-700 dark:text-violet-300"
      : "border-zinc-300 dark:border-zinc-700 bg-zinc-100/60 dark:bg-zinc-800/60 text-zinc-700 dark:text-zinc-200";
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-bold ${tone}`}>
      <Gauge className="size-3" strokeWidth={2.6} />
      <span className="tabular-nums">{rvol.toFixed(2)}×</span>
      <span className="ml-0.5 text-[9px] uppercase tracking-[0.18em] opacity-70">RVOL</span>
    </span>
  );
}

function DayRangeBar({
  low,
  high,
  position,
  direction,
}: {
  low: number;
  high: number;
  position: number | null;
  direction: "up" | "down";
}) {
  const pct = position === null ? 0.5 : Math.max(0, Math.min(1, position));
  const positionLabel = position === null ? "—" : `${Math.round(pct * 100)}%`;
  const fillGradient =
    direction === "up"
      ? "bg-gradient-to-r from-emerald-300 via-emerald-400 to-emerald-500"
      : "bg-gradient-to-r from-rose-500 via-rose-400 to-rose-300";

  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
        <span className="inline-flex items-center gap-1.5">
          <Waves className="size-3" strokeWidth={2.6} />
          Day range
        </span>
        <span className="font-bold text-zinc-700 dark:text-zinc-200 normal-case tracking-normal tabular-nums">
          {positionLabel}
        </span>
      </div>
      <div className="relative mt-1.5 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800/80 overflow-hidden">
        <div className={`absolute inset-y-0 left-0 ${fillGradient}`} style={{ width: `${pct * 100}%` }} />
        <span
          className="absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full border-2 border-white bg-zinc-900 shadow dark:border-zinc-950 dark:bg-zinc-100"
          style={{ left: `calc(${pct * 100}% - 5px)` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[9px] tabular-nums text-zinc-500 dark:text-zinc-400">
        <span>₹{low.toFixed(2)}</span>
        <span>₹{high.toFixed(2)}</span>
      </div>
    </div>
  );
}

function RecentCandlesList({ candles }: { candles: VolatileRecentCandle[] }) {
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
          Last 3 × 5m candles
        </span>
        <span className="text-[9px] uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
          newest first
        </span>
      </div>
      {candles.length === 0 ? (
        <EmptyCandlesRow />
      ) : (
        <div className="space-y-1.5">
          {candles.map((c, i) => (
            <CandleRow key={`${c.time}-${i}`} candle={c} isNewest={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}

function CandleRow({ candle, isNewest }: { candle: VolatileRecentCandle; isNewest: boolean }) {
  const isUp = candle.direction === "up";
  const isDown = candle.direction === "down";
  const dirIconTone = isUp
    ? "text-emerald-500 dark:text-emerald-400"
    : isDown
    ? "text-rose-500 dark:text-rose-400"
    : "text-zinc-400 dark:text-zinc-500";
  const dirFill = isUp
    ? "bg-emerald-500/15 ring-emerald-500/25"
    : isDown
    ? "bg-rose-500/15 ring-rose-500/25"
    : "bg-zinc-400/15 ring-zinc-400/25";
  const DirIcon = isUp ? TrendingUp : isDown ? TrendingDown : Waves;

  const multi = candle.volMultiplier;
  const multiTone =
    multi === null
      ? "text-zinc-400"
      : multi >= 1.5
      ? "text-emerald-600 dark:text-emerald-400"
      : multi < 0.8
      ? "text-zinc-400 dark:text-zinc-500"
      : "text-zinc-600 dark:text-zinc-300";

  return (
    <div
      className={`grid grid-cols-[44px_28px_1fr_72px] items-center gap-2 rounded-lg px-2 py-1.5 ${
        isNewest
          ? "bg-zinc-50 dark:bg-zinc-900/60 ring-1 ring-zinc-200/80 dark:ring-zinc-800/80"
          : ""
      }`}
    >
      <span className="text-[10px] font-semibold tabular-nums text-zinc-500 dark:text-zinc-400">
        {formatCandleTime(candle.time)}
      </span>
      <span className={`flex size-5 items-center justify-center rounded-md ring-1 ${dirFill}`}>
        <DirIcon className={`size-3 ${dirIconTone}`} strokeWidth={2.8} />
      </span>
      <span className="text-[12px] font-bold tabular-nums text-zinc-800 dark:text-zinc-100">
        {formatVolume(candle.volume)}
      </span>
      <span className={`text-right text-[11px] font-semibold tabular-nums ${multiTone}`}>
        {multi === null ? "—" : `${multi.toFixed(1)}× avg`}
      </span>
    </div>
  );
}

function EmptyCandlesRow() {
  return (
    <div className="rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800/80 px-3 py-3 text-center text-[11px] text-zinc-400 dark:text-zinc-500">
      No closed candles yet
    </div>
  );
}

const ZONE_FOOTER_TONE: Record<string, string> = {
  NEAR_SUPPORT: "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 ring-emerald-500/25",
  NEAR_RESISTANCE: "text-rose-700 dark:text-rose-300 bg-rose-500/10 ring-rose-500/25",
  MID_RANGE: "text-zinc-600 dark:text-zinc-400 bg-zinc-500/10 ring-zinc-400/20",
};

const ZONE_FOOTER_LABEL: Record<string, string> = {
  NEAR_SUPPORT: "Near support",
  NEAR_RESISTANCE: "Near resistance",
  MID_RANGE: "Mid range",
};

function CardFooter({ zone, pattern }: { zone: string; pattern: string | null }) {
  return (
    <div className="mt-4 flex items-center gap-2 border-t border-zinc-200 dark:border-zinc-800/80 pt-3">
      <span
        className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] ring-1 ${
          ZONE_FOOTER_TONE[zone] ?? ZONE_FOOTER_TONE.MID_RANGE
        }`}
      >
        {ZONE_FOOTER_LABEL[zone] ?? zone}
      </span>
      {pattern && (
        <span className="inline-flex items-center rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/25">
          {pattern}
        </span>
      )}
      <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/[0.08] px-2 py-0.5">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
        </span>
        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-300">
          Live
        </span>
      </span>
    </div>
  );
}

function formatCandleTime(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}
