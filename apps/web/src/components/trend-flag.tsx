"use client";

import { CandlestickChart, TrendingDown, TrendingUp } from "lucide-react";
import { useStockFlags } from "@/hooks/use-trend-map";

/** Only on stocks with at least this confidence (user request). */
export const TREND_FLAG_MIN_CONFIDENCE = 0.75;

const PATTERN_NAME: Record<string, string> = {
  HAMMER: "Hammer",
  INVERTED_HAMMER: "Inverted Hammer",
  DRAGONFLY_DOJI: "Dragonfly Doji",
  BULLISH_ENGULFING: "Bullish Engulfing",
  PIERCING_LINE: "Piercing Line",
  TWEEZER_BOTTOM: "Tweezer Bottom",
  MORNING_STAR: "Morning Star",
  TWO_STRONG_GREEN: "2 strong green candles",
  SHOOTING_STAR: "Shooting Star",
  HANGING_MAN: "Hanging Man",
  GRAVESTONE_DOJI: "Gravestone Doji",
  BEARISH_ENGULFING: "Bearish Engulfing",
  DARK_CLOUD_COVER: "Dark Cloud Cover",
  TWEEZER_TOP: "Tweezer Top",
  EVENING_STAR: "Evening Star",
  TWO_STRONG_RED: "2 strong red candles",
};
const UP_CLS = "border-emerald-400/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
const DOWN_CLS = "border-rose-400/50 bg-rose-500/10 text-rose-700 dark:text-rose-300";
const fmtTime = (s: number) => new Date(s * 1000).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

/**
 * Display-only flags for a stock with confidence ≥ 75 %:
 *  - TREND: forming / confirmed higher highs & higher lows (▲) or lower highs & lower lows (▼)
 *  - PATTERN: a candlestick reversal pattern at one of today's support / resistance lines (last 15 min)
 * Changes no engine, score or call.
 */
export function TrendFlagChip({ symbol, confidence, className = "" }: { symbol: string; confidence: number; className?: string }) {
  const { trend: t, pattern: p } = useStockFlags(symbol);
  if (confidence < TREND_FLAG_MIN_CONFIDENCE || (!t && !p)) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {t && (
        <span
          title={`${t.trend === "UP" ? "Uptrend" : "Downtrend"} ${t.stage === "CONFIRMED" ? "confirmed" : "forming"}: ${t.trend === "UP" ? "higher highs & higher lows" : "lower highs & lower lows"} — moved ${t.movePct.toFixed(1)}% since it began`}
          className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${t.trend === "UP" ? UP_CLS : DOWN_CLS}`}
        >
          {t.trend === "UP" ? <TrendingUp className="size-3" strokeWidth={2.6} /> : <TrendingDown className="size-3" strokeWidth={2.6} />}
          {t.trend === "UP" ? "Uptrend" : "Downtrend"}
          {t.stage === "EARLY" ? " forming" : ""}
          {t.sequence.length > 0 && <span className="font-bold tabular-nums opacity-80">· {t.sequence.join(" ")}</span>}
        </span>
      )}
      {p && (
        <span
          title={`${PATTERN_NAME[p.pattern] ?? p.pattern} (${p.side === "BULLISH" ? "bullish" : "bearish"} reversal pattern) at ${p.line} ₹${p.level.toFixed(2)}, completed ${fmtTime(p.time)}`}
          className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${p.side === "BULLISH" ? UP_CLS : DOWN_CLS}`}
        >
          <CandlestickChart className="size-3" strokeWidth={2.4} />
          {PATTERN_NAME[p.pattern] ?? p.pattern} at {p.line}
          <span className="tabular-nums opacity-80">· {fmtTime(p.time)}</span>
        </span>
      )}
    </div>
  );
}
