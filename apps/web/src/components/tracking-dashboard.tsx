"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  AlertTriangle,
  CheckCircle,
  Clock,
  Eye,
  Minus,
  Shield,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { apiFetch } from "@/lib/api";

interface OutlookMetric {
  total: number;
  wins: number;
  neutral: number;
  rate: number;
}

interface BucketData {
  bucket: string;
  total: number;
  pending: number;
  success: number;
  failed: number;
  neutral: number;
  accuracy: number;
  avgGain: number;
  avgLoss: number;
  avgMaxProfit: number;
  avgMaxDrawdown: number;
  expectancy: number;
  riskReward: number;
  sampleSufficient: boolean;
  minSampleRequired: number;
  byOutlook: Record<string, OutlookMetric>;
}

interface TrackingMetrics {
  date: string;
  buckets: BucketData[];
  activeCount: number;
}

interface SignalRecord {
  id: number;
  symbol: string;
  signalTime: string;
  priceAtSignal: string;
  outlook: string;
  confidence: string;
  confidenceBucket: string;
  zone: string;
  bias: string;
  status: string;
  priceAfter: string | null;
  changePercent: string | null;
  changePoints: string | null;
  maxPrice: string | null;
  minPrice: string | null;
  maxProfitPercent: string | null;
  maxDrawdownPercent: string | null;
  evaluatedAt: string | null;
  groupId: string;
}

// Single tracking pool. Three-bucket model (Ultra/High/Medium) was retired
// 2026-05-07 — only conf ≥ 0.7 emits, written as "TRACKED". Legacy bucket
// strings are mapped here for the Recent Signals badge column on historical rows.
const BUCKET_STYLE: Record<string, { accent: string; border: string; gradient: string; icon: typeof Eye; label: string; range: string }> = {
  TRACKED: {
    accent: "text-cyan-500 dark:text-cyan-400",
    border: "border-cyan-500/30",
    gradient: "from-cyan-500/10 via-cyan-500/5 to-transparent dark:from-cyan-500/15",
    icon: Eye,
    label: "Tracked Signals",
    range: "conf ≥ 0.7 · Bounce / Rejection only",
  },
};

const OUTLOOK_LABEL: Record<string, string> = {
  BOUNCE_EXPECTED: "Bounce",
  REJECTION_POSSIBLE: "Rejection",
  // Kept defensively so Recent Signals on historical dates still renders a
  // human-readable label for retired outlooks.
  BREAKOUT_LIKELY: "Breakout (retired)",
  BREAKDOWN_RISK: "Breakdown (retired)",
};

// Outlooks shown in the "By Outlook" rollup. Retired outlooks intentionally
// excluded — they're filtered server-side too, but the frontend keeps its own
// allowlist as a defensive guard.
const TRACKED_OUTLOOKS = ["BOUNCE_EXPECTED", "REJECTION_POSSIBLE"];

// Mirrors the backend reclassifyForMetrics() — applies the ±0.2% NEUTRAL
// dead-zone so the Recent Signals table stays consistent with the bucket-card
// accuracy. Without this, a row with |change| < 0.2% would render "SUCCESS"
// in the table but be excluded from the accuracy denominator on the card,
// which is confusing. Threshold must stay in sync with the backend constant
// (NEUTRAL_METRIC_THRESHOLD_PERCENT in signal-tracking.service.ts).
const NEUTRAL_THRESHOLD_PERCENT = 0.2;
const BULLISH_OUTLOOKS = new Set(["BREAKOUT_LIKELY", "BOUNCE_EXPECTED"]);
function displayStatus(s: Pick<SignalRecord, "status" | "outlook" | "changePercent">): string {
  if (s.status === "PENDING") return "PENDING";
  const change = Number(s.changePercent ?? 0);
  if (Math.abs(change) < NEUTRAL_THRESHOLD_PERCENT) return "NEUTRAL";
  const isBullish = BULLISH_OUTLOOKS.has(s.outlook);
  if (isBullish) return change > 0 ? "SUCCESS" : "FAILED";
  return change < 0 ? "SUCCESS" : "FAILED";
}

