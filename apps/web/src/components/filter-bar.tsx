"use client";

export type FilterValue = "ALL" | "SIGNALS" | "BUY" | "SELL";

interface FilterBarProps {
  filter: FilterValue;
  onFilterChange: (f: FilterValue) => void;
  signalCount: number;
  buyCount: number;
  sellCount: number;
}

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "SIGNALS", label: "Signals" },
  { value: "BUY", label: "BUY" },
  { value: "SELL", label: "SELL" },
];

function CountBadge({
  count,
  isActive,
  color,
}: {
  count: number;
  isActive: boolean;
  color?: "green" | "red";
}) {
  const colorCls =
    color === "green"
      ? "bg-green-500/20 text-green-600 dark:text-green-400"
      : color === "red"
        ? "bg-red-500/20 text-red-600 dark:text-red-400"
        : isActive
          ? "bg-foreground/10 text-foreground"
          : "bg-muted-foreground/20 text-muted-foreground";

  return (
    <span
      className={`ml-1.5 inline-flex items-center justify-center h-4 min-w-4 px-1 text-[10px] font-bold rounded-full ${colorCls}`}
    >
      {count}
    </span>
  );
}

export function FilterBar({
  filter,
  onFilterChange,
  signalCount,
  buyCount,
  sellCount,
}: FilterBarProps) {
  return (
    <div className="flex items-center gap-0.5 bg-muted/60 rounded-lg p-1 border border-border/30">
      {FILTERS.map((f) => {
        const isActive = filter === f.value;
        const isBuy = f.value === "BUY";
        const isSell = f.value === "SELL";

        return (
          <button
            key={f.value}
            onClick={() => onFilterChange(f.value)}
            className={`
              relative px-3 py-1.5 text-xs font-medium rounded-md transition-all
              ${
                isActive
                  ? isBuy
                    ? "bg-green-500/15 text-green-600 dark:text-green-400 shadow-sm"
                    : isSell
                      ? "bg-red-500/15 text-red-600 dark:text-red-400 shadow-sm"
                      : "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }
            `}
          >
            {f.label}
            {f.value === "SIGNALS" && signalCount > 0 && (
              <CountBadge count={signalCount} isActive={isActive} />
            )}
            {f.value === "BUY" && buyCount > 0 && (
              <CountBadge count={buyCount} isActive={isActive} color="green" />
            )}
            {f.value === "SELL" && sellCount > 0 && (
              <CountBadge count={sellCount} isActive={isActive} color="red" />
            )}
          </button>
        );
      })}
    </div>
  );
}
