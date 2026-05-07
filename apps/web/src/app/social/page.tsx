"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Camera, Clock, Eye, Minus, AlertCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";
import {
  outlookCategoryDisplay,
  socialDisplayStatus,
  socialOutcomeStatusDisplay,
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

// Status visual treatment — three states, neutral vocabulary, no win/loss tone:
//   PENDING                                 → amber Clock "Outcome Pending"
//   NEUTRAL (|change| < 0.2% dead-zone)     → slate Minus "Limited Movement"
//   SUCCESS / FAILED                        → emerald Eye  "Follow-up Available"
// Takes the full signal so socialDisplayStatus can apply the dead-zone rule.
function statusVisual(signal: SocialSignal) {
  const display = socialDisplayStatus(signal);
  if (display === "PENDING") {
    return {
      label: socialOutcomeStatusDisplay(signal),
      Icon: Clock,
      pill: "border-amber-400/30 bg-amber-500/[0.08] text-amber-700 dark:text-amber-300",
    };
  }
  if (display === "NEUTRAL") {
    return {
      label: socialOutcomeStatusDisplay(signal),
      Icon: Minus,
      pill: "border-slate-400/30 bg-slate-500/[0.08] text-slate-600 dark:text-slate-300",
    };
  }
  return {
    label: socialOutcomeStatusDisplay(signal),
    Icon: Eye,
    pill: "border-emerald-400/30 bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-300",
  };
}

// Category visual — soft tint based on activity zone (neutral, not directional).
function categoryVisual(outlook: string) {
  if (outlook === "BREAKOUT_LIKELY" || outlook === "REJECTION_POSSIBLE") {
    return "text-rose-600 dark:text-rose-300/90";
  }
  if (outlook === "BOUNCE_EXPECTED" || outlook === "BREAKDOWN_RISK") {
    return "text-emerald-600 dark:text-emerald-300/90";
  }
  return "text-zinc-500 dark:text-zinc-400";
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
              const defaultView = s.status === "PENDING" ? "initial" : "outcome";

              return (
                <Link
                  key={s.id}
                  href={`/social/${s.id}?view=${defaultView}`}
                  className="group relative flex flex-col gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-900/40 px-4 py-3.5 transition-all hover:-translate-y-0.5 hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-md"
                >
                  {/* Top row: time + symbol + camera */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex items-baseline gap-2.5">
                      <span className="text-[11px] font-mono tabular-nums text-zinc-500 dark:text-zinc-500 shrink-0">
                        {formatTime(s.signalTime)}
                      </span>
                      <span className="truncate text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                        {s.symbol}
                      </span>
                    </div>
                    <Camera className="size-3.5 shrink-0 text-zinc-300 dark:text-zinc-700 group-hover:text-zinc-500 transition-colors" />
                  </div>

                  {/* Bottom row: category + status pill */}
                  <div className="flex items-center justify-between gap-2.5">
                    <span className={`text-[11px] font-medium truncate ${categoryVisual(s.outlook)}`}>
                      {outlookCategoryDisplay(s.outlook)}
                    </span>
                    <span className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${status.pill}`}>
                      <StatusIcon className="size-2.5" />
                      {status.label}
                    </span>
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
