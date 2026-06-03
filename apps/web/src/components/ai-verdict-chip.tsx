"use client";

import { ArrowDown, ArrowUp, Bot, Pause, Sparkles } from "lucide-react";
import { useAiCalls } from "@/hooks/use-ai-calls";
import { useServerConfig } from "@/context/config-context";
import type { AiVerdictAction } from "@/lib/types";

interface AiVerdictChipProps {
  symbol: string;
}

const ACTION_STYLE: Record<AiVerdictAction, { bg: string; ring: string; icon: typeof ArrowUp }> = {
  BUY: {
    bg: "bg-gradient-to-r from-emerald-500 to-emerald-400 text-white shadow-sm shadow-emerald-500/30",
    ring: "ring-1 ring-emerald-300/40",
    icon: ArrowUp,
  },
  SELL: {
    bg: "bg-gradient-to-r from-rose-500 to-rose-400 text-white shadow-sm shadow-rose-500/30",
    ring: "ring-1 ring-rose-300/40",
    icon: ArrowDown,
  },
  WAIT: {
    bg: "bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300",
    ring: "ring-1 ring-zinc-300 dark:ring-zinc-700",
    icon: Pause,
  },
};

// AI verdict chip — the SOLE verdict source on each MarketCard when AI mode
// is enabled (the rule-engine chip is hidden in that mode; see VerdictSlot
// in market-card.tsx).
//
// States:
//   - AI mode OFF → null (rule chip renders instead)
//   - AI mode ON, no cached verdict for this symbol → warming-up placeholder
//   - AI mode ON, verdict cached → full chip with verdict + reasoning summary
export function AiVerdictChip({ symbol }: AiVerdictChipProps) {
  const { aiModeEnabled } = useServerConfig();
  const { calls } = useAiCalls();
  if (!aiModeEnabled) return null;
  const verdict = calls.get(symbol);

  // No verdict yet — show a calm placeholder so the card doesn't look broken.
  // The scheduler runs every 5 min, so this resolves on the next tick.
  if (!verdict) {
    return (
      <div className="mt-4 flex items-center justify-between gap-2 rounded-xl border border-violet-200/40 bg-gradient-to-br from-violet-50/30 via-white to-white px-3 py-2.5 dark:border-violet-500/15 dark:from-violet-500/[0.04] dark:via-zinc-950/40 dark:to-zinc-950/40">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-violet-500 dark:text-violet-400">
            <Bot className="size-3 animate-pulse" />
            AI
          </span>
          <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
            Analyzing this stock…
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="size-1 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="size-1 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="size-1 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    );
  }

  const action = ACTION_STYLE[verdict.verdict];
  const ActionIcon = action.icon;
  const confPct = Math.round(verdict.confidence * 100);
  const agreesWithRule = verdict.verdict === verdict.ruleVerdict;
  const reasonsLine = verdict.reasons.slice(0, 3).map(formatReason).join(" · ");

  return (
    <div className="mt-3 rounded-xl border border-violet-200/60 bg-gradient-to-br from-violet-50/60 via-white to-white px-3 py-2.5 dark:border-violet-500/20 dark:from-violet-500/5 dark:via-zinc-950/60 dark:to-zinc-950/60">
      {/* Top row — AI badge + verdict + agree marker + confidence */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300">
            <Bot className="size-3" />
            AI
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wider ${action.bg} ${action.ring}`}
          >
            <ActionIcon className="size-2.5" strokeWidth={3.5} />
            {verdict.verdict}
          </span>
          {agreesWithRule ? (
            <span title="Agrees with rule engine" className="inline-flex items-center text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
              ✓
            </span>
          ) : (
            <span title={`Disagrees — rule says ${verdict.ruleVerdict}`} className="inline-flex items-center text-[10px] font-bold text-amber-600 dark:text-amber-400">
              ≠
            </span>
          )}
        </div>
        <span className="text-[10px] font-bold tabular-nums text-zinc-600 dark:text-zinc-400">
          Rank {confPct}%
        </span>
      </div>

      {/* Reasons (top 3, truncated) */}
      {reasonsLine && (
        <div className="mt-1.5 flex items-start gap-1.5 text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          <Sparkles className="size-2.5 shrink-0 mt-0.5 text-violet-500" />
          <span className="line-clamp-1 normal-case">{reasonsLine}</span>
        </div>
      )}

      {/* Reasoning summary — 2-line clamp so the card height stays controlled */}
      <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-zinc-700 dark:text-zinc-300">
        {verdict.reasoning}
      </p>
    </div>
  );
}

// Convert AI's reason codes into shorter human-friendly labels.
function formatReason(code: string): string {
  const map: Record<string, string> = {
    SUPPORT_BOUNCE: "Bounce",
    RESISTANCE_REJECTION: "Rejection",
    BREAKOUT: "Breakout",
    BREAKDOWN: "Breakdown",
    HAMMER: "Hammer",
    ENGULFING: "Engulfing",
    MORNING_STAR: "Morning Star",
    EVENING_STAR: "Evening Star",
    BUY_PRESSURE: "Buy Pressure",
    SELL_PRESSURE: "Sell Pressure",
    STRONG_MOMENTUM: "Strong Momentum",
    MARKET_ALIGNED: "Market-Aligned",
    RVOL_SURGE: "RVOL Surge",
    STRUCTURAL_LEVEL: "Structural",
    RISK_REWARD_FAVOURABLE: "Good R:R",
  };
  return map[code] ?? code.replace(/_/g, " ").toLowerCase();
}
