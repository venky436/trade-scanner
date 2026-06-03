"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Minus, Pause } from "lucide-react";
import type { IntelligenceSnapshot, Outlook } from "@/lib/types";
import { AiVerdictChip } from "./ai-verdict-chip";
import { useServerConfig } from "@/context/config-context";
import {
  formatTimeAgo,
  marketObservation,
  momentumDirection,
  momentumDisplay,
  pressureDirection,
  pressureDisplay,
  strengthDescriptor,
  volatilityDisplay,
  zoneDisplay,
} from "@/lib/sebi-display";

interface MarketCardProps {
  data: IntelligenceSnapshot;
}

// Map the outlook (already derived from all factors — zone, momentum,
// pressure, confidence, volume + Donchian gates for breakouts) into a simple
// action + setup name. Personal-use mode: we expose the directional call.
type CardAction = "BUY" | "SELL" | "WAIT";
const OUTLOOK_TO_ACTION: Record<Outlook, { action: CardAction; setup: string }> = {
  BOUNCE_EXPECTED: { action: "BUY", setup: "Bounce" },
  BREAKOUT_LIKELY: { action: "BUY", setup: "Breakout" },
  REJECTION_POSSIBLE: { action: "SELL", setup: "Rejection" },
  BREAKDOWN_RISK: { action: "SELL", setup: "Breakdown" },
  NO_CLEAR_EDGE: { action: "WAIT", setup: "No setup" },
};

const ZONE_GRADIENT: Record<string, string> = {
  NEAR_SUPPORT: "from-emerald-400/40 via-emerald-400/0 to-transparent",
  NEAR_RESISTANCE: "from-rose-400/40 via-rose-400/0 to-transparent",
  MID_RANGE: "from-slate-500/30 via-slate-500/0 to-transparent",
};

const ZONE_BORDER_HOVER: Record<string, string> = {
  NEAR_SUPPORT: "hover:border-emerald-500/40 hover:shadow-emerald-500/10",
  NEAR_RESISTANCE: "hover:border-rose-500/40 hover:shadow-rose-500/10",
  MID_RANGE: "hover:border-slate-500/30 hover:shadow-slate-500/10",
};

function directionColor(dir: "up" | "down" | "flat"): string {
  if (dir === "up") return "text-emerald-500 dark:text-emerald-400";
  if (dir === "down") return "text-rose-500 dark:text-rose-400";
  return "text-zinc-400 dark:text-zinc-500";
}

function directionFill(dir: "up" | "down" | "flat"): string {
  if (dir === "up") return "bg-emerald-500 dark:bg-emerald-400";
  if (dir === "down") return "bg-rose-500 dark:bg-rose-400";
  return "bg-zinc-400 dark:bg-zinc-500";
}

// Visual 5-cell strength bar — consistent across all three metrics so the eye
// can compare momentum/pressure/volatility at a glance. Each cell transitions
// colour smoothly so a WS tick that bumps the score visibly animates instead
// of snapping.
function StrengthBar({ score, dir }: { score: number; dir: "up" | "down" | "flat" }) {
  const filled = Math.max(1, Math.min(5, Math.round(Math.max(0, Math.min(1, score)) * 5)));
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`h-1.5 w-2.5 rounded-sm transition-colors duration-500 ${i <= filled ? directionFill(dir) : "bg-zinc-200 dark:bg-zinc-800"}`}
        />
      ))}
    </div>
  );
}

// Live "Updated X min ago" — recomputes once a minute (independent of WS ticks)
// so the freshness label stays honest even if no new tick arrives.
function useLiveTimeAgo(timestampMs: number): string {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return formatTimeAgo(timestampMs);
}

// Price-flash on tick — emerald if price rose vs last render, rose if it fell.
// Drops back to normal after ~1.2s. Stronger duration so a real WS tick is
// obviously visible to the user; communicates "this is live" without being
// distracting.
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

