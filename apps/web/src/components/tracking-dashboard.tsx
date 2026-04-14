"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  AlertTriangle,
  CheckCircle,
  Clock,
  Crown,
  Flame,
  Minus,
  Shield,
  Target,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { apiFetch } from "@/lib/api";

interface OutlookMetric {
  total: number;
  wins: number;
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
}

const BUCKET_STYLE: Record<string, { accent: string; border: string; gradient: string; icon: typeof Crown; label: string; range: string }> = {
  ULTRA_HIGH: {
    accent: "text-amber-500 dark:text-amber-400",
    border: "border-amber-500/30",
    gradient: "from-amber-500/10 via-amber-500/5 to-transparent dark:from-amber-500/15",
    icon: Crown,
    label: "Ultra High",
    range: "≥ 0.9",
  },
  HIGH: {
    accent: "text-blue-500 dark:text-blue-400",
    border: "border-blue-500/30",
    gradient: "from-blue-500/10 via-blue-500/5 to-transparent dark:from-blue-500/15",
    icon: Flame,
    label: "High",
    range: "0.7 – 0.9",
  },
  MEDIUM: {
    accent: "text-zinc-500 dark:text-zinc-400",
    border: "border-zinc-400/30 dark:border-zinc-600/30",
    gradient: "from-zinc-300/20 via-zinc-200/10 to-transparent dark:from-zinc-700/20 dark:via-zinc-800/10",
    icon: Target,
    label: "Medium",
    range: "0.5 – 0.7",
  },
};

const OUTLOOK_LABEL: Record<string, string> = {
  BREAKOUT_LIKELY: "Breakout",
  BOUNCE_EXPECTED: "Bounce",
  REJECTION_POSSIBLE: "Rejection",
  BREAKDOWN_RISK: "Breakdown",
};

