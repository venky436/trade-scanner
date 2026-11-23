"use client";

import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { SwingLabel, TrendStock } from "@/lib/types";

const fmtTime = (s: number) =>
  new Date(s * 1000).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
const fmtPrice = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const LABEL_CLS: Record<SwingLabel, string> = {
  HH: "border-emerald-400/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  HL: "border-emerald-400/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  LH: "border-rose-400/50 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  LL: "border-rose-400/50 bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

/** One stock in the Trend Structure lane: trend, the swing sequence, latest swing high / low. */
export function TrendCard({ data }: { data: TrendStock }) {
  const up = data.trend === "UP";
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <Link
      href={`/stock/${encodeURIComponent(data.symbol)}`}
      className={`group block rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-5 transition-colors ${up ? "hover:border-emerald-500/45" : "hover:border-rose-500/45"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-bold text-zinc-900 dark:text-zinc-50">{data.symbol}</div>
          <div className="mt-0.5 text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
            {fmtPrice(data.price)}{" "}
            <span className={data.change >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
              {data.change >= 0 ? "+" : ""}
              {data.change.toFixed(2)}%
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${up ? LABEL_CLS.HH : LABEL_CLS.LL}`}
          >
            <Icon className="size-3.5" strokeWidth={2.4} />
            {up ? "Uptrend" : "Downtrend"}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              data.stage === "CONFIRMED"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "border border-amber-400/50 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            }`}
          >
            {data.stage === "CONFIRMED" ? "Confirmed" : "Early — forming"}
          </span>
        </div>
      </div>

      <div className="mt-4 flex min-h-[22px] flex-wrap items-center gap-1.5" aria-label="Swing sequence, oldest first">
        {data.sequence.map((l, i) => (
          <span key={i} className={`rounded-md border px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${LABEL_CLS[l]}`}>
            {l}
          </span>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div>
          <div className="text-zinc-500">Last swing high</div>
          <div className="mt-0.5 font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
            {data.lastHigh ? `${fmtPrice(data.lastHigh.price)} · ${fmtTime(data.lastHigh.time)}` : "—"}
          </div>
        </div>
        <div>
          <div className="text-zinc-500">Last swing low</div>
          <div className="mt-0.5 font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
            {data.lastLow ? `${fmtPrice(data.lastLow.price)} · ${fmtTime(data.lastLow.time)}` : "—"}
          </div>
        </div>
      </div>

      <div className="mt-3 text-xs text-zinc-500">
        {up ? "Up" : "Down"} {data.movePct.toFixed(1)}% since the trend began ·{" "}
        {data.steps <= 1 ? (up ? "breaking above the last high now" : "breaking below the last low now") : `${data.steps} swings in a row`}
      </div>
    </Link>
  );
}
