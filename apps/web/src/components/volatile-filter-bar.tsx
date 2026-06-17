"use client";

import type { LucideIcon } from "lucide-react";
import { Activity, ArrowLeftRight, Flame, Gauge, IndianRupee, SortDesc, Zap } from "lucide-react";
import type { VolatileSortKey } from "@/lib/types";

// Price-range preset buckets, optimised for one-tap scanning during live
// trading. min/max are inclusive; null = open-ended.
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

const SORT_OPTIONS: ReadonlyArray<{
  id: VolatileSortKey;
  label: string;
  Icon: LucideIcon;
}> = [
  { id: "atrPct", label: "ATR%", Icon: Zap },
  { id: "rvol", label: "RVOL", Icon: Gauge },
  { id: "changePct", label: "% Change", Icon: ArrowLeftRight },
  { id: "lastCandleVolSpike", label: "Vol Spike", Icon: Flame },
];

interface VolatileFilterBarProps {
  priceMin: number | null;
  priceMax: number | null;
  sortBy: VolatileSortKey;
  onPriceBandChange: (min: number | null, max: number | null) => void;
  onSortChange: (key: VolatileSortKey) => void;
  /** Optional pool stats — surface "12 of 184 stocks" so the user knows the cap is working. */
  matchedCount?: number;
  poolSize?: number;
}

function isActivePriceBucket(
  bucket: PriceBucket,
  priceMin: number | null,
  priceMax: number | null,
): boolean {
  return bucket.min === priceMin && bucket.max === priceMax;
}

export function VolatileFilterBar({
  priceMin,
  priceMax,
  sortBy,
  onPriceBandChange,
  onSortChange,
  matchedCount,
  poolSize,
}: VolatileFilterBarProps) {
  return (
    <div className="space-y-3">
      {/* Price-band row */}
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
