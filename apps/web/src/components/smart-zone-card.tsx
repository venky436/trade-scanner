"use client";

import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, RefreshCcw, TrendingDown, TrendingUp } from "lucide-react";
import type { SmartZone, SmartZoneStatus } from "@/lib/types";

const fmt = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const time = (sec: number) => new Date(sec * 1000).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

const STATUS: Record<SmartZoneStatus, { label: string; cls: string }> = {
  IN_TRADE: { label: "In trade", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/30" },
  STOPPED: { label: "Stop hit", cls: "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/30" },
  CLOSED: { label: "Closed at market close", cls: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300 ring-zinc-500/30" },
};

/** The tag on every card: Reversal BUY · Reversal SELL · Trend BUY · Trend SELL. */
export function SetupTag({ kind, side }: { kind: SmartZone["kind"]; side: SmartZone["side"] }) {
  const buy = side === "BUY";
  const rev = kind === "REVERSAL";
  const Icon = rev ? RefreshCcw : buy ? TrendingUp : TrendingDown;
  const cls = rev
    ? buy
      ? "bg-emerald-600 text-white ring-emerald-600"
      : "bg-rose-600 text-white ring-rose-600"
    : buy
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/50"
      : "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/50";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ring-1 ${cls}`}>
      <Icon className="size-3.5" strokeWidth={2.4} />
      {rev ? "Reversal" : "Trend"} {side}
    </span>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-zinc-500">{label}</span>
      <span className={`tabular-nums font-semibold text-right ${tone ?? "text-zinc-900 dark:text-zinc-100"}`}>{value}</span>
    </div>
  );
}

/** One Fair Value Gap / Order Block that came after a clear move. */
export function SmartZoneCard({ data }: { data: SmartZone }) {
  const buy = data.side === "BUY";
  const SideIcon = buy ? ArrowUpRight : ArrowDownRight;
  const st = STATUS[data.status];
  const name = data.type === "FVG" ? "Fair Value Gap" : "Order Block";
  const firstCandle = data.type === "FVG" ? "candle 1" : "block candle";
  const fell = data.move.to < data.move.from;
  // live move since entry, in the trade's direction
  const live = data.ltp != null && data.status === "IN_TRADE" ? ((buy ? 1 : -1) * (data.ltp - data.entry) * 100) / data.entry : null;
  const risk = (Math.abs(data.entry - data.stop) * 100) / data.entry;
  return (
    <Link
      href={`/stock/${encodeURIComponent(data.symbol)}`}
      className={`group block rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/60 p-5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${buy ? "hover:border-emerald-500/45" : "hover:border-rose-500/45"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 truncate text-base font-bold text-zinc-900 dark:text-zinc-50">
            {data.symbol}
            <SideIcon className={`size-4 ${buy ? "text-emerald-600" : "text-rose-600"}`} strokeWidth={2.6} aria-hidden />
          </div>
          <div className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
            {name} · entry {time(data.formedAt)}
          </div>
        </div>
        <SetupTag kind={data.kind} side={data.side} />
      </div>

      <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
        {fell ? "Fell" : "Rose"} {signed(fell ? -data.move.pct : data.move.pct).replace("+", "")} from {fmt(data.move.from)} ({time(data.move.fromAt)}) to {fmt(data.move.to)} ({time(data.move.toAt)})
        {data.kind === "REVERSAL" ? (buy ? ", then turned up." : ", then turned down.") : buy ? ", still rising." : ", still falling."}
      </p>

      <div className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${st.cls}`}>
        {st.label}
        {data.resultPct != null && ` ${signed(data.resultPct)}`}
        {data.status !== "IN_TRADE" && data.exitAt != null && ` at ${time(data.exitAt)}`}
      </div>

      <div className="mt-4 space-y-1.5 text-xs">
        <Row label="Entry (pattern's last candle close)" value={fmt(data.entry)} />
        <Row label={`Stop-loss (${firstCandle} ${buy ? "low" : "high"})`} value={`${fmt(data.stop)} · ${risk.toFixed(2)}%`} tone="text-rose-600 dark:text-rose-400" />
        <Row label={data.type === "FVG" ? "Gap" : "Block"} value={`${fmt(data.zoneBottom)} – ${fmt(data.zoneTop)}`} />
        <Row
          label="Live price"
          value={data.ltp != null ? `${fmt(data.ltp)}${live != null ? ` (${signed(live)} from entry)` : ""}` : "—"}
          tone={live == null ? undefined : live >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}
        />
      </div>
    </Link>
  );
}
