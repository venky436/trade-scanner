"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, Eye } from "lucide-react";
import type { StockData, MomentumSignal, PressureSignal } from "@/lib/types";
import { apiFetch } from "@/lib/api";

interface WatchZoneItem {
  id: number;
  symbol: string;
  addedPrice: string;
  signalAction: string;
  signalType: string | null;
  addedAt: string;
}

type WatchStatus = "ACTIVE" | "WEAKENING" | "EXPIRED";

interface WatchZoneProps {
  stockMap: Map<string, StockData>;
  isLoggedIn: boolean;
}

function getTimeSince(addedAt: string): string {
  const diff = Date.now() - new Date(addedAt).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  return `${hrs}h ${min % 60}m ago`;
}

function computeStatus(
  item: WatchZoneItem,
  stock: StockData | undefined,
): WatchStatus {
  if (!stock) return "EXPIRED";

  const addedPrice = Number(item.addedPrice);
  const currentPrice = stock.price;
  const isBuy = item.signalAction === "BUY";

  const mom = stock.momentum?.signal;
  const pres = stock.pressure?.signal;

  // Momentum aligned?
  const momAligned = isBuy
    ? (mom === "UP" || mom === "STRONG_UP")
    : (mom === "DOWN" || mom === "STRONG_DOWN");

  // Pressure aligned?
  const presAligned = isBuy
    ? (pres === "BUY" || pres === "STRONG_BUY")
    : (pres === "SELL" || pres === "STRONG_SELL");

  // Price in direction? (with 0.3% buffer for EXPIRED)
  const priceInDirection = isBuy
    ? currentPrice >= addedPrice
    : currentPrice <= addedPrice;

  const priceAgainst = isBuy
    ? currentPrice < addedPrice * 0.997
    : currentPrice > addedPrice * 1.003;

  // Momentum AND pressure both flipped
  const momFlipped = isBuy
    ? (mom === "DOWN" || mom === "STRONG_DOWN")
    : (mom === "UP" || mom === "STRONG_UP");
  const presFlipped = isBuy
    ? (pres === "SELL" || pres === "STRONG_SELL")
    : (pres === "BUY" || pres === "STRONG_BUY");

  // EXPIRED: price against direction (with buffer) OR both engines flipped
  if (priceAgainst || (momFlipped && presFlipped)) {
    return "EXPIRED";
  }

  // ACTIVE: price in direction + momentum aligned + pressure aligned
  if (priceInDirection && momAligned && presAligned) {
    return "ACTIVE";
  }

  // WEAKENING: anything else (momentum/pressure/acceleration not fully aligned)
  return "WEAKENING";
}

const statusConfig = {
  ACTIVE: { color: "text-green-400", bg: "bg-green-500/8", ring: "ring-green-500/15", dot: "bg-green-400", label: "Active" },
  WEAKENING: { color: "text-yellow-400", bg: "bg-yellow-500/8", ring: "ring-yellow-500/15", dot: "bg-yellow-400", label: "Weakening" },
  EXPIRED: { color: "text-red-400", bg: "bg-red-500/8", ring: "ring-red-500/15", dot: "bg-red-400", label: "Expired" },
};

const statusOrder: Record<WatchStatus, number> = { ACTIVE: 0, WEAKENING: 1, EXPIRED: 2 };

function signalTypeLabel(type: string | null): string {
  if (!type) return "";
  switch (type) {
    case "BOUNCE": return "Support Bounce";
    case "REJECTION": return "Resistance Rejection";
    case "BREAKOUT": return "Breakout";
    case "BREAKDOWN": return "Breakdown";
    case "CONTINUATION": return "Trend";
    default: return type;
  }
}

