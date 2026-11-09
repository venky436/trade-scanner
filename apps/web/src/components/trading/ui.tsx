"use client";

// Small shared building blocks for the Trade / Orders / P&L screens.
import { useEffect } from "react";
import { useAuth } from "@/context/auth-context";
import type { TradeConfig } from "@/lib/trading";
import { useTradeMode } from "./trade-mode";

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-muted/60 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-7 px-3 rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            value === o.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SectionHeader({ title, note, right }: { title: string; note?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-4 pb-3">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
      </div>
      {right}
    </div>
  );
}

/** Paper / Live indicator — always visible on trading screens. */
export function ModePill({ config }: { config: TradeConfig | null }) {
  if (!config) return null;
  return config.mode === "LIVE" ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 px-2.5 py-1 text-xs font-medium text-rose-400">
      <span className="size-1.5 rounded-full bg-rose-500 animate-pulse" />
      Live — real orders
    </span>
  ) : (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/10 px-2.5 py-1 text-xs font-medium text-amber-400"
      title="Use the Paper / Real switch in the top bar to send real orders"
    >
      <span className="size-1.5 rounded-full bg-amber-400" />
      Paper — simulated
    </span>
  );
}

/** Current trading config — follows the global Paper / Real switch. */
export function useTradeConfig() {
  return useTradeMode().config;
}

/** Trading screens are for the account owner (ADMIN) only. */
export function AdminOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user && user.role !== "ADMIN") {
    return <div className="max-w-[1400px] mx-auto px-4 py-16 text-center text-sm text-muted-foreground">Trading is available to the account owner only.</div>;
  }
  return <>{children}</>;
}

/** Re-run `fn` every `ms` while the tab is visible. */
export function usePolling(fn: () => void, ms: number, deps: unknown[] = []) {
  useEffect(() => {
    fn();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") fn();
    }, ms);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
