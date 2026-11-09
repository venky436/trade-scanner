"use client";

/**
 * Global Paper / Real switch.
 *
 * The server owns the mode (POST /api/trade/mode, remembered across restarts);
 * this provider mirrors it for every screen. All trading screens read `mode`
 * from here, so flipping the navbar switch changes which orders, P&L and
 * balance you see everywhere — and whether NEW orders are paper or real.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
import { tradingApi, type TradeConfig, type TradeMode } from "@/lib/trading";
import { useOrderWindow } from "./order-window";

interface TradeModeValue {
  config: TradeConfig | null;
  mode: TradeMode | null;
  switchMode: (mode: TradeMode) => Promise<void>;
}

const TradeModeContext = createContext<TradeModeValue>({ config: null, mode: null, switchMode: async () => {} });

export function TradeModeProvider({ children }: { children: React.ReactNode }) {
  const { canTrade } = useOrderWindow();
  const [config, setConfig] = useState<TradeConfig | null>(null);

  const load = useCallback(() => {
    tradingApi.config().then(setConfig).catch(() => {});
  }, []);

  useEffect(() => {
    if (!canTrade) return;
    load();
    // keep tabs in sync if the mode is switched in another tab
    const t = setInterval(() => document.visibilityState === "visible" && load(), 15_000);
    return () => clearInterval(t);
  }, [canTrade, load]);

  const switchMode = useCallback(async (mode: TradeMode) => {
    setConfig(await tradingApi.setMode(mode));
  }, []);

  const value = useMemo(() => ({ config, mode: config?.mode ?? null, switchMode }), [config, switchMode]);
  return <TradeModeContext.Provider value={value}>{children}</TradeModeContext.Provider>;
}

export function useTradeMode() {
  return useContext(TradeModeContext);
}

/** Navbar switch: Paper | Real. Real asks for confirmation first. */
export function TradeModeSwitch() {
  const { canTrade } = useOrderWindow();
  const { mode, switchMode } = useTradeMode();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canTrade || !mode) return null;

  async function go(next: TradeMode) {
    setBusy(true);
    setError(null);
    try {
      await switchMode(next);
      setConfirming(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const option = (value: TradeMode, label: string, on: string) => (
    <button
      role="radio"
      aria-checked={mode === value}
      disabled={busy}
      onClick={() => (mode === value ? undefined : value === "LIVE" ? setConfirming(true) : void go("PAPER"))}
      className={`h-6 px-2.5 rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        mode === value ? on : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );

  return (
    <>
      <div role="radiogroup" aria-label="Trading mode" className="inline-flex items-center rounded-lg border border-border/50 bg-muted/40 p-0.5">
        {option("PAPER", "Paper", "bg-amber-400/15 text-amber-300")}
        {option("LIVE", "Real", "bg-rose-500/20 text-rose-300")}
      </div>

      {/* Portal to <body>: the navbar's backdrop blur would otherwise trap this
          fixed overlay inside the navbar's box and clip it. */}
      {confirming && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4" onClick={() => !busy && setConfirming(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="real-mode-title"
            className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="size-5 shrink-0 text-rose-400 mt-0.5" />
              <div>
                <h2 id="real-mode-title" className="text-base font-semibold text-foreground">Switch to real money?</h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  New orders will be sent to your Zerodha account and use your real funds. Every screen will show your real orders and balance.
                  Auto trading pauses while you are on Real.
                </p>
              </div>
            </div>
            {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                autoFocus
                disabled={busy}
                onClick={() => setConfirming(false)}
                className="h-9 px-4 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                Stay on Paper
              </button>
              <button
                disabled={busy}
                onClick={() => void go("LIVE")}
                className="h-9 px-4 rounded-md bg-rose-600 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-60"
              >
                Switch to Real
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
