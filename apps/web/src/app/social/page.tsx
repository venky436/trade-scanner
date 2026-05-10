"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  Camera,
  CheckCircle2,
  Clock,
  Eye,
  Minus,
  Sparkles,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { apiFetch } from "@/lib/api";
import {
  outlookCategoryDisplay,
  socialDisplayStatus,
  type SocialSignal,
} from "@/components/social/template-shared";

function getTodayIST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface ZoneVisual {
  Icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  iconRing: string;
  strip: string;
  hoverBorder: string;
  hoverShadow: string;
  cardTint: string;
  activityText: string;
}

// Zone visuals — colored accent strip + icon container per outlook.
//   Bounce    (gentle reactive up at support)   → emerald + ArrowUpRight
//   Rejection (gentle reactive down at res)     → rose    + ArrowDownRight
//   Breakout  (aggressive up through res)       → sky     + TrendingUp
//   Breakdown (aggressive down through support) → orange  + TrendingDown
// Distinct hues + steeper trending icons signal the more committed nature of
// gated Breakout/Breakdown vs reactive Bounce/Rejection. Unknown outlooks fall
// back to a neutral slate look so the card still renders legibly.
function zoneVisual(outlook: string): ZoneVisual {
  if (outlook === "BOUNCE_EXPECTED") {
    return {
      Icon: ArrowUpRight,
      iconColor: "text-emerald-500 dark:text-emerald-400",
      iconBg: "bg-emerald-500/10",
      iconRing: "ring-emerald-400/40",
      strip: "bg-gradient-to-b from-emerald-400/0 via-emerald-400/80 to-emerald-400/0",
      hoverBorder: "hover:border-emerald-400/40",
      hoverShadow: "hover:shadow-emerald-500/[0.06]",
      cardTint: "bg-gradient-to-br from-emerald-500/[0.04] via-transparent to-transparent dark:from-emerald-500/[0.05]",
      activityText: "text-emerald-600 dark:text-emerald-300/90",
    };
  }
  if (outlook === "REJECTION_POSSIBLE") {
    return {
      Icon: ArrowDownRight,
      iconColor: "text-rose-500 dark:text-rose-400",
      iconBg: "bg-rose-500/10",
      iconRing: "ring-rose-400/40",
      strip: "bg-gradient-to-b from-rose-400/0 via-rose-400/80 to-rose-400/0",
      hoverBorder: "hover:border-rose-400/40",
      hoverShadow: "hover:shadow-rose-500/[0.06]",
      cardTint: "bg-gradient-to-br from-rose-500/[0.04] via-transparent to-transparent dark:from-rose-500/[0.05]",
      activityText: "text-rose-600 dark:text-rose-300/90",
    };
  }
  if (outlook === "BREAKOUT_LIKELY") {
    return {
      Icon: TrendingUp,
      iconColor: "text-sky-500 dark:text-sky-400",
      iconBg: "bg-sky-500/10",
      iconRing: "ring-sky-400/40",
      strip: "bg-gradient-to-b from-sky-400/0 via-sky-400/80 to-sky-400/0",
      hoverBorder: "hover:border-sky-400/40",
      hoverShadow: "hover:shadow-sky-500/[0.06]",
      cardTint: "bg-gradient-to-br from-sky-500/[0.04] via-transparent to-transparent dark:from-sky-500/[0.05]",
      activityText: "text-sky-600 dark:text-sky-300/90",
    };
  }
  if (outlook === "BREAKDOWN_RISK") {
    return {
      Icon: TrendingDown,
      iconColor: "text-orange-500 dark:text-orange-400",
      iconBg: "bg-orange-500/10",
      iconRing: "ring-orange-400/40",
      strip: "bg-gradient-to-b from-orange-400/0 via-orange-400/80 to-orange-400/0",
      hoverBorder: "hover:border-orange-400/40",
      hoverShadow: "hover:shadow-orange-500/[0.06]",
      cardTint: "bg-gradient-to-br from-orange-500/[0.04] via-transparent to-transparent dark:from-orange-500/[0.05]",
      activityText: "text-orange-600 dark:text-orange-300/90",
    };
  }
  return {
    Icon: Sparkles,
    iconColor: "text-zinc-500 dark:text-zinc-400",
    iconBg: "bg-zinc-500/10",
    iconRing: "ring-zinc-400/30",
    strip: "bg-gradient-to-b from-zinc-400/0 via-zinc-400/50 to-zinc-400/0",
    hoverBorder: "hover:border-zinc-300 dark:hover:border-zinc-700",
    hoverShadow: "hover:shadow-zinc-500/[0.04]",
    cardTint: "",
    activityText: "text-zinc-500 dark:text-zinc-400",
  };
}

