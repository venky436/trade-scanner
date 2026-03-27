"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Target, TrendingUp, TrendingDown, Activity } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";

interface AccuracyMetrics {
  date: string;
  total: number;
  pending: number;
  success: number;
  failed: number;
  neutral: number;
  accuracy: number;
  winRateByType: Record<string, { total: number; wins: number; rate: number }>;
  avgGain: number;
  avgLoss: number;
  riskReward: number;
}

interface SignalRecord {
  id: number;
  symbol: string;
  signalType: string;
  action: string;
  signalScore: number;
  entryPrice: string;
  entryTime: string;
  targetPrice: string;
  stopLoss: string;
  evaluationTime: string;
  maxPrice: string | null;
  minPrice: string | null;
  finalPrice: string | null;
  result: string | null;
}

const TYPE_COLORS: Record<string, string> = {
  BREAKOUT: "text-orange-500 bg-orange-500/10",
  BREAKDOWN: "text-red-500 bg-red-500/10",
  BOUNCE: "text-green-500 bg-green-500/10",
  REJECTION: "text-blue-500 bg-blue-500/10",
};

const RESULT_COLORS: Record<string, string> = {
  SUCCESS: "text-green-500 bg-green-500/10",
  FAILED: "text-red-500 bg-red-500/10",
  NEUTRAL: "text-zinc-400 bg-muted",
};

function getTodayIST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
}