export function WatchZone({ stockMap, isLoggedIn }: WatchZoneProps) {
  const router = useRouter();
  const [items, setItems] = useState<WatchZoneItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchItems = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      const res = await apiFetch("/api/watch-zone");
      if (!res.ok) return;
      const data = await res.json();
      if (data.items) setItems(data.items);
    } catch {
      // silently fail
    }
  }, [isLoggedIn]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const removeItem = async (symbol: string) => {
    try {
      const res = await apiFetch(`/api/watch-zone/${encodeURIComponent(symbol)}`, { method: "DELETE" });
      if (res.ok) setItems(prev => prev.filter(i => i.symbol !== symbol));
    } catch {
      // silently fail
    }
  };

  const enrichedItems = useMemo(() => {
    return items
      .map(item => ({
        ...item,
        stock: stockMap.get(item.symbol),
        status: computeStatus(item, stockMap.get(item.symbol)),
      }))
      .sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
  }, [items, stockMap]);

  if (!isLoggedIn || items.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye className="size-4 text-cyan-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Watch Zone
          </h2>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full ring-1 text-cyan-400/70 ring-cyan-500/20 bg-cyan-500/8">
            {items.length}/10
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {enrichedItems.map(({ stock, status, ...item }) => {
          const cfg = statusConfig[status];
          const addedPrice = Number(item.addedPrice);
          const currentPrice = stock?.price ?? 0;
          const pnl = item.signalAction === "BUY"
            ? ((currentPrice - addedPrice) / addedPrice) * 100
            : ((addedPrice - currentPrice) / addedPrice) * 100;
          const pnlPositive = pnl >= 0;

          return (
            <div
              key={item.id}
              className={`relative rounded-2xl backdrop-blur-xl bg-white/[0.02] border border-border/20 border-l-[3px] ${
                status === "ACTIVE" ? "border-l-green-500" :
                status === "WEAKENING" ? "border-l-yellow-500" :
                "border-l-red-500"
              } cursor-pointer`}
              onClick={() => router.push(`/stock/${encodeURIComponent(item.symbol)}`)}
            >
              <div className="p-3 space-y-2">
                {/* Header: Status + Symbol + Remove */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block h-2 w-2 rounded-full ${cfg.dot}`} />
                    <span className="text-sm font-bold text-foreground">{item.symbol}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.color} ring-1 ${cfg.ring}`}>
                      {cfg.label}
                    </span>
                  </div>
                  <button
                    className="text-muted-foreground/40 hover:text-red-400 transition-colors p-1"
                    onClick={(e) => { e.stopPropagation(); removeItem(item.symbol); }}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>

                {/* Signal + Price + P&L */}
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className={`font-bold ${item.signalAction === "BUY" ? "text-green-400" : "text-red-400"}`}>
                      {item.signalAction}
                    </span>
                    {item.signalType && (
                      <span className="text-muted-foreground/50">({signalTypeLabel(item.signalType)})</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono tabular-nums text-foreground">
                      ₹{currentPrice.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span className={`font-mono tabular-nums font-bold ${pnlPositive ? "text-green-400" : "text-red-400"}`}>
                      {pnlPositive ? "+" : ""}{pnl.toFixed(2)}%
                    </span>
                  </div>
                </div>

                {/* Context: engines + time */}
                <div className="flex items-center justify-between text-[10px] text-muted-foreground/50">
                  <div className="flex items-center gap-2">
                    {stock?.momentum && (
                      <span className={
                        stock.momentum.signal.includes("UP") ? "text-green-400/60" :
                        stock.momentum.signal.includes("DOWN") ? "text-red-400/60" :
                        ""
                      }>
                        {stock.momentum.signal === "STRONG_UP" ? "Strong Up" :
                         stock.momentum.signal === "UP" ? "Up" :
                         stock.momentum.signal === "FLAT" ? "Flat" :
                         stock.momentum.signal === "DOWN" ? "Down" :
                         stock.momentum.signal === "STRONG_DOWN" ? "Strong Down" : ""}
                      </span>
                    )}
                    {stock?.pressure && (
                      <span className={
                        stock.pressure.signal.includes("BUY") ? "text-green-400/60" :
                        stock.pressure.signal.includes("SELL") ? "text-red-400/60" :
                        ""
                      }>
                        {stock.pressure.signal === "STRONG_BUY" ? "Strong Buy" :
                         stock.pressure.signal === "BUY" ? "Buy" :
                         stock.pressure.signal === "NEUTRAL" ? "Neutral" :
                         stock.pressure.signal === "SELL" ? "Sell" :
                         stock.pressure.signal === "STRONG_SELL" ? "Strong Sell" : ""}
                      </span>
                    )}
                  </div>
                  <span>Added {getTimeSince(item.addedAt)} at ₹{addedPrice.toFixed(2)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Add to Watch Zone button (used by other components) ──

interface AddToWatchZoneProps {
  symbol: string;
  price: number;
  signalAction: string;
  signalType?: string;
  isLoggedIn: boolean;
  onAdded?: () => void;
}

export function AddToWatchZoneButton({ symbol, price, signalAction, signalType, isLoggedIn, onAdded }: AddToWatchZoneProps) {
  const [added, setAdded] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!isLoggedIn || !signalAction || signalAction === "WAIT") return null;

  const handleAdd = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (added || loading) return;
    setLoading(true);
    try {
      const res = await apiFetch("/api/watch-zone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, addedPrice: price, signalAction, signalType }),
      });
      if (res.ok) {
        setAdded(true);
        onAdded?.();
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      className={`flex items-center justify-center size-6 rounded-full transition-colors ${
        added
          ? "bg-cyan-500/20 text-cyan-400"
          : "bg-white/[0.04] text-muted-foreground/40 hover:text-cyan-400 hover:bg-cyan-500/10"
      }`}
      onClick={handleAdd}
      title={added ? "Added to Watch Zone" : "Add to Watch Zone"}
    >
      {added ? <Eye className="size-3" /> : <Plus className="size-3" />}
    </button>
  );
}
