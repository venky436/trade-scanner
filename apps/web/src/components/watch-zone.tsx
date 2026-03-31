"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { X, Plus, Eye, ChevronRight, Check } from "lucide-react";
import type { StockData } from "@/lib/types";
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

interface WatchZoneSheetProps {
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

  const momAligned = isBuy
    ? (mom === "UP" || mom === "STRONG_UP")
    : (mom === "DOWN" || mom === "STRONG_DOWN");

  const presAligned = isBuy
    ? (pres === "BUY" || pres === "STRONG_BUY")
    : (pres === "SELL" || pres === "STRONG_SELL");

  const priceAgainst = isBuy
    ? currentPrice < addedPrice * 0.997
    : currentPrice > addedPrice * 1.003;

  const momFlipped = isBuy
    ? (mom === "DOWN" || mom === "STRONG_DOWN")
    : (mom === "UP" || mom === "STRONG_UP");
  const presFlipped = isBuy
    ? (pres === "SELL" || pres === "STRONG_SELL")
    : (pres === "BUY" || pres === "STRONG_BUY");

  const priceInDirection = isBuy
    ? currentPrice >= addedPrice
    : currentPrice <= addedPrice;

  if (priceAgainst || (momFlipped && presFlipped)) return "EXPIRED";
  if (priceInDirection && momAligned && presAligned) return "ACTIVE";
  return "WEAKENING";
}

const statusConfig = {
  ACTIVE: { color: "text-green-400", bg: "bg-green-500/8", ring: "ring-green-500/15", dot: "bg-green-400", label: "Active", border: "border-l-green-500" },
  WEAKENING: { color: "text-yellow-400", bg: "bg-yellow-500/8", ring: "ring-yellow-500/15", dot: "bg-yellow-400", label: "Weakening", border: "border-l-yellow-500" },
  EXPIRED: { color: "text-red-400", bg: "bg-red-500/8", ring: "ring-red-500/15", dot: "bg-red-400", label: "Expired", border: "border-l-red-500" },
};

const statusOrder: Record<WatchStatus, number> = { ACTIVE: 0, WEAKENING: 1, EXPIRED: 2 };

function signalTypeLabel(type: string | null): string {
  if (!type) return "";
  switch (type) {
    case "BOUNCE": return "Bounce";
    case "REJECTION": return "Rejection";
    case "BREAKOUT": return "Breakout";
    case "BREAKDOWN": return "Breakdown";
    case "CONTINUATION": return "Trend";
    default: return type;
  }
}

// ── Watch Zone Sheet (right-side panel) ──

