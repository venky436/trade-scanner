"use client";

// Buy / Sell buttons that open the shared order window. Drop anywhere a stock is shown.
import { useOrderWindow } from "./order-window";
import { SIDE_TONE, type TradePlan, type TradeSide } from "@/lib/trading";

export function TradeButtons({
  symbol,
  plan,
  setup,
  confidence,
  size = "md",
}: {
  symbol: string;
  plan?: TradePlan | null;
  setup?: string | null;
  confidence?: number | null;
  size?: "sm" | "md";
}) {
  const { openOrder, canTrade } = useOrderWindow();
  if (!canTrade) return null;

  function open(side: TradeSide) {
    const p = plan && plan.action === side ? plan : null;
    openOrder({ symbol, side, stopLoss: p?.stopLoss, target: p?.target, setup: setup ?? null, confidence: confidence ?? null });
  }

  const h = size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-5 text-sm";
  return (
    <div className="inline-flex gap-2">
      {(["BUY", "SELL"] as const).map((side) => (
        <button
          key={side}
          onClick={() => open(side)}
          className={`${h} rounded-lg font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 ${SIDE_TONE[side].solid} ${SIDE_TONE[side].ring}`}
        >
          {side === "BUY" ? "Buy" : "Sell"}
        </button>
      ))}
    </div>
  );
}