export function MarketCard({ data }: MarketCardProps) {
  const zone = data.context.zone;
  const mDir = momentumDirection(data.momentum.label);
  const pDir = pressureDirection(data.pressure.label);
  // Volatility is magnitude-only — but we tint it by the *card-level* direction
  // when momentum and pressure agree, so the whole card reads as one coherent
  // bullish-or-bearish story (green when both are up, red when both are down).
  // When they disagree (or either is neutral) volatility stays flat to signal
  // mixed conditions.
  const volDir: "up" | "down" | "flat" =
    mDir !== "flat" && mDir === pDir ? mDir : "flat";

  const flash = usePriceFlash(data.price);
  const liveLabel = useLiveTimeAgo(data.timestamp);

  const changeUp = data.change > 0;
  const changeDown = data.change < 0;
  const changeColor = changeUp
    ? "text-emerald-600 dark:text-emerald-400"
    : changeDown
    ? "text-rose-600 dark:text-rose-400"
    : "text-zinc-500";

  // Price-text-only flash — color shifts emerald/rose for ~1.2s on tick.
  // No surrounding ring or background tint (kept the card itself clean).
  const priceColor = flash === "up"
    ? "text-emerald-600 dark:text-emerald-400"
    : flash === "down"
    ? "text-rose-600 dark:text-rose-400"
    : "text-zinc-900 dark:text-zinc-50";

  return (
    <Link
      href={`/stock/${encodeURIComponent(data.symbol)}`}
      className={`group relative block overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl ${ZONE_BORDER_HOVER[zone]}`}
    >
      {/* Zone-tinted top edge gradient */}
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r ${ZONE_GRADIENT[zone]}`} />
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b ${ZONE_GRADIENT[zone]} opacity-60`} />

      {/* Hero — symbol + zone label / price + change */}
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {data.symbol}
          </div>
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
            {zoneDisplay(zone)}
          </div>
        </div>
        <div className="shrink-0">
          <div
            className={`text-right text-2xl font-bold tabular-nums transition-colors duration-700 ${priceColor}`}
            style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)" }}
          >
            ₹{data.price.toFixed(2)}
          </div>
          <div className={`mt-0.5 text-right text-xs font-semibold tabular-nums ${changeColor}`}>
            {changeUp ? "+" : ""}{data.change.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Verdict slot — exclusively ONE of these renders based on AI mode:
          • AI mode ON  → AI verdict chip (BUY/SELL/WAIT comes from Gemini)
          • AI mode OFF → rule-engine chip (BUY/SELL/WAIT comes from Outlook)
          Single source of truth for "what's the call on this stock" so the
          user is never seeing two competing verdicts. */}
      <VerdictSlot data={data} />

      {/* Metric rows: Momentum / Pressure / Volatility */}
      <div className="mt-5 space-y-3">
        <MetricRow
          label="Momentum"
          headline={momentumDisplay(data.momentum.label)}
          dir={mDir}
          score={data.momentum.score}
          DirIcon={mDir === "up" ? ArrowUp : mDir === "down" ? ArrowDown : Minus}
        />
        <MetricRow
          label="Pressure"
          headline={pressureDisplay(data.pressure.label)}
          dir={pDir}
          score={data.pressure.score}
          DirIcon={pDir === "up" ? ArrowUp : pDir === "down" ? ArrowDown : Minus}
        />
        <MetricRow
          label="Volatility"
          headline={volatilityDisplay(data.volatility.label)}
          dir={volDir}
          score={data.volatility.score}
          // No directional arrow on volatility — it's magnitude only.
          DirIcon={null}
        />
      </div>

      {/* Divider */}
      <div className="mt-4 h-px w-full bg-zinc-200 dark:bg-zinc-800/80" />

      {/* Observation */}
      <div className="mt-4">
        <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500 dark:text-zinc-400">
          Market Observation
        </div>
        <p className="mt-2 text-sm leading-snug text-zinc-700 dark:text-zinc-200">
          {marketObservation(data)}
        </p>
      </div>

      {/* Live freshness footer — more obvious "LIVE" pill */}
      <div className="mt-4 flex items-center gap-2.5">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/[0.08] px-2 py-0.5">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
          </span>
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-300">
            Live
          </span>
        </span>
        <span className="text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
          {liveLabel}
        </span>
      </div>
    </Link>
  );
}

// Single-verdict-source slot. Reads aiModeEnabled from ConfigProvider and
// picks ONE component:
//   AI ON  → AiVerdictChip (which falls back to a "warming up" pill when no
//            verdict is cached yet for this symbol)
//   AI OFF → ActionConfidenceRow (the rule-based BUY/SELL/WAIT chip)
function VerdictSlot({ data }: { data: IntelligenceSnapshot }) {
  const { aiModeEnabled } = useServerConfig();
  if (aiModeEnabled) {
    return <AiVerdictChip symbol={data.symbol} />;
  }
  return <ActionConfidenceRow data={data} />;
}

function ActionConfidenceRow({ data }: { data: IntelligenceSnapshot }) {
  const { action, setup } = OUTLOOK_TO_ACTION[data.outlook];
  const confPct = Math.round(Math.max(0, Math.min(1, data.confidence)) * 100);

  const actionBadge =
    action === "BUY"
      ? "bg-gradient-to-r from-emerald-500 to-emerald-400 text-white shadow-sm shadow-emerald-500/30 ring-1 ring-emerald-300/40"
      : action === "SELL"
      ? "bg-gradient-to-r from-rose-500 to-rose-400 text-white shadow-sm shadow-rose-500/30 ring-1 ring-rose-300/40"
      : "bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 ring-1 ring-zinc-300 dark:ring-zinc-700";

  const ActionIcon = action === "BUY" ? ArrowUp : action === "SELL" ? ArrowDown : Pause;

  const confTone =
    data.confidenceLabel === "HIGH"
      ? "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 ring-emerald-500/30"
      : data.confidenceLabel === "MEDIUM"
      ? "text-amber-700 dark:text-amber-300 bg-amber-500/10 ring-amber-500/30"
      : "text-zinc-600 dark:text-zinc-400 bg-zinc-500/10 ring-zinc-500/20";

  return (
    <div className="mt-4 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold tracking-wider ${actionBadge}`}
        >
          <ActionIcon className="size-3" strokeWidth={3.5} />
          {action}
        </span>
        <span className="truncate text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">
          {setup}
        </span>
      </div>
      <span
        className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold ring-1 ${confTone}`}
      >
        <span className="text-[9px] uppercase tracking-widest opacity-70">Conf</span>
        <span className="tabular-nums">{confPct}%</span>
      </span>
    </div>
  );
}

function MetricRow({
  label,
  headline,
  dir,
  score,
  DirIcon,
}: {
  label: string;
  headline: string;
  dir: "up" | "down" | "flat";
  score: number;
  DirIcon: typeof ArrowUp | null;
}) {
  return (
    <div className="grid grid-cols-[88px_1fr_auto] items-center gap-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className="flex items-center gap-2 min-w-0">
        {DirIcon && <DirIcon className={`size-4 shrink-0 ${directionColor(dir)}`} strokeWidth={2.75} />}
        <span className="truncate text-[13px] font-semibold text-zinc-800 dark:text-zinc-100">
          {headline}
        </span>
      </div>
      <div className="flex flex-col items-end gap-1">
        <StrengthBar score={score} dir={dir} />
        <span className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          {strengthDescriptor(score)}
        </span>
      </div>
    </div>
  );
}
