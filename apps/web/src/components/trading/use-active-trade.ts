"use client";

// Your ACTIVE trade on one stock (if any) — for drawing entry / stop-loss /
// target lines on its chart. Returns null when there is no active trade.
import { useEffect, useState } from "react";
import { ACTIVE_STATUSES, tradingApi, type Trade } from "@/lib/trading";
import { TRADE_PLACED_EVENT, useOrderWindow } from "./order-window";
import { useTradeMode } from "./trade-mode";
import type { TradeLevels } from "../candlestick-chart";

export function useActiveTradeLevels(symbol: string): TradeLevels | null {
  const { canTrade } = useOrderWindow();
  const { mode } = useTradeMode();
  const [trade, setTrade] = useState<Trade | null>(null);

  useEffect(() => {
    if (!canTrade || !mode) return;
    setTrade(null);
    let alive = true;
    const load = () =>
      tradingApi
        .list("today", mode, "active")
        .then(({ trades }) => {
          if (!alive) return;
          setTrade(trades.find((t) => t.symbol === symbol && ACTIVE_STATUSES.has(t.status)) ?? null);
        })
        .catch(() => {});
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 5000);
    window.addEventListener(TRADE_PLACED_EVENT, load);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener(TRADE_PLACED_EVENT, load);
    };
  }, [symbol, canTrade, mode]);

  if (!trade) return null;
  return { side: trade.side, entry: trade.entryPrice, stopLoss: trade.stopLoss, target: trade.target };
}
