"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Camera, Clock, CheckCircle, XCircle, Minus, AlertCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { SocialSignal } from "@/components/social/template-shared";

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

interface StatusMeta {
  label: string;
  className: string;
  icon: typeof CheckCircle;
}

function statusMeta(status: string): StatusMeta {
  if (status === "PENDING") {
    return {
      label: "Outcome Pending",
      className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
      icon: Clock,
    };
  }
  if (status === "SUCCESS") {
    return {
      label: "Played Out",
      className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
      icon: CheckCircle,
    };
  }
  if (status === "FAILED") {
    return {
      label: "Did Not Play Out",
      className: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30",
      icon: XCircle,
    };
  }
  return {
    label: "No Clear Movement",
    className: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30",
    icon: Minus,
  };
}

function bucketStyle(bucket: string): string {
  if (bucket === "ULTRA_HIGH") return "text-amber-500 dark:text-amber-400 border-amber-500/30 bg-amber-500/10";
  if (bucket === "HIGH") return "text-blue-500 dark:text-blue-400 border-blue-500/30 bg-blue-500/10";
  return "text-zinc-500 dark:text-zinc-400 border-zinc-500/30 bg-zinc-500/10";
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
    const interval = isToday ? setInterval(fetchData, 30_000) : null;
    return () => {
      active = false;
      if (interval) clearInterval(interval);
    };
  }, [selectedDate, isToday]);

  return (
    <main className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link
          href="/admin"
          className="group inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-900/40 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700"
        >
          <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />
          Back to Admin
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

      {/* Title */}
      <div>
        <div className="flex items-center gap-3">
          <Camera className="size-7 text-cyan-500" />
          <h1 className="text-3xl font-bold tracking-tight">Social Templates</h1>
        </div>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Screenshot-ready templates for high-confidence high-volatility signals · {selectedDate}
        </p>
      </div>

      {/* Body */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800/60" />
          ))}
        </div>
      )}

      {error && !loading && (
        <div className="flex items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 px-5 py-4 text-rose-600 dark:text-rose-400">
          <AlertCircle className="size-5" />
          <span className="text-sm">Failed to load signals: {error}</span>
        </div>
      )}

      {!loading && !error && signals.length === 0 && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-900/30 px-6 py-10 text-center">
          <Camera className="size-8 mx-auto text-zinc-400 dark:text-zinc-600" />
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
            No eligible signals for {selectedDate}.
          </p>
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            Templates require confidence ≥ 0.75 AND high volatility.
          </p>
        </div>
      )}

      {!loading && !error && signals.length > 0 && (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800/60 bg-white dark:bg-zinc-900/40 overflow-hidden">
          <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-800/60 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">
              Signals
            </span>
            <span className="text-xs text-zinc-500">
              {signals.length} {signals.length === 1 ? "template" : "templates"}
            </span>
          </div>
          <div>
            {signals.map((s) => {
              const meta = statusMeta(s.status);
              const StatusIcon = meta.icon;
              const defaultView = s.status === "PENDING" ? "initial" : "outcome";
              return (
                <Link
                  key={s.id}
                  href={`/admin/social/${s.id}?view=${defaultView}`}
                  className="grid grid-cols-[80px_140px_180px_100px_100px_1fr_auto] items-center gap-4 px-5 py-3.5 border-t border-zinc-100 dark:border-zinc-800/40 first:border-t-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
                >
                  <span className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
                    {formatTime(s.signalTime)}
                  </span>
                  <span className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                    {s.symbol}
                  </span>
                  <span className="text-xs text-zinc-600 dark:text-zinc-400">
                    {s.outlook.replace("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
                  </span>
                  <span className="text-xs font-mono text-zinc-700 dark:text-zinc-300">
                    {Number(s.confidence).toFixed(2)}
                  </span>
                  <span className={`inline-flex justify-center text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border ${bucketStyle(s.confidenceBucket)}`}>
                    {s.confidenceBucket.replace("_", " ")}
                  </span>
                  <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full border ${meta.className} w-fit`}>
                    <StatusIcon className="size-3" />
                    {meta.label}
                  </span>
                  <Camera className="size-4 text-zinc-400 dark:text-zinc-500" />
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