export function AdminDashboard() {
  const [metrics, setMetrics] = useState<AccuracyMetrics | null>(null);
  const [signals, setSignals] = useState<SignalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(getTodayIST());

  const isToday = selectedDate === getTodayIST();

  useEffect(() => {
    async function fetchData() {
      try {
        const metricsUrl = isToday
          ? "/api/admin/accuracy"
          : `/api/admin/accuracy/${selectedDate}`;
        const signalsUrl = `/api/admin/accuracy/signals?date=${selectedDate}`;

        const [metricsRes, signalsRes] = await Promise.all([
          apiFetch(metricsUrl),
          apiFetch(signalsUrl),
        ]);

        if (metricsRes.ok) {
          const data = await metricsRes.json();
          if (data.total !== undefined) setMetrics(data);
          else setMetrics(null);
        }

        if (signalsRes.ok) {
          const data = await signalsRes.json();
          setSignals(data.signals ?? []);
        }
      } catch {
        // ignore
      }
      setLoading(false);
    }

    setLoading(true);
    fetchData();
    // Only auto-refresh for today's data
    const interval = isToday ? setInterval(fetchData, 30_000) : null;
    return () => { if (interval) clearInterval(interval); };
  }, [selectedDate, isToday]);

  return (
    <main className="min-h-screen bg-background p-4 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft className="size-4" />
          Back to Scanner
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Signal Accuracy Dashboard</h1>
            <p className="text-sm text-muted-foreground">Admin only — production signal performance tracking</p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={selectedDate}
              max={getTodayIST()}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-1.5 rounded-md border border-border bg-background text-sm text-foreground"
            />
            {!isToday && (
              <button
                onClick={() => setSelectedDate(getTodayIST())}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Today
              </button>
            )}
            {isToday && (
              <span className="text-xs text-muted-foreground">Live</span>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-center py-12">Loading metrics...</p>
      ) : !metrics || metrics.total === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Target className="size-12 mx-auto mb-4 text-muted-foreground/30" />
          <p className="text-lg font-medium">No signals tracked yet</p>
          <p className="text-sm mt-1">Signals with score ≥ 8 will be automatically tracked during market hours</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Performance Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label="Total Signals"
              value={metrics.total}
              icon={<Activity className="size-4 text-blue-500" />}
            />
            <StatCard
              label="Accuracy"
              value={`${metrics.accuracy}%`}
              icon={<Target className="size-4 text-green-500" />}
              valueColor={metrics.accuracy >= 60 ? "text-green-500" : metrics.accuracy >= 40 ? "text-yellow-500" : "text-red-500"}
            />
            <StatCard
              label="Avg Gain"
              value={`+${metrics.avgGain}%`}
              icon={<TrendingUp className="size-4 text-green-500" />}
              valueColor="text-green-500"
            />
            <StatCard
              label="Avg Loss"
              value={`${metrics.avgLoss}%`}
              icon={<TrendingDown className="size-4 text-red-500" />}
              valueColor="text-red-500"
            />
          </div>

          {/* Results breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Results pie */}
            <Card className="border-border/50">
              <CardContent className="p-5 space-y-4">
                <h3 className="text-sm font-semibold">{isToday ? "Today's" : new Date(selectedDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })} Results</h3>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="space-y-1">
                    <span className="text-2xl font-bold text-green-500">{metrics.success}</span>
                    <p className="text-xs text-muted-foreground">Success</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-2xl font-bold text-red-500">{metrics.failed}</span>
                    <p className="text-xs text-muted-foreground">Failed</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-2xl font-bold text-zinc-400">{metrics.neutral}</span>
                    <p className="text-xs text-muted-foreground">Neutral</p>
                  </div>
                </div>
                {metrics.pending > 0 && (
                  <p className="text-xs text-muted-foreground text-center">
                    {metrics.pending} pending evaluation
                  </p>
                )}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Risk/Reward Ratio</span>
                    <span className="font-semibold text-foreground">{metrics.riskReward}x</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Win rate by type */}
            <Card className="border-border/50">
              <CardContent className="p-5 space-y-4">
                <h3 className="text-sm font-semibold">Win Rate by Type</h3>
                <div className="space-y-3">
                  {Object.entries(metrics.winRateByType).map(([type, data]) => (
                    <div key={type} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className={`font-semibold uppercase ${TYPE_COLORS[type]?.split(" ")[0] ?? "text-foreground"}`}>
                          {type}
                        </span>
                        <span className="text-muted-foreground">
                          {data.wins}/{data.total} ({data.rate}%)
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${
                            data.rate >= 60 ? "bg-green-500" : data.rate >= 40 ? "bg-yellow-500" : "bg-red-500"
                          }`}
                          style={{ width: `${data.rate}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent Signals Table */}
          <Card className="border-border/50">
            <CardContent className="p-5">
              <h3 className="text-sm font-semibold mb-4">Recent Signals</h3>
              {signals.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No signals recorded yet</p>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-card">
                      <tr className="border-b border-border/50 text-muted-foreground">
                        <th className="text-left py-2 px-2">Symbol</th>
                        <th className="text-center py-2 px-2">Type</th>
                        <th className="text-center py-2 px-2">Action</th>
                        <th className="text-center py-2 px-2">Score</th>
                        <th className="text-right py-2 px-2">Entry</th>
                        <th className="text-right py-2 px-2">Target</th>
                        <th className="text-right py-2 px-2">SL</th>
                        <th className="text-right py-2 px-2">Final</th>
                        <th className="text-center py-2 px-2">Result</th>
                        <th className="text-right py-2 px-2">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {signals.map((s) => (
                        <tr key={s.id} className="border-b border-border/30 hover:bg-muted/30">
                          <td className="py-2 px-2 font-medium">{s.symbol}</td>
                          <td className="py-2 px-2 text-center">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${TYPE_COLORS[s.signalType] ?? ""}`}>
                              {s.signalType}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <span className={s.action === "BUY" ? "text-green-500" : "text-red-500"}>
                              {s.action}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-center font-bold">{s.signalScore}</td>
                          <td className="py-2 px-2 text-right font-mono">₹{Number(s.entryPrice).toFixed(2)}</td>
                          <td className="py-2 px-2 text-right font-mono text-green-600 dark:text-green-400">₹{Number(s.targetPrice).toFixed(2)}</td>
                          <td className="py-2 px-2 text-right font-mono text-red-600 dark:text-red-400">₹{Number(s.stopLoss).toFixed(2)}</td>
                          <td className="py-2 px-2 text-right font-mono">
                            {s.finalPrice ? `₹${Number(s.finalPrice).toFixed(2)}` : "—"}
                          </td>
                          <td className="py-2 px-2 text-center">
                            {s.result ? (
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${RESULT_COLORS[s.result] ?? ""}`}>
                                {s.result}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">Pending</span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-right text-muted-foreground">
                            {new Date(s.entryTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </main>
  );
}

function StatCard({
  label,
  value,
  icon,
  valueColor,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  valueColor?: string;
}) {
  return (
    <Card className="border-border/50">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <p className={`text-2xl font-bold tabular-nums ${valueColor ?? "text-foreground"}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
