"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Flame, Gauge, Target, TrendingDown, TrendingUp, Waves, Zap } from "lucide-react";
import type { VolatileRecentCandle, VolatileStock } from "@/lib/types";

interface VolatileCardProps {
  data: VolatileStock;
}

// Heat tier — drives the violet→orange→red gradient intensity. Both ATR% and
// RVOL get a vote; max tier wins. Tuned so a "1.5%, 1.5×" stock (the floor)
// lands at "warm" and a "3%+, 3×+" stock lands at "hot".
function heatTier(atrPct: number, rvol: number): "warm" | "hot" | "blazing" {
  const score = Math.max(atrPct / 1.5, rvol / 1.5);
  if (score >= 2.2) return "blazing";
  if (score >= 1.5) return "hot";
  return "warm";
}

const TIER_GRADIENT: Record<"warm" | "hot" | "blazing", string> = {
  warm: "from-violet-500/30 via-fuchsia-500/0 to-transparent",
  hot: "from-orange-500/40 via-amber-500/0 to-transparent",
  blazing: "from-rose-500/50 via-orange-500/0 to-transparent",
};

const TIER_BORDER_HOVER: Record<"warm" | "hot" | "blazing", string> = {
  warm: "hover:border-violet-500/40 hover:shadow-violet-500/10",
  hot: "hover:border-orange-500/40 hover:shadow-orange-500/15",
  blazing: "hover:border-rose-500/50 hover:shadow-rose-500/20",
};

const TIER_CHIP: Record<"warm" | "hot" | "blazing", { label: string; cls: string }> = {
  warm: {
    label: "Active",
    cls: "border-violet-400/40 bg-violet-500/[0.08] text-violet-700 dark:text-violet-300",
  },
  hot: {
    label: "Hot",
    cls: "border-orange-400/50 bg-orange-500/[0.10] text-orange-700 dark:text-orange-300",
  },
  blazing: {
    label: "Blazing",
    cls: "border-rose-400/50 bg-rose-500/[0.10] text-rose-700 dark:text-rose-300",
  },
};

// Price-tick flash — green/red for ~1.2s on each price change. Reuses the
// pattern from market-card.tsx so cards animate consistently across screens.
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

