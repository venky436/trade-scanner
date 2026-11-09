"use client";

/**
 * Navbar balance for the CURRENT mode (global Paper / Real switch):
 *   Real  → your Zerodha "Available margin" and today's P&L
 *   Paper → the paper balance and today's paper P&L
 * Click for the breakdown. Refreshes every 20 s and right after a mode switch.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Wallet } from "lucide-react";
import { useOrderWindow } from "./order-window";
import { useTradeMode } from "./trade-mode";
import { inr, pnlTone, signedInr, tradingApi, type AccountSnapshot } from "@/lib/trading";

/** Poll the Zerodha account while the tab is visible. */
export function useAccount(pollMs = 20_000) {
  const { mode } = useTradeMode();
  const [account, setAccount] = useState<AccountSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setAccount(null); // don't show the other mode's money while reloading
    const load = () =>
      tradingApi
        .account()
        .then((a) => {
          if (!active) return;
          setAccount(a);
          setError(null);
        })
        .catch((e: Error) => active && setError(e.message));
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, pollMs);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [pollMs, mode]);
  // never show numbers from the other mode
  return { account: account && mode && account.mode !== mode ? null : account, error };
}

export function AccountChip() {
  const { canTrade } = useOrderWindow();
  if (!canTrade) return null;
  return <AccountChipInner />;
}

function AccountChipInner() {
  const { account, error } = useAccount();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Not connected to Kite (or still loading) → stay out of the way
  if (!account) {
    return error ? (
      <span className="hidden lg:inline-flex items-center gap-1.5 text-xs text-muted-foreground" title={error}>
        <Wallet className="size-3.5" />—
      </span>
    ) : null;
  }

  const { funds, totals } = account;
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={account.mode === "PAPER" ? "Paper balance and today's paper P&L" : "Zerodha balance and today's P&L"}
        className="h-8 inline-flex items-center gap-2 rounded-lg border border-border/50 px-2.5 text-xs tabular-nums hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Wallet className={`size-3.5 ${account.mode === "PAPER" ? "text-amber-400" : "text-muted-foreground"}`} />
        <span className="font-semibold text-foreground">{inr(funds.available)}</span>
        {account.mode === "PAPER" && <span className="text-[10px] font-medium text-amber-400">paper</span>}
        {totals.pnl !== 0 && <span className={`hidden sm:inline font-medium ${pnlTone(totals.pnl)}`}>{signedInr(totals.pnl)}</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-border bg-card shadow-2xl shadow-black/30 z-50 overflow-hidden">
          <div className="px-4 pt-3 pb-2">
            <div className="text-xs text-muted-foreground">{account.mode === "PAPER" ? "Paper money available" : "Available margin"}</div>
            <div className="text-2xl font-semibold tabular-nums text-foreground">{inr(funds.available)}</div>
            {account.mode === "LIVE" && funds.available <= 0 && <p className="mt-1 text-xs text-amber-400">Add funds in Kite to place live orders.</p>}
          </div>
          <dl className="px-4 pb-3 space-y-1.5 text-sm tabular-nums">
            <Line label="Used margin" value={inr(funds.usedMargin)} />
            {account.mode === "PAPER" && <Line label="Paper balance" value={inr(funds.cash)} />}
            <Line label="Opening balance" value={inr(funds.openingBalance)} />
            {funds.addedToday > 0 && <Line label="Added today" value={inr(funds.addedToday)} />}
            {funds.collateral > 0 && <Line label="Collateral" value={inr(funds.collateral)} />}
          </dl>
          <div className="border-t border-border px-4 py-3 space-y-1.5 text-sm tabular-nums">
            <Line label="Today's P&L" value={signedInr(totals.pnl)} tone={pnlTone(totals.pnl)} strong />
            <Line label="Booked" value={signedInr(totals.realised)} tone={pnlTone(totals.realised)} />
            <Line label="Open positions" value={`${signedInr(totals.unrealised)} (${totals.openPositions})`} tone={pnlTone(totals.unrealised)} />
          </div>
          <Link
            href="/account"
            onClick={() => setOpen(false)}
            className="block border-t border-border px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40"
          >
            Account details
          </Link>
        </div>
      )}
    </div>
  );
}

function Line({ label, value, tone, strong }: { label: string; value: string; tone?: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`${tone ?? "text-foreground"} ${strong ? "font-semibold" : ""}`}>{value}</dd>
    </div>
  );
}
