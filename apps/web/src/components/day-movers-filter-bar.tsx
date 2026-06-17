"use client";

import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowUpDown,
  Compass,
  Flame,
  Gauge,
  IndianRupee,
  Layers,
  SortDesc,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type { DayMoverDirectionFilter, DayMoverSortKey } from "@/lib/types";

// Reuses the same price-band buckets as the Volatile filter for muscle-memory.
interface PriceBucket {
  id: string;
  label: string;
  min: number | null;
  max: number | null;
}

const PRICE_BUCKETS: ReadonlyArray<PriceBucket> = [
  { id: "all", label: "All", min: null, max: null },
  { id: "lt250", label: "<₹250", min: null, max: 250 },
  { id: "250_500", label: "₹250–500", min: 250, max: 500 },
  { id: "500_1000", label: "₹500–1K", min: 500, max: 1000 },
  { id: "1000_2500", label: "₹1K–2.5K", min: 1000, max: 2500 },
  { id: "gt2500", label: ">₹2.5K", min: 2500, max: null },
];

const DIRECTION_OPTIONS: ReadonlyArray<{
  id: DayMoverDirectionFilter;
  label: string;
  Icon: LucideIcon;
}> = [
  { id: "all", label: "All", Icon: Layers },
  { id: "gainers", label: "Gainers", Icon: TrendingUp },
  { id: "losers", label: "Losers", Icon: TrendingDown },
];

const SORT_OPTIONS: ReadonlyArray<{
  id: DayMoverSortKey;
  label: string;
  Icon: LucideIcon;
}> = [
  { id: "absDayMove", label: "|Day Move|", Icon: ArrowUpDown },
  { id: "signedDayMove", label: "Day Move", Icon: TrendingUp },
  { id: "rvol", label: "RVOL", Icon: Gauge },
  { id: "lastCandleVolSpike", label: "Vol Spike", Icon: Flame },
];

interface DayMoversFilterBarProps {
  direction: DayMoverDirectionFilter;
  priceMin: number | null;
  priceMax: number | null;
  sortBy: DayMoverSortKey;
  onDirectionChange: (d: DayMoverDirectionFilter) => void;
  onPriceBandChange: (min: number | null, max: number | null) => void;
  onSortChange: (s: DayMoverSortKey) => void;
  matchedCount?: number;
  poolSize?: number;
  gainersCount?: number;
  losersCount?: number;
}

function isActivePriceBucket(
  bucket: PriceBucket,
  priceMin: number | null,
  priceMax: number | null,
): boolean {
  return bucket.min === priceMin && bucket.max === priceMax;
}

export function DayMoversFilterBar({
  direction,
  priceMin,
  priceMax,
  sortBy,
  onDirectionChange,
  onPriceBandChange,
  onSortChange,
  matchedCount,
  poolSize,
  gainersCount,
  losersCount,
}: DayMoversFilterBarProps) {
  return (
    <div className="space-y-3">
      {/* Direction row */}
      <FilterRow Icon={Compass} label="Direction">
        <ChipGroup>
          {DIRECTION_OPTIONS.map((o) => (
            <Chip
              key={o.id}
              active={o.id === direction}
              onClick={() => onDirectionChange(o.id)}
              Icon={o.Icon}
            >
              {o.label}
              {o.id === "gainers" && typeof gainersCount === "number" && (
                <CountBadge count={gainersCount} tone="emerald" />
              )}
              {o.id === "losers" && typeof losersCount === "number" && (
                <CountBadge count={losersCount} tone="rose" />
              )}
            </Chip>
          ))}
        </ChipGroup>
      </FilterRow>

      {/* Price band row */}
      <FilterRow Icon={IndianRupee} label="Price band">
        <ChipGroup>
          {PRICE_BUCKETS.map((b) => {
            const active = isActivePriceBucket(b, priceMin, priceMax);
            return (
              <Chip
                key={b.id}
                active={active}
                onClick={() => onPriceBandChange(b.min, b.max)}
              >
                {b.label}
              </Chip>
            );
          })}
        </ChipGroup>
      </FilterRow>

      {/* Sort row */}
      <FilterRow Icon={SortDesc} label="Sort by">
        <ChipGroup>
          {SORT_OPTIONS.map((o) => (
            <Chip
              key={o.id}
              active={o.id === sortBy}
              onClick={() => onSortChange(o.id)}
              Icon={o.Icon}
            >
              {o.label}
            </Chip>
          ))}
        </ChipGroup>
        {typeof matchedCount === "number" && typeof poolSize === "number" && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400 tabular-nums">
            <Activity className="size-3" strokeWidth={2.6} />
            {matchedCount} of {poolSize}
          </span>
        )}
      </FilterRow>
    </div>
  );
}

function FilterRow({
  Icon,
  label,
  children,
}: {
  Icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
        <Icon className="size-3" strokeWidth={2.6} />
        {label}
      </span>
      {children}
    </div>
  );
}

function ChipGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800/80 dark:bg-zinc-900/40">
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
  Icon,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  Icon?: LucideIcon;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
        active
          ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
          : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
      }`}
    >
      {Icon && <Icon className="size-3.5" strokeWidth={2.4} />}
      {children}
    </button>
  );
}

function CountBadge({ count, tone }: { count: number; tone: "emerald" | "rose" }) {
  const cls =
    tone === "emerald"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : "bg-rose-500/15 text-rose-700 dark:text-rose-300";
  return (
    <span className={`ml-0.5 inline-flex items-center justify-center min-w-[18px] rounded px-1 py-0.5 text-[9px] font-bold tabular-nums ${cls}`}>
      {count}
    </span>
  );
}
