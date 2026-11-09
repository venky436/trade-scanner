"use client";

/**
 * Auto trading (paper only) — on/off switch, the rules it follows, what it is
 * doing right now, and its recent orders. The server does the trading; this
 * panel only shows it and flips the switch.
 */
import { useState } from "react";
import { Bot } from "lucide-react";
import { timeIst, tradingApi, type AutoTraderStatus } from "@/lib/trading";
import { usePolling } from "./ui";
import { TRADE_PLACED_EVENT } from "./order-window";

export function AutoTraderPanel() {
  const [status, setStatus] = useState<AutoTraderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastPlacedAt, setLastPlacedAt] = useState(0);

  usePolling(() => {
    tradingApi
      .auto()
      .then((s) => {
        setStatus(s);
        setError(null);
        // let the trades table refresh as soon as an auto order goes in
        const newest = s.activity.find((a) => a.action === "PLACED")?.at ?? 0;
        if (newest > lastPlacedAt) {
          if (lastPlacedAt > 0) window.dispatchEvent(new Event(TRADE_PLACED_EVENT));
          setLastPlacedAt(newest);
        }
      })
      .catch((e) => setError((e as Error).message));
  }, 4000, [lastPlacedAt]);

  async function toggle() {
    if (!status) return;
    setSaving(true);
    try {
      setStatus(await tradingApi.setAuto(!status.enabled));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const live = status?.mode === "LIVE";

  return (
    <section className="rounded-xl border border-border bg-card px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <Bot className={`size-5 mt-0.5 ${status?.active ? "text-sky-400" : "text-muted-foreground"}`} />
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Auto trading <span className="font-normal text-muted-foreground">(paper money only)</span>
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {status
                ? `Takes ready setups (09:30–14:00, volume ≥ 1.2× average) at ${Math.round(status.minConfidence * 100)}%+ confidence with their stop-loss and target, ${status.quantity} shares each. At most ${status.maxActive} trades open at once; waits for one to close before the next. Won't re-enter a stock for ${status.cooldownMinutes} min.`
                : "Loading…"}
            </p>
          </div>
        </div>
        {status && (
          <button
            role="switch"
            aria-checked={status.enabled}
            disabled={saving}
            onClick={() => void toggle()}
            className={`inline-flex items-center gap-2 h-8 px-3 rounded-md text-xs font-medium transition-colors disabled:opacity-60 ${
              status.enabled ? "bg-sky-500/15 text-sky-300 hover:bg-sky-500/25" : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className={`relative h-4 w-7 rounded-full ${status.enabled ? "bg-sky-500" : "bg-muted-foreground/40"}`}>
              <span className={`absolute top-0.5 size-3 rounded-full bg-white transition-all ${status.enabled ? "left-3.5" : "left-0.5"}`} />
            </span>
            {status.enabled ? "On" : "Off"}
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
      {status && (
        <div className="mt-3 border-t border-border pt-2.5 text-xs">
          <p className={live ? "text-amber-400" : "text-foreground"}>
            {live ? "The server is in LIVE mode, so auto trading is paused. It never uses real money." : status.note || "Starting…"}
          </p>
          {status.activity.length > 0 && (
            <ul className="mt-2 space-y-1">
              {status.activity.slice(0, 5).map((a) => (
                <li key={`${a.at}-${a.symbol}`} className="flex gap-2 text-muted-foreground">
                  <span className="tabular-nums">{timeIst(new Date(a.at).toISOString()).slice(0, 5)}</span>
                  <span className={a.action === "PLACED" ? "text-emerald-400" : "text-rose-400"}>{a.action === "PLACED" ? "Placed" : "Not placed"}</span>
                  <span className="font-medium text-foreground">{a.symbol}</span>
                  <span className="truncate">{a.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
