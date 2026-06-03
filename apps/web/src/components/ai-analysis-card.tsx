"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bot,
  CheckCircle2,
  Crosshair,
  Pause,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Target,
  XCircle,
} from "lucide-react";
import { useAiCall, useAiCalls } from "@/hooks/use-ai-calls";
import { useServerConfig } from "@/context/config-context";
import type { AiVerdict, AiVerdictAction } from "@/lib/types";

interface AiAnalysisCardProps {
  symbol: string;
  /** Pre-fired verdict from the parent (when the parent lifts the hook for
   *  earlier-on-mount POST). If omitted, the card fires its own call.  */
  verdict?: AiVerdict | null;
  isLoading?: boolean;
  error?: string | null;
  refresh?: () => void;
}

// Full AI analysis card for the stock-detail page. Shows verdict, agreement
// with rule engine, identified patterns, full reasoning, trade plan, and
// risk flags.
//
// USAGE:
//   The parent (StockDetail) lifts the useAiCall hook so the POST fires on
//   the parent's mount — earlier than this card's own mount which is gated
//   by the snapshot fetch. Pass verdict/isLoading/error/refresh as props.
//   Standalone usage falls back to the card's own hook.
//
// Self-disables (returns null) when aiModeEnabled = false.
export function AiAnalysisCard({ symbol, verdict: propVerdict, isLoading: propIsLoading, error: propError, refresh: propRefresh }: AiAnalysisCardProps) {
  const { aiModeEnabled } = useServerConfig();
  const { calls: cachedCalls } = useAiCalls();
  // Fall back to the card's own hook only when parent didn't supply one
  const fallback = useAiCall(propVerdict === undefined ? symbol : null);

  if (!aiModeEnabled) return null;

  // Prefer parent-supplied state, then card's fallback hook, then cached map
  const freshVerdict = propVerdict !== undefined ? propVerdict : fallback.verdict;
  const isLoading = propIsLoading !== undefined ? propIsLoading : fallback.isLoading;
  const error = propError !== undefined ? propError : fallback.error;
  const refresh = propRefresh ?? fallback.refresh;
  const verdict = freshVerdict ?? cachedCalls.get(symbol) ?? null;

  return (
    <section className="rounded-2xl border border-violet-200/60 bg-gradient-to-br from-violet-50/40 via-white to-white p-6 dark:border-violet-500/20 dark:from-violet-500/5 dark:via-zinc-950/60 dark:to-zinc-950/60">
      <header className="mb-4 flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/15 ring-1 ring-violet-400/30 shadow-sm">
            <Bot className="size-4 text-violet-600 dark:text-violet-300" strokeWidth={2.4} />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-wide text-zinc-900 dark:text-zinc-100">
              AI Verdict
              <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">
                Experimental
              </span>
            </h2>
            <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              AI independent analysis · refreshes every 5 min
            </p>
          </div>
        </div>
        <button
          onClick={refresh}
          disabled={isLoading}
          className="flex size-8 items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-900/40 text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-50"
          title="Force fresh AI evaluation"
        >
          <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </header>

      {/* Body */}
      {!verdict && isLoading && <PendingState />}
      {!verdict && !isLoading && error && <ErrorState error={error} />}
      {!verdict && !isLoading && !error && <PendingState text="Asking AI for an analysis of this stock…" />}
      {verdict && (
        <>
          <AiBody verdict={verdict} />
          {isLoading && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-violet-500/[0.06] border border-violet-500/20 px-3 py-1.5 text-[11px] text-violet-700 dark:text-violet-300">
              <Sparkles className="size-3 animate-pulse" />
              <span>Getting a new update from AI…</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function AiBody({ verdict }: { verdict: AiVerdict }) {
  const confPct = Math.round(verdict.confidence * 100);
  const agreesWithRule = verdict.verdict === verdict.ruleVerdict;
  return (
    <div className="space-y-4">
      {/* Verdict hero */}
      <VerdictHero
        action={verdict.verdict}
        confidence={confPct}
        ruleVerdict={verdict.ruleVerdict}
        ruleConfidence={Math.round(verdict.ruleConfidence * 100)}
        agreesWithRule={agreesWithRule}
        downgraded={verdict.downgraded}
        downgradeReason={verdict.downgradeReason}
      />

      {/* Reasoning paragraph */}
      <div>
        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
          Reasoning
        </h3>
        <p className="text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
          {verdict.reasoning}
        </p>
      </div>

      {/* Patterns + reasons */}
      {(verdict.patterns.length > 0 || verdict.reasons.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {verdict.patterns.length > 0 && (
            <ChipList label="Patterns Spotted" items={verdict.patterns} tone="emerald" />
          )}
          {verdict.reasons.length > 0 && (
            <ChipList label="Key Factors" items={verdict.reasons.map(formatReason)} tone="violet" />
          )}
        </div>
      )}

      {/* Trade plan (only when BUY/SELL) */}
      {verdict.verdict !== "WAIT" && verdict.entry != null && verdict.stopLoss != null && verdict.target != null && (
        <TradePlanGrid
          action={verdict.verdict}
          entry={verdict.entry}
          stopLoss={verdict.stopLoss}
          target={verdict.target}
          riskReward={verdict.riskReward}
        />
      )}

      {/* Risk flags */}
      {verdict.risk_flags.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.05] px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-3" />
            Risk Flags ({verdict.risk_flags.length})
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {verdict.risk_flags.map((f) => (
              <span key={f} className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                {f.replace(/_/g, " ").toLowerCase()}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Meta footer */}
      <div className="flex items-center justify-between border-t border-zinc-200/70 dark:border-zinc-800/70 pt-3 text-[10px] text-zinc-500 dark:text-zinc-500">
        <span>Market regime: <span className="font-semibold text-zinc-700 dark:text-zinc-300">{verdict.marketRegime}</span></span>
        <span>Evaluated {formatTimeAgo(verdict.computedAt)}</span>
      </div>
    </div>
  );
}

function VerdictHero({
  action,
  confidence,
  ruleVerdict,
  ruleConfidence,
  agreesWithRule,
  downgraded,
  downgradeReason,
}: {
  action: AiVerdictAction;
  confidence: number;
  ruleVerdict: AiVerdictAction;
  ruleConfidence: number;
  agreesWithRule: boolean;
  downgraded: boolean;
  downgradeReason: string | null;
}) {
  const style =
    action === "BUY"
      ? { bg: "bg-gradient-to-r from-emerald-500 to-emerald-400", text: "text-white", icon: ArrowUp }
      : action === "SELL"
      ? { bg: "bg-gradient-to-r from-rose-500 to-rose-400", text: "text-white", icon: ArrowDown }
      : { bg: "bg-zinc-200 dark:bg-zinc-800", text: "text-zinc-700 dark:text-zinc-300", icon: Pause };
  const Icon = style.icon;
  return (
    <div className="rounded-xl border border-zinc-200/60 bg-white/60 dark:border-zinc-800/60 dark:bg-zinc-900/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex size-12 items-center justify-center rounded-xl shadow-md ${style.bg}`}>
            <Icon className={`size-6 ${style.text}`} strokeWidth={3} />
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              {action}
            </div>
            <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              AI Rank <span className="font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">{confidence}%</span>
              {" · "}
              {agreesWithRule ? (
                <span className="text-emerald-600 dark:text-emerald-400">✓ agrees with rule</span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400">
                  ≠ rule says <strong>{ruleVerdict}</strong> ({ruleConfidence}%)
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
      {downgraded && downgradeReason && (
        <div className="mt-3 rounded-md bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-700 dark:text-rose-300">
          <strong>Downgraded by validator:</strong> {downgradeReason}
        </div>
      )}
    </div>
  );
}

function ChipList({ label, items, tone }: { label: string; items: string[]; tone: "emerald" | "violet" }) {
  const chipClass =
    tone === "emerald"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : "bg-violet-500/15 text-violet-700 dark:text-violet-300";
  return (
    <div>
      <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500">{label}</h3>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <span key={it} className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${chipClass}`}>
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}

function TradePlanGrid({
  action,
  entry,
  stopLoss,
  target,
  riskReward,
}: {
  action: AiVerdictAction;
  entry: number;
  stopLoss: number;
  target: number;
  riskReward: number | null;
}) {
  const slPct = ((stopLoss - entry) / entry) * 100;
  const tgtPct = ((target - entry) / entry) * 100;
  return (
    <div>
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Trade Plan</h3>
      <div className="grid grid-cols-4 gap-2 rounded-xl border border-zinc-200/60 dark:border-zinc-800/60 bg-zinc-50/60 dark:bg-zinc-900/40 p-3">
        <PlanTile label="Entry" value={`₹${entry.toFixed(2)}`} icon={<Crosshair className="size-3 text-zinc-500" />} />
        <PlanTile
          label="Stop"
          value={`₹${stopLoss.toFixed(2)}`}
          sub={`${slPct >= 0 ? "+" : ""}${slPct.toFixed(2)}%`}
          subTone={action === "BUY" ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}
          icon={<ShieldAlert className="size-3 text-rose-500" />}
        />
        <PlanTile
          label="Target"
          value={`₹${target.toFixed(2)}`}
          sub={`${tgtPct >= 0 ? "+" : ""}${tgtPct.toFixed(2)}%`}
          subTone={action === "BUY" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}
          icon={<Target className="size-3 text-emerald-500" />}
        />
        <PlanTile
          label="R:R"
          value={riskReward != null ? `${riskReward.toFixed(1)} : 1` : "—"}
        />
      </div>
    </div>
  );
}

function PlanTile({
  label,
  value,
  sub,
  subTone,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  subTone?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="px-1">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-zinc-500">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 truncate text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{value}</div>
      {sub && <div className={`text-[10px] font-semibold tabular-nums ${subTone ?? "text-zinc-500"}`}>{sub}</div>}
    </div>
  );
}

function PendingState({ text = "AI is analysing this stock…" }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
      <div className="relative flex size-12 items-center justify-center">
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-violet-500/20 to-fuchsia-500/15 animate-pulse" />
        <Bot className="relative size-6 text-violet-600 dark:text-violet-300 animate-pulse" strokeWidth={2.2} />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{text}</p>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          Reading patterns, momentum, pressure, volatility… usually takes 2–3 seconds.
        </p>
      </div>
      <div className="mt-1 flex items-center gap-1">
        <span className="size-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "0ms" }} />
        <span className="size-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "150ms" }} />
        <span className="size-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "300ms" }} />
      </div>
    </div>
  );
}

function ErrorState({ error }: { error: string }) {
  // 503 ("AI service unavailable") = backend not warmed up yet — show as
  // "warming up" instead of a scary error
  const isWarmup = error.toLowerCase().includes("unavailable");
  if (isWarmup) {
    return (
      <PendingState text="AI service is warming up… retrying shortly." />
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
      <XCircle className="size-4 shrink-0" />
      <span>AI unavailable — {error}</span>
    </div>
  );
}

function formatReason(code: string): string {
  return code.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatTimeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h} hr ago`;
}