export function WatchZoneSheet({ stockMap, isLoggedIn }: WatchZoneSheetProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<WatchZoneItem[]>([]);

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
    const handler = () => fetchItems();
    window.addEventListener("watch-zone-updated", handler);
    return () => window.removeEventListener("watch-zone-updated", handler);
  }, [fetchItems]);

  const removeItem = async (symbol: string) => {
    try {
      const res = await apiFetch(`/api/watch-zone/${encodeURIComponent(symbol)}`, { method: "DELETE" });
      if (res.ok) {
        setItems(prev => prev.filter(i => i.symbol !== symbol));
        window.dispatchEvent(new Event("watch-zone-updated"));
      }
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

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!isLoggedIn) return null;

  const sheetPortal = mounted ? createPortal(
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 transition-opacity"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sheet panel */}
      <div
        className={`fixed top-0 right-0 h-full w-[440px] max-w-[90vw] bg-zinc-950/95 backdrop-blur-xl border-l border-white/[0.06] z-50 transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <Eye className="size-4 text-green-400" />
            <h2 className="text-sm font-bold tracking-wide">Watch Zone</h2>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full ring-1 text-green-400/70 ring-green-500/20 bg-green-500/8">
              {items.length}/10
            </span>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="flex items-center justify-center size-7 rounded-lg hover:bg-white/[0.06] text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto h-[calc(100%-65px)] px-5 py-4">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Eye className="size-10 mb-3 text-muted-foreground/15" />
              <p className="text-sm font-medium text-muted-foreground">No stocks in Watch Zone</p>
              <p className="text-xs text-muted-foreground/50 mt-1 max-w-[240px]">
                Click the + button on any signal card to start tracking
              </p>
            </div>
          ) : (
            <div className="space-y-2">
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
                    className={`group relative rounded-xl bg-white/[0.02] border border-white/[0.04] border-l-[3px] ${cfg.border} cursor-pointer transition-all hover:bg-white/[0.04]`}
                    onClick={() => { router.push(`/stock/${encodeURIComponent(item.symbol)}`); setOpen(false); }}
                  >
                    <div className="p-3 space-y-2">
                      {/* Row 1: Status + Symbol + Remove */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`inline-block h-2 w-2 rounded-full ${cfg.dot}`} />
                          <span className="text-sm font-bold text-foreground">{item.symbol}</span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.color} ring-1 ${cfg.ring}`}>
                            {cfg.label}
                          </span>
                        </div>
                        <button
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-red-400 transition-all p-1"
                          onClick={(e) => { e.stopPropagation(); removeItem(item.symbol); }}
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>

                      {/* Row 2: Signal + Price + P&L */}
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className={`font-bold ${item.signalAction === "BUY" ? "text-green-400" : "text-red-400"}`}>
                            {item.signalAction}
                          </span>
                          {item.signalType && (
                            <span className="text-muted-foreground/40">({signalTypeLabel(item.signalType)})</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono tabular-nums text-foreground/80">
                            ₹{currentPrice.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                          <span className={`font-mono tabular-nums font-bold ${pnlPositive ? "text-green-400" : "text-red-400"}`}>
                            {pnlPositive ? "+" : ""}{pnl.toFixed(2)}%
                          </span>
                        </div>
                      </div>

                      {/* Row 3: Engines + Time */}
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground/40">
                        <div className="flex items-center gap-2">
                          {stock?.momentum && (
                            <span className={
                              stock.momentum.signal.includes("UP") ? "text-green-400/50" :
                              stock.momentum.signal.includes("DOWN") ? "text-red-400/50" : ""
                            }>
                              {stock.momentum.signal === "STRONG_UP" ? "Strong Up" :
                               stock.momentum.signal === "UP" ? "Up" :
                               stock.momentum.signal === "FLAT" ? "Flat" :
                               stock.momentum.signal === "DOWN" ? "Down" :
                               "Strong Down"}
                            </span>
                          )}
                          {stock?.pressure && (
                            <span className={
                              stock.pressure.signal.includes("BUY") ? "text-green-400/50" :
                              stock.pressure.signal.includes("SELL") ? "text-red-400/50" : ""
                            }>
                              {stock.pressure.signal === "STRONG_BUY" ? "Strong Buy" :
                               stock.pressure.signal === "BUY" ? "Buy" :
                               stock.pressure.signal === "NEUTRAL" ? "Neutral" :
                               stock.pressure.signal === "SELL" ? "Sell" :
                               "Strong Sell"}
                            </span>
                          )}
                        </div>
                        <span>{getTimeSince(item.addedAt)} at ₹{addedPrice.toFixed(2)}</span>
                      </div>
                    </div>

                    {/* Hover arrow */}
                    <ChevronRight className="absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/0 group-hover:text-muted-foreground/30 transition-all" />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  ) : null;

  return (
    <>
      {/* Navbar trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="relative flex items-center justify-center size-8 rounded-lg transition-colors hover:bg-white/[0.06] text-muted-foreground hover:text-green-400"
        title="Watch Zone"
      >
        <Eye className="size-4" />
        {items.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 text-[9px] font-bold rounded-full bg-green-500 text-white">
            {items.length}
          </span>
        )}
      </button>

      {sheetPortal}
    </>
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
  const [animating, setAnimating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Check if symbol is already in watch zone on mount + on updates
  useEffect(() => {
    const checkStatus = async () => {
      if (!isLoggedIn) return;
      try {
        const res = await apiFetch("/api/watch-zone");
        if (!res.ok) return;
        const data = await res.json();
        const exists = data.items?.some((item: { symbol: string }) => item.symbol === symbol);
        setAdded(!!exists);
      } catch {
        // silently fail
      }
    };
    checkStatus();
    window.addEventListener("watch-zone-updated", checkStatus);
    return () => window.removeEventListener("watch-zone-updated", checkStatus);
  }, [isLoggedIn, symbol]);

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
        setAnimating(true);
        setTimeout(() => setAnimating(false), 600);
        onAdded?.();
        window.dispatchEvent(new Event("watch-zone-updated"));
      } else {
        const data = await res.json().catch(() => null);
        if (data?.error?.includes("full")) {
          setToast("Watch Zone is full (10/10). Remove a stock first.");
          setTimeout(() => setToast(null), 3000);
        } else if (data?.error?.includes("already")) {
          setAdded(true);
        } else if (data?.error) {
          setToast(data.error);
          setTimeout(() => setToast(null), 3000);
        }
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
    <button
      className={`flex items-center justify-center size-8 rounded-full transition-all duration-300 ${
        added
          ? `bg-green-500/25 text-green-400 ring-1 ring-green-500/40 ${animating ? "scale-125" : "scale-100"}`
          : "bg-green-500/15 text-green-400/70 ring-1 ring-green-500/25 hover:bg-green-500/25 hover:text-green-400 hover:ring-green-500/40 active:scale-90"
      }`}
      onClick={handleAdd}
      title={added ? "Added to Watch Zone" : "Add to Watch Zone"}
    >
      {added ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
    </button>
    {toast && createPortal(
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] animate-fade-in-up">
        <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-zinc-900/95 backdrop-blur-xl border border-white/[0.08] shadow-2xl shadow-black/40">
          <div className="flex items-center justify-center size-8 rounded-full bg-yellow-500/15 text-yellow-400">
            <Eye className="size-4" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{toast}</p>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">Open Watch Zone to manage your list</p>
          </div>
          <button onClick={() => setToast(null)} className="text-muted-foreground/40 hover:text-foreground ml-2">
            <X className="size-3.5" />
          </button>
        </div>
      </div>,
      document.body,
    )}
    </>
  );
}