export function VolatileCard({ data }: VolatileCardProps) {
  const tier = heatTier(data.atrPct, data.rvol);
  const tierChip = TIER_CHIP[tier];
  const flash = usePriceFlash(data.price);

  const changeUp = data.changePct > 0;
  const changeDown = data.changePct < 0;
  const changeColor = changeUp
    ? "text-emerald-600 dark:text-emerald-400"
    : changeDown
    ? "text-rose-600 dark:text-rose-400"
    : "text-zinc-500";

  const priceColor =
    flash === "up"
      ? "text-emerald-600 dark:text-emerald-400"
      : flash === "down"
      ? "text-rose-600 dark:text-rose-400"
      : "text-zinc-900 dark:text-zinc-50";

  const ChangeIcon = changeUp ? ArrowUp : changeDown ? ArrowDown : null;

  return (
    <Link
      href={`/stock/${encodeURIComponent(data.symbol)}`}
      className={`group relative block overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl ${TIER_BORDER_HOVER[tier]}`}
    >
      {/* Heat-tier gradient top edge */}
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r ${TIER_GRADIENT[tier]}`} />
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b ${TIER_GRADIENT[tier]} opacity-50`} />

      {/* Tier chip — top-right corner */}
      <div className="absolute right-4 top-4">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] ${tierChip.cls}`}
        >
          <Flame className="size-3" strokeWidth={2.8} />
          {tierChip.label}
        </span>
      </div>

      {/* Hero — symbol / price */}
      <div className="relative">
        <div className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          {data.symbol}
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span
            className={`text-2xl font-bold tabular-nums transition-colors duration-700 ${priceColor}`}
            style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)" }}
          >
            ₹{data.price.toFixed(2)}
          </span>
          <span className={`inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums ${changeColor}`}>
            {ChangeIcon && <ChangeIcon className="size-3" strokeWidth={3} />}
            {changeUp ? "+" : ""}{data.changePct.toFixed(2)}%
          </span>
        </div>
      </div>

      {/* Volatility metrics — ATR% + RVOL, side by side */}
      <div className="mt-5 grid grid-cols-2 gap-3">
        <MetricBlock
          Icon={Zap}
          label="ATR"
          value={`${data.atrPct.toFixed(2)}%`}
          accent="amber"
        />
        <MetricBlock
          Icon={Gauge}
          label="RVOL"
          value={`${data.rvol.toFixed(2)}×`}
          accent="violet"
        />
      </div>

      {/* Day range bar */}
      <DayRangeBar
        price={data.price}
        low={data.dayLow}
        high={data.dayHigh}
        position={data.dayRangePosition}
      />

      {/* Distance to nearest level */}
      {data.nearestLevel && (
        <DistanceRow level={data.nearestLevel} priceMoreThanLevel={data.price > data.nearestLevel.price} />
      )}

      {/* Last 3 closed 5-min candles — the meat of the screen */}
      <RecentCandlesList candles={data.recentCandles} />

      {/* Footer — zone, pattern, live pulse */}
      <CardFooter zone={data.zone} pattern={data.pattern} />
    </Link>
  );
}

function MetricBlock({
  Icon,
  label,
  value,
  accent,
}: {
  Icon: typeof Zap;
  label: string;
  value: string;
  accent: "amber" | "violet";
}) {
  const tones =
    accent === "amber"
      ? "border-amber-400/30 bg-amber-500/[0.06] text-amber-600 dark:text-amber-300"
      : "border-violet-400/30 bg-violet-500/[0.06] text-violet-600 dark:text-violet-300";
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-900/30 px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <div className={`flex size-5 items-center justify-center rounded-md border ${tones}`}>
          <Icon className="size-3" strokeWidth={2.6} />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
          {label}
        </span>
      </div>
      <div className="mt-1 text-lg font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
        {value}
      </div>
    </div>
  );
}

function DayRangeBar({
  price,
  low,
  high,
  position,
}: {
  price: number;
  low: number;
  high: number;
  position: number | null;
}) {
  // position is null when range hasn't formed yet (very early session).
  // Fall back to 0.5 visually but tag it as "—" so the user knows the
  // calc isn't meaningful.
  const pct = position === null ? 0.5 : Math.max(0, Math.min(1, position));
  const positionLabel = position === null ? "—" : `${Math.round(pct * 100)}%`;

  return (
    <div className="mt-4">
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
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-violet-400 via-fuchsia-400 to-orange-400"
          style={{ width: `${pct * 100}%` }}
        />
        <span
          className="absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full border-2 border-white bg-zinc-900 shadow dark:border-zinc-950 dark:bg-zinc-100"
          style={{ left: `calc(${pct * 100}% - 5px)` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
        <span>L ₹{low.toFixed(2)}</span>
        <span>H ₹{high.toFixed(2)}</span>
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

// IST clock label for candle close time. Server sends Unix epoch seconds.
function formatCandleTime(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
}

// Compact volume formatter: 124000 → "124K", 1250000 → "1.25M".
function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}

function DistanceRow({
  level,
  priceMoreThanLevel,
}: {
  level: NonNullable<VolatileStock["nearestLevel"]>;
  priceMoreThanLevel: boolean;
}) {
  const isResistance = level.kind === "RESISTANCE";
  const dirArrow = isResistance && !priceMoreThanLevel
    ? "↑"
    : !isResistance && priceMoreThanLevel
    ? "↓"
    : "→";
  const tone = isResistance
    ? "text-rose-700 dark:text-rose-300"
    : "text-emerald-700 dark:text-emerald-300";
  return (
    <div className="mt-3 flex items-center gap-2 text-[12px]">
      <Target className={`size-3.5 shrink-0 ${tone}`} strokeWidth={2.6} />
      <span className="text-zinc-600 dark:text-zinc-300">
        <span className={`font-bold tabular-nums ${tone}`}>{dirArrow} ₹{level.distanceAbs.toFixed(2)}</span>
        <span className="text-zinc-400 dark:text-zinc-500"> ({level.distancePct.toFixed(2)}%) to </span>
        <span className={`font-semibold ${tone}`}>{level.kind === "RESISTANCE" ? "Resistance" : "Support"}</span>
        <span className="ml-1 text-zinc-400 dark:text-zinc-500 tabular-nums">₹{level.price.toFixed(2)}</span>
      </span>
    </div>
  );
}