const STATUS_STYLE: Record<string, { bg: string; text: string; icon: typeof CheckCircle }> = {
  SUCCESS: { bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", icon: CheckCircle },
  FAILED: { bg: "bg-rose-500/10", text: "text-rose-600 dark:text-rose-400", icon: XCircle },
  // NEUTRAL kept defensively for any historical row that bypasses the server reclassifier.
  NEUTRAL: { bg: "bg-zinc-200 dark:bg-zinc-800/60", text: "text-zinc-600 dark:text-zinc-400", icon: Minus },
  PENDING: { bg: "bg-amber-500/10", text: "text-amber-600 dark:text-amber-400", icon: Clock },
};

function accuracyColor(acc: number): string {
  if (acc >= 60) return "text-emerald-600 dark:text-emerald-400";
  if (acc >= 40) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

function expectancyColor(exp: number): string {
  if (exp > 0) return "text-emerald-600 dark:text-emerald-400";
  if (exp < 0) return "text-rose-600 dark:text-rose-400";
  return "text-zinc-500";
}

function getTodayIST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
}

export function TrackingDashboard() {
  const [metrics, setMetrics] = useState<TrackingMetrics | null>(null);
  const [signals, setSignals] = useState<SignalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(getTodayIST());

  const isToday = selectedDate === getTodayIST();

  useEffect(() => {
    let active = true;
    async function fetchData() {
      try {
        const metricsUrl = isToday
          ? "/api/admin/tracking"
          : `/api/admin/tracking/${selectedDate}`;
        const signalsUrl = `/api/admin/tracking/signals?date=${selectedDate}`;

        const [metricsRes, signalsRes] = await Promise.all([
          apiFetch(metricsUrl),
          apiFetch(signalsUrl),
        ]);
        if (!active) return;
        if (metricsRes.ok) setMetrics(await metricsRes.json());
        if (signalsRes.ok) {
          const data = await signalsRes.json();
          setSignals(data.signals ?? []);
        }
      } catch {
        // silently fail
      } finally {
        if (active) setLoading(false);
      }
    }
    setLoading(true);
    fetchData();
    // 30s polling matches the backend snapshot cadence — bucket counts and
    // per-outlook accuracy refresh within ~one cycle of a new lock-in at minute 10.
    const interval = isToday ? setInterval(fetchData, 30_000) : null;

    // Refetch the moment the tab becomes visible again — guards against
    // stale data when the user returns to the page.
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

  // Single-pool model: bucket filter removed. Only show signals at conf ≥ 0.7
  // (i.e. legacy HIGH/ULTRA_HIGH plus new TRACKED rows). Retired outlooks are
  // intentionally still rendered when present in historical data.
  const ABOVE_FLOOR_BUCKETS = new Set(["TRACKED", "HIGH", "ULTRA_HIGH"]);
  const filteredSignals = signals.filter((s) => ABOVE_FLOOR_BUCKETS.has(s.confidenceBucket));

  if (loading) {
    return (
      <div className="max-w-[1400px] mx-auto px-4 py-8">
        <div className="h-8 w-64 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-6 h-56 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-800/60" />
      </div>
    );
  }

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
          {isToday && (
            <div className="flex items-center gap-2">
              <Activity className="size-4 text-emerald-500" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                {metrics?.activeCount ?? 0} active
              </span>
            </div>
          )}
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Signal Tracking Analytics
        </h1>
        <p className="mt-1 text-xs text-zinc-500">
          10-minute direction snapshot · single tracked pool · {metrics?.date ?? "today"}
        </p>
      </div>

      {/* Single TRACKED bucket card. Replaces the prior Ultra/High/Medium row
          following the 2026-05-07 model change (only conf ≥ 0.7 emits). */}
      {(() => {
        const b: BucketData = (metrics?.buckets ?? []).find((x) => x.bucket === "TRACKED") ?? {
          bucket: "TRACKED",
          total: 0, pending: 0, success: 0, failed: 0, neutral: 0,
          accuracy: 0, avgGain: 0, avgLoss: 0, avgMaxProfit: 0, avgMaxDrawdown: 0,
          expectancy: 0, riskReward: 0,
          sampleSufficient: false,
          minSampleRequired: 250,
          byOutlook: {},
        };
        const style = BUCKET_STYLE.TRACKED;
        const BucketIcon = style.icon;
        const decided = b.success + b.failed;

        return (
          <div className={`relative overflow-hidden rounded-2xl border ${style.border} bg-gradient-to-br ${style.gradient} bg-white dark:bg-zinc-950/60 p-6`}>
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <BucketIcon className={`size-6 ${style.accent}`} />
                <div>
                  <div className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                    {style.label}
                  </div>
                  <div className="text-[11px] text-zinc-500">{style.range}</div>
                </div>
              </div>
              <div className="text-right text-xs text-zinc-500">
                {b.total} signals
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-6">
              {/* Big accuracy */}
              <div>
                <div className={`text-5xl font-bold tabular-nums ${decided > 0 ? accuracyColor(b.accuracy) : "text-zinc-400"}`}>
                  {decided > 0 ? `${b.accuracy}%` : "—"}
                </div>
                <div className="mt-1 text-[10px] uppercase tracking-wider text-zinc-500">accuracy</div>
                <div className="mt-2 flex items-center gap-3 text-[11px]">
                  <span className="text-emerald-600 dark:text-emerald-400">{b.success} W</span>
                  <span className="text-rose-600 dark:text-rose-400">{b.failed} L</span>
                  {b.neutral > 0 && <span className="text-zinc-500 dark:text-zinc-400">{b.neutral} N</span>}
                  {b.pending > 0 && <span className="text-amber-600 dark:text-amber-400">{b.pending} P</span>}
                </div>
              </div>

              {/* Expectancy + R:R */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">Expectancy / Trade</div>
                <div className={`mt-1 text-2xl font-bold tabular-nums ${expectancyColor(b.expectancy)}`}>
                  {b.expectancy > 0 ? "+" : ""}{b.expectancy.toFixed(3)}%
                </div>
                <div className="mt-3 text-[10px] uppercase tracking-wider text-zinc-500">Risk : Reward</div>
                <div className="mt-1 text-base font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {b.riskReward.toFixed(2)}x
                </div>
              </div>

              {/* Sample progress */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">Sample</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{decided}</span>
                  <span className="text-xs text-zinc-500">/ {b.minSampleRequired}</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800/80">
                  <div
                    className={`h-full rounded-full transition-all ${b.sampleSufficient ? "bg-emerald-500" : "bg-amber-500"}`}
                    style={{ width: `${Math.min(100, (decided / b.minSampleRequired) * 100)}%` }}
                  />
                </div>
                <div className="mt-1.5 text-[11px]">
                  {b.sampleSufficient ? (
                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle className="size-3" /> Sufficient
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="size-3" /> Need {Math.max(0, b.minSampleRequired - decided)} more
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Detailed Stats */}
      {metrics && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Movement Stats — single-pool, no bucket switcher */}
          <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-5">
            <div className="mb-4 flex items-center gap-2">
              <TrendingUp className="size-4 text-emerald-500" />
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                Movement Stats
              </h2>
            </div>
            {(() => {
              const buckets = metrics.buckets ?? [];
              const totals = buckets.reduce(
                (acc, b) => ({
                  avgGain: acc.avgGain + b.avgGain * b.success,
                  avgLoss: acc.avgLoss + b.avgLoss * b.failed,
                  avgMaxProfit: acc.avgMaxProfit + b.avgMaxProfit * (b.success + b.failed),
                  avgMaxDrawdown: acc.avgMaxDrawdown + b.avgMaxDrawdown * (b.success + b.failed),
                  successCount: acc.successCount + b.success,
                  failedCount: acc.failedCount + b.failed,
                  evalCount: acc.evalCount + b.success + b.failed,
                }),
                { avgGain: 0, avgLoss: 0, avgMaxProfit: 0, avgMaxDrawdown: 0, successCount: 0, failedCount: 0, evalCount: 0 },
              );
              const avgGain = totals.successCount > 0 ? totals.avgGain / totals.successCount : 0;
              const avgLoss = totals.failedCount > 0 ? totals.avgLoss / totals.failedCount : 0;
              const avgMaxProfit = totals.evalCount > 0 ? totals.avgMaxProfit / totals.evalCount : 0;
              const avgMaxDrawdown = totals.evalCount > 0 ? totals.avgMaxDrawdown / totals.evalCount : 0;
              const rr = avgLoss !== 0 ? Math.abs(avgGain / avgLoss) : 0;

              return (
                <div className="space-y-2.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Avg Gain (SUCCESS)</span>
                    <span className="font-bold tabular-nums text-emerald-600 dark:text-emerald-400">+{avgGain.toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Avg Loss (FAILED)</span>
                    <span className="font-bold tabular-nums text-rose-600 dark:text-rose-400">-{Math.abs(avgLoss).toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Risk : Reward</span>
                    <span className="font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{rr.toFixed(2)}x</span>
                  </div>
                  <div className="border-t border-zinc-200 dark:border-zinc-800/80 my-2" />
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Avg Max Profit</span>
                    <span className="font-bold tabular-nums text-emerald-600 dark:text-emerald-400">+{avgMaxProfit.toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Avg Max Drawdown</span>
                    <span className="font-bold tabular-nums text-rose-600 dark:text-rose-400">{avgMaxDrawdown.toFixed(2)}%</span>
                  </div>
                </div>
              );
            })()}
          </section>

          {/* By Outlook — only the two emitted outlooks */}
          <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-5">
            <div className="mb-4 flex items-center gap-2">
              <Shield className="size-4 text-purple-500" />
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                By Outlook
              </h2>
            </div>
            <div className="space-y-2.5">
              {TRACKED_OUTLOOKS.map((outlook) => {
                const buckets = metrics.buckets ?? [];
                const totals = buckets.reduce(
                  (acc, b) => {
                    const o = b.byOutlook[outlook];
                    return o
                      ? {
                          total: acc.total + o.total,
                          wins: acc.wins + o.wins,
                          neutral: acc.neutral + (o.neutral ?? 0),
                        }
                      : acc;
                  },
                  { total: 0, wins: 0, neutral: 0 },
                );
                // Rate = wins / total where total = wins + losses (NEUTRAL excluded
                // by the backend reclassifier already).
                const rate = totals.total > 0 ? Math.round((totals.wins / totals.total) * 100) : 0;

                return (
                  <div key={outlook} className="flex items-center justify-between text-xs">
                    <span className="text-zinc-600 dark:text-zinc-400">{OUTLOOK_LABEL[outlook] ?? outlook}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-zinc-500 tabular-nums">
                        {totals.total} signals
                        {totals.neutral > 0 ? ` · ${totals.neutral} N` : ""}
                      </span>
                      <span className={`font-bold tabular-nums ${totals.total > 0 ? accuracyColor(rate) : "text-zinc-400"}`}>
                        {totals.total > 0 ? `${rate}%` : "—"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* Signals Table — single-pool: above-floor rows only (conf ≥ 0.7) */}
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-cyan-500" />
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
              Recent Signals
            </h2>
            <span className="text-[10px] text-zinc-500">{filteredSignals.length} records</span>
          </div>
        </div>

        {filteredSignals.length === 0 ? (
          <div className="py-12 text-center text-sm text-zinc-500">
            No signals recorded yet. Tracking starts after 9:30 AM IST for Bounce / Rejection at confidence ≥ 0.7.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800/80 text-left text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  <th className="pb-2 pr-3">Time</th>
                  <th className="pb-2 pr-3">Symbol</th>
                  <th className="pb-2 pr-3">Outlook</th>
                  <th className="pb-2 pr-3 text-right">Conf</th>
                  <th className="pb-2 pr-3">Bucket</th>
                  <th className="pb-2 pr-3 text-right">Entry</th>
                  <th className="pb-2 pr-3 text-right">After</th>
                  <th className="pb-2 pr-3 text-right">Change</th>
                  <th className="pb-2 pr-3 text-right">Max ↑</th>
                  <th className="pb-2 pr-3 text-right">Max ↓</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredSignals.map((s) => {
                  const shownStatus = displayStatus(s);
                  const statusStyle = STATUS_STYLE[shownStatus] ?? STATUS_STYLE.PENDING;
                  const StatusIcon = statusStyle.icon;
                  const change = s.changePercent ? Number(s.changePercent) : null;
                  const maxProfit = s.maxProfitPercent ? Number(s.maxProfitPercent) : null;
                  const maxDrawdown = s.maxDrawdownPercent ? Number(s.maxDrawdownPercent) : null;

                  return (
                    <tr
                      key={s.id}
                      className="border-b border-zinc-100 dark:border-zinc-900/60 hover:bg-zinc-50 dark:hover:bg-zinc-900/30 transition-colors"
                    >
                      <td className="py-2 pr-3 tabular-nums text-zinc-500">
                        {formatTime(s.signalTime)}
                      </td>
                      <td className="py-2 pr-3 font-semibold text-zinc-900 dark:text-zinc-100">
                        {s.symbol}
                      </td>
                      <td className="py-2 pr-3 text-zinc-600 dark:text-zinc-400">
                        {OUTLOOK_LABEL[s.outlook] ?? s.outlook}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                        {Number(s.confidence).toFixed(2)}
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`text-[9px] font-bold uppercase ${BUCKET_STYLE[s.confidenceBucket]?.accent ?? "text-zinc-500"}`}>
                          {s.confidenceBucket === "ULTRA_HIGH" ? "ULTRA" : s.confidenceBucket}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                        ₹{Number(s.priceAtSignal).toFixed(2)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                        {s.priceAfter ? `₹${Number(s.priceAfter).toFixed(2)}` : "—"}
                      </td>
                      <td className={`py-2 pr-3 text-right tabular-nums font-semibold ${change !== null ? (change >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400") : "text-zinc-400"}`}>
                        {change !== null ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                        {maxProfit !== null ? `+${maxProfit.toFixed(2)}%` : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-rose-600 dark:text-rose-400">
                        {maxDrawdown !== null ? `${maxDrawdown.toFixed(2)}%` : "—"}
                      </td>
                      <td className="py-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusStyle.bg} ${statusStyle.text}`}>
                          <StatusIcon className="size-3" />
                          {shownStatus}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
