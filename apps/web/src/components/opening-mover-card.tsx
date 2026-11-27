"use client";

import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { OpeningCandle, OpeningMover } from "@/lib/types";

const fmtPrice = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

function CandleRow({ label, c }: { label: string; c: OpeningCandle }) {
  const green = c.close >= c.open;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-zinc-500">{label}</span>
      <span className="tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
        closed {fmtPrice(c.close)}
        <span className={`ml-1.5 inline-block size-2 rounded-sm align-middle ${green ? "bg-emerald-500" : "bg-rose-500"}`} aria-label={green ? "green candle" : "red candle"} />
      </span>
    </div>
  );
}

/** One stock in Opening Movers: BUY / SELL from the 09:15 candle. */
export function OpeningMoverCard({ data }: { data: OpeningMover }) {
  const buy = data.side === "BUY";
  const Icon = buy ? ArrowUpRight : ArrowDownRight;
  const tone = buy ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
  return (
    <Link
      href={`/stock/${encodeURIComponent(data.symbol)}`}
      className={`group block rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-5 transition-colors ${buy ? "hover:border-emerald-500/45" : "hover:border-rose-500/45"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-bold text-zinc-900 dark:text-zinc-50">{data.symbol}</div>
          <div className="mt-0.5 text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
            {data.ltp != null ? fmtPrice(data.ltp) : "—"}
            {data.sinceSignalPct != null && (
              <span className={data.sinceSignalPct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
                {" "}
                {signed(data.sinceSignalPct)} since 09:20
              </span>
            )}
          </div>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-bold text-white ${buy ? "bg-emerald-600" : "bg-rose-600"}`}
        >
          <Icon className="size-3.5" strokeWidth={2.6} />
          {data.side}
        </span>
      </div>

      <div className="mt-4 space-y-1.5 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-zinc-500">Yesterday&apos;s close</span>
          <span className="tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">{fmtPrice(data.prevClose)}</span>
        </div>
        <CandleRow label="09:15 candle" c={data.c1} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div>
          <div className="text-zinc-500">Move by 09:20</div>
          <div className={`mt-0.5 font-semibold tabular-nums ${tone}`}>{signed(data.movePct)}</div>
        </div>
        <div>
          <div className="text-zinc-500">Volume vs normal</div>
          <div className="mt-0.5 font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{data.volumeX.toFixed(1)}×</div>
        </div>
      </div>
    </Link>
  );
}