// Status visual treatment — four discrete states with the change% magnitude
// shown inline on the pill so the admin can scan card outcomes without
// opening each one. Outcomes (SUCCESS/FAILED) reflect the canonical 8-min
// window's lock; the ±0.2% dead-zone reclassifies as NEUTRAL at metric time.
//   PENDING                            → amber  Clock        "Pending"
//   NEUTRAL  (|change| < 0.2%)         → slate  Minus        "Neutral ±X.XX%"
//   SUCCESS                            → emerald CheckCircle "Success +X.XX%"
//   FAILED                             → rose   XCircle      "Failed -X.XX%"
function statusVisual(signal: SocialSignal) {
  const display = socialDisplayStatus(signal);
  const change = Number(signal.changePercent ?? 0);
  const absPct = Math.abs(change).toFixed(2);

  if (display === "PENDING") {
    return {
      label: "Pending",
      Icon: Clock,
      pill: "border-amber-400/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }
  if (display === "NEUTRAL") {
    return {
      label: `Neutral · ±${absPct}%`,
      Icon: Minus,
      pill: "border-slate-400/30 bg-slate-500/10 text-slate-600 dark:text-slate-300",
    };
  }
  if (display === "SUCCESS") {
    // Magnitude can be either side (buy-side success = positive change,
    // sell-side success = negative change). Show the SIGNED change so the
    // direction is unambiguous when comparing buy/sell outcomes.
    const signedPct = (change >= 0 ? "+" : "") + change.toFixed(2);
    return {
      label: `Success · ${signedPct}%`,
      Icon: CheckCircle2,
      pill: "border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  }
  // FAILED
  const signedPct = (change >= 0 ? "+" : "") + change.toFixed(2);
  return {
    label: `Failed · ${signedPct}%`,
    Icon: XCircle,
    pill: "border-rose-400/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  };
}

export default function SocialListPage() {
  const [signals, setSignals] = useState<SocialSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(getTodayIST());

  const isToday = selectedDate === getTodayIST();

  useEffect(() => {
    let active = true;
    async function fetchData() {
      try {
        setError(null);
        const res = await apiFetch(`/api/admin/social?date=${selectedDate}`);
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data = await res.json();
        if (active) {
          setSignals(data.signals ?? []);
          setLoading(false);
        }
      } catch (err: any) {
        if (active) {
          setError(err.message ?? "Failed to load");
          setLoading(false);
        }
      }
    }
    fetchData();
    // 30s polling matches the backend snapshot cadence — outcomes flip
    // (Pending → Follow-up Available) within ~one cycle of lock-in.
    const interval = isToday ? setInterval(fetchData, 30_000) : null;

    function handleVisibility() {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        fetchData();
      }
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility);
    }

    return () => {
      active = false;
      if (interval) clearInterval(interval);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
    };
  }, [selectedDate, isToday]);

  return (
    <main className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="group inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-900/40 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700"
        >
          <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />
          Back to Home
        </Link>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={selectedDate}
            max={getTodayIST()}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 text-sm text-zinc-900 dark:text-zinc-100"
          />
          {!isToday && (
            <button
              onClick={() => setSelectedDate(getTodayIST())}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
            >
              Today
            </button>
          )}
        </div>
      </div>

      {/* Title — SEBI-safe heading */}
      <div>
        <div className="flex items-center gap-3">
          <Eye className="size-7 text-cyan-500" />
          <h1 className="text-3xl font-bold tracking-tight">System Observation Stocks</h1>
        </div>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Educational market-behaviour observations · {selectedDate}
        </p>
      </div>

      {/* Body */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800/60" />
          ))}
        </div>
      )}

      {error && !loading && (
        <div className="flex items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 px-5 py-4 text-rose-600 dark:text-rose-400">
          <AlertCircle className="size-5" />
          <span className="text-sm">Failed to load: {error}</span>
        </div>
      )}

      {!loading && !error && signals.length === 0 && (
        <div className="relative overflow-hidden rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800/80 bg-white/40 dark:bg-zinc-900/20 px-8 py-14 text-center">
          <div className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 size-44 rounded-full blur-3xl bg-cyan-400/15" />
          <div className="relative flex flex-col items-center gap-4">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-500/15 ring-1 ring-cyan-400/40 shadow-sm">
              <Eye className="size-6 text-cyan-500 dark:text-cyan-300" strokeWidth={2.2} />
            </div>
            <div className="space-y-1.5 max-w-md">
              <h3 className="text-base font-bold text-zinc-800 dark:text-zinc-200">
                No observations yet for {selectedDate}
              </h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
                Observations appear here as the system surfaces high-activity stocks across momentum, participation and volatility throughout the trading day.
              </p>
            </div>
          </div>
        </div>
      )}

      {!loading && !error && signals.length > 0 && (
        <>
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            <span>Observations</span>
            <span className="tabular-nums">
              {signals.length} {signals.length === 1 ? "card" : "cards"}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {signals.map((s) => {
              const status = statusVisual(s);
              const StatusIcon = status.Icon;
              const zone = zoneVisual(s.outlook);
              const ZoneIcon = zone.Icon;
              const defaultView = s.status === "PENDING" ? "initial" : "outcome";

              return (
                <Link
                  key={s.id}
                  href={`/social/${s.id}?view=${defaultView}`}
                  className={`group relative overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-900/40 transition-all hover:-translate-y-0.5 hover:shadow-lg ${zone.hoverBorder} ${zone.hoverShadow}`}
                >
                  {/* Subtle zone-tinted background gradient */}
                  <div className={`absolute inset-0 pointer-events-none ${zone.cardTint}`} />
                  {/* Left accent strip — vertical gradient matching the zone */}
                  <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${zone.strip}`} />

                  <div className="relative px-4 py-3.5">
                    {/* Top row — icon + symbol/time + camera */}
                    <div className="flex items-center gap-3">
                      <div className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${zone.iconBg} ring-1 ${zone.iconRing} shadow-sm`}>
                        <ZoneIcon className={`size-4 ${zone.iconColor}`} strokeWidth={2.5} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[15px] font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                            {s.symbol}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] tabular-nums uppercase tracking-wide text-zinc-500">
                            {formatTime(s.signalTime)}
                          </span>
                        </div>
                        <div className={`mt-0.5 truncate text-[11px] font-medium ${zone.activityText}`}>
                          {outlookCategoryDisplay(s.outlook)}
                        </div>
                      </div>

                      <Camera className="size-3.5 shrink-0 text-zinc-300 dark:text-zinc-700 transition-colors group-hover:text-zinc-500" />
                    </div>

                    {/* Status pill — right-aligned, separated by hairline */}
                    <div className="mt-3 flex items-center justify-end border-t border-zinc-100 dark:border-zinc-800/60 pt-2.5">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${status.pill}`}>
                        <StatusIcon className="size-3" strokeWidth={2.5} />
                        {status.label}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}