const STATUS_STYLE: Record<string, { bg: string; text: string; icon: typeof CheckCircle }> = {
  SUCCESS: { bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", icon: CheckCircle },
  FAILED: { bg: "bg-rose-500/10", text: "text-rose-600 dark:text-rose-400", icon: XCircle },
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

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
}

export function TrackingDashboard() {
  const [metrics, setMetrics] = useState<TrackingMetrics | null>(null);
  const [signals, setSignals] = useState<SignalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function fetchData() {
      try {
        const [metricsRes, signalsRes] = await Promise.all([
          apiFetch("/api/admin/tracking"),
          apiFetch("/api/admin/tracking/signals"),
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
    fetchData();
    const handle = setInterval(fetchData, 30_000);
    return () => { active = false; clearInterval(handle); };
  }, []);

  const filteredSignals = selectedBucket
    ? signals.filter((s) => s.confidenceBucket === selectedBucket)
    : signals;

  if (loading) {
    return (
      <div className="max-w-[1400px] mx-auto px-4 py-8">
        <div className="h-8 w-64 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-56 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-800/60" />
          ))}
        </div>
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
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-emerald-500" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            {metrics?.activeCount ?? 0} active
          </span>
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Signal Tracking Analytics
        </h1>
        <p className="mt-1 text-xs text-zinc-500">
          15-minute time-based evaluation · confidence buckets · {metrics?.date ?? "today"}
        </p>
      </div>

      {/* 3 Bucket Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {(metrics?.buckets ?? []).map((b) => {
          const style = BUCKET_STYLE[b.bucket] ?? BUCKET_STYLE.MEDIUM;
          const BucketIcon = style.icon;
          const decided = b.success + b.failed;
          const isSelected = selectedBucket === b.bucket;

          return (
            <button
              key={b.bucket}
              onClick={() => setSelectedBucket(isSelected ? null : b.bucket)}
              className={`relative overflow-hidden rounded-2xl border ${style.border} ${isSelected ? "ring-2 ring-offset-1 ring-offset-white dark:ring-offset-zinc-950" : ""} bg-gradient-to-br ${style.gradient} bg-white dark:bg-zinc-950/60 p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg`}
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BucketIcon className={`size-5 ${style.accent}`} />
                  <div>
                    <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                      {style.label}
                    </div>
                    <div className="text-[10px] text-zinc-500">conf {style.range}</div>
                  </div>
                </div>
                <div className="text-right text-[10px] text-zinc-500">
                  {b.total} signals
                </div>
              </div>

              {/* Big accuracy */}
              <div className="mt-4">
                <div className={`text-4xl font-bold tabular-nums ${decided > 0 ? accuracyColor(b.accuracy) : "text-zinc-400"}`}>
                  {decided > 0 ? `${b.accuracy}%` : "—"}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">accuracy</div>
              </div>

              {/* Expectancy */}
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-xs font-medium text-zinc-500">Expectancy:</span>
                <span className={`text-sm font-bold tabular-nums ${expectancyColor(b.expectancy)}`}>
                  {b.expectancy > 0 ? "+" : ""}{b.expectancy.toFixed(3)}%
                </span>
              </div>

              {/* Sample progress */}
              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between text-[10px]">
                  <span className="text-zinc-500">
                    Samples: {decided} / {b.minSampleRequired}
                  </span>
                  {b.sampleSufficient ? (
                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle className="size-3" /> Sufficient
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="size-3" /> Need {b.minSampleRequired - decided} more
                    </span>
                  )}
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800/80">
                  <div
                    className={`h-full rounded-full transition-all ${b.sampleSufficient ? "bg-emerald-500" : "bg-amber-500"}`}
                    style={{ width: `${Math.min(100, (decided / b.minSampleRequired) * 100)}%` }}
                  />
                </div>
              </div>

              {/* Win/Loss/Neutral counts */}
              <div className="mt-3 flex items-center gap-3 text-[10px]">
                <span className="text-emerald-600 dark:text-emerald-400">{b.success} W</span>
                <span className="text-rose-600 dark:text-rose-400">{b.failed} L</span>
                <span className="text-zinc-500">{b.neutral} N</span>
                {b.pending > 0 && (
                  <span className="text-amber-600 dark:text-amber-400">{b.pending} P</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Detailed Stats */}
      {metrics && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Movement Stats */}
          <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-5">
            <div className="mb-4 flex items-center gap-2">
              <TrendingUp className="size-4 text-emerald-500" />
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                Movement Stats {selectedBucket ? `(${BUCKET_STYLE[selectedBucket]?.label ?? selectedBucket})` : "(All)"}
              </h2>
            </div>
            {(() => {
              const buckets = selectedBucket
                ? metrics.buckets.filter((b) => b.bucket === selectedBucket)
                : metrics.buckets;
              const totals = buckets.reduce(
                (acc, b) => ({
                  avgGain: acc.avgGain + b.avgGain * b.success,
                  avgLoss: acc.avgLoss + b.avgLoss * b.failed,
                  avgMaxProfit: acc.avgMaxProfit + b.avgMaxProfit * (b.success + b.failed + b.neutral),
                  avgMaxDrawdown: acc.avgMaxDrawdown + b.avgMaxDrawdown * (b.success + b.failed + b.neutral),
                  successCount: acc.successCount + b.success,
                  failedCount: acc.failedCount + b.failed,
                  evalCount: acc.evalCount + b.success + b.failed + b.neutral,
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

          {/* By Outlook */}
          <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-5">
            <div className="mb-4 flex items-center gap-2">
              <Shield className="size-4 text-purple-500" />
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                By Outlook {selectedBucket ? `(${BUCKET_STYLE[selectedBucket]?.label ?? selectedBucket})` : "(All)"}
              </h2>
            </div>
            <div className="space-y-2.5">
              {["BREAKOUT_LIKELY", "BOUNCE_EXPECTED", "REJECTION_POSSIBLE", "BREAKDOWN_RISK"].map((outlook) => {
                const buckets = selectedBucket
                  ? metrics.buckets.filter((b) => b.bucket === selectedBucket)
                  : metrics.buckets;
                const totals = buckets.reduce(
                  (acc, b) => {
                    const o = b.byOutlook[outlook];
                    return o ? { total: acc.total + o.total, wins: acc.wins + o.wins } : acc;
                  },
                  { total: 0, wins: 0 },
                );
                const rate = totals.total > 0 ? Math.round((totals.wins / totals.total) * 100) : 0;

                return (
                  <div key={outlook} className="flex items-center justify-between text-xs">
                    <span className="text-zinc-600 dark:text-zinc-400">{OUTLOOK_LABEL[outlook] ?? outlook}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-zinc-500 tabular-nums">{totals.total} signals</span>
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

      {/* Signals Table */}
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-cyan-500" />
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
              Recent Signals
            </h2>
            <span className="text-[10px] text-zinc-500">{filteredSignals.length} records</span>
          </div>
          {selectedBucket && (
            <button
              onClick={() => setSelectedBucket(null)}
              className="text-[10px] font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Clear filter
            </button>
          )}
        </div>

        {filteredSignals.length === 0 ? (
          <div className="py-12 text-center text-sm text-zinc-500">
            No signals recorded yet. Tracking starts during market hours when confidence ≥ 0.5.
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
                  const statusStyle = STATUS_STYLE[s.status] ?? STATUS_STYLE.PENDING;
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
                          {s.status}
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
