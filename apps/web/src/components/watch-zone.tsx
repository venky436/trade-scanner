"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { X, Plus, Eye, ChevronRight, Check, PhoneCall } from "lucide-react";
import type { IntelligenceSnapshot, Zone } from "@/lib/types";
import { toOptionInsight, type OptionBias } from "@/lib/option-insight";
import { apiFetch } from "@/lib/api";
import {
  momentumDirection,
  momentumDisplay,
  pressureDirection,
  pressureDisplay,
} from "@/lib/sebi-display";

interface WatchZoneItem {
  id: number;
  symbol: string;
  addedPrice: string;
  addedAt: string;
  /** "OPTION" marks an index option bookmark; otherwise treated as a stock */
  signalType?: string | null;
}

interface WatchZoneSheetProps {
  stockMap: Map<string, IntelligenceSnapshot>;
  isLoggedIn: boolean;
}

const ZONE_LABEL: Record<Zone, string> = {
  NEAR_RESISTANCE: "Near Resistance",
  NEAR_SUPPORT: "Near Support",
  MID_RANGE: "Mid Range",
};

const ZONE_TONE: Record<Zone, string> = {
  NEAR_RESISTANCE: "text-rose-600 dark:text-rose-400/80",
  NEAR_SUPPORT: "text-emerald-600 dark:text-emerald-400/80",
  MID_RANGE: "text-zinc-500",
};

const OPTION_BIAS_LABEL: Record<OptionBias, string> = {
  CALL: "Call-side activity",
  PUT: "Put-side activity",
  NEUTRAL: "Balanced activity",
};

const OPTION_BIAS_TONE: Record<OptionBias, string> = {
  CALL: "text-emerald-700 bg-emerald-500/10 ring-emerald-500/20 dark:text-emerald-300",
  PUT: "text-rose-700 bg-rose-500/10 ring-rose-500/20 dark:text-rose-300",
  NEUTRAL:
    "text-zinc-600 bg-zinc-100 ring-zinc-200 dark:text-zinc-400 dark:bg-zinc-800/40 dark:ring-zinc-700/40",
};

function getTimeSince(addedAt: string): string {
  const diff = Date.now() - new Date(addedAt).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  return `${hrs}h ${min % 60}m ago`;
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
        setItems((prev) => prev.filter((i) => i.symbol !== symbol));
        window.dispatchEvent(new Event("watch-zone-updated"));
      }
    } catch {
      // silently fail
    }
  };

  const enrichedItems = useMemo(() => {
    return items.map((item) => ({
      ...item,
      stock: stockMap.get(item.symbol),
    }));
  }, [items, stockMap]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!isLoggedIn) return null;

  const sheetPortal = mounted
    ? createPortal(
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
            className={`fixed top-0 right-0 h-full w-[440px] max-w-[90vw] bg-white/95 dark:bg-zinc-950/95 backdrop-blur-xl border-l border-zinc-200 dark:border-white/[0.06] z-50 transition-transform duration-300 ease-out ${
              open ? "translate-x-0" : "translate-x-full"
            }`}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-white/[0.06]">
              <div className="flex items-center gap-2.5">
                <Eye className="size-4 text-emerald-600 dark:text-emerald-400" />
                <h2 className="text-sm font-bold tracking-wide text-zinc-900 dark:text-zinc-100">
                  Watch Zone
                </h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full ring-1 text-emerald-700 ring-emerald-500/20 bg-emerald-500/10 dark:text-emerald-400/70 dark:bg-emerald-500/8">
                  {items.length}/10
                </span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="flex items-center justify-center size-7 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/[0.06] text-muted-foreground hover:text-foreground transition-colors"
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
                    Open any stock and click the + to start tracking
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {enrichedItems.map(({ stock, ...item }) => {
                    const addedPrice = Number(item.addedPrice);
                    const currentPrice = stock?.price ?? 0;
                    const pnl = addedPrice > 0 ? ((currentPrice - addedPrice) / addedPrice) * 100 : 0;
                    const pnlPositive = pnl >= 0;
                    const isOption = item.signalType === "OPTION";

                    // Option items use option-insight (CALL/PUT/NEUTRAL)
                    if (isOption) {
                      const optionInsight = stock ? toOptionInsight(stock) : null;
                      const biasKey = optionInsight?.bias ?? "NEUTRAL";

                      return (
                        <div
                          key={item.id}
                          className="group relative rounded-xl bg-zinc-50 dark:bg-white/[0.02] border border-zinc-200 dark:border-white/[0.04] cursor-pointer transition-all hover:bg-zinc-100 dark:hover:bg-white/[0.04]"
                          onClick={() => {
                            router.push("/");
                            setOpen(false);
                          }}
                        >
                          <div className="p-3 space-y-2">
                            {/* Row 1: Symbol + OPT badge + Remove */}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <PhoneCall className="size-3.5 text-zinc-500" />
                                <span className="text-sm font-bold text-zinc-900 dark:text-foreground">
                                  {item.symbol}
                                </span>
                                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500/20">
                                  OPT
                                </span>
                              </div>
                              <button
                                className="opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-rose-500 dark:hover:text-rose-400 transition-all p-1"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeItem(item.symbol);
                                }}
                              >
                                <X className="size-3.5" />
                              </button>
                            </div>

                            {/* Row 2: Option insight + Price */}
                            <div className="flex items-center justify-between text-xs">
                              <span
                                className={`px-2 py-0.5 rounded-full ring-1 text-[10px] font-semibold ${OPTION_BIAS_TONE[biasKey]}`}
                              >
                                {OPTION_BIAS_LABEL[biasKey]}
                              </span>
                              <span className="font-mono tabular-nums text-zinc-700 dark:text-foreground/80">
                                {currentPrice.toLocaleString("en-IN", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                            </div>

                            {/* Row 3: Activity + Time */}
                            <div className="flex items-center justify-between text-[10px] text-muted-foreground/60 dark:text-muted-foreground/40">
                              <span>
                                {stock
                                  ? `${momentumDisplay(stock.momentum.label)} · ${pressureDisplay(stock.pressure.label)}`
                                  : "Loading…"}
                              </span>
                              <span>
                                {getTimeSince(item.addedAt)} · added @ {addedPrice.toFixed(2)}
                              </span>
                            </div>
                          </div>

                          <ChevronRight className="absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/0 group-hover:text-muted-foreground/40 transition-all" />
                        </div>
                      );
                    }

                    // Stock items (default)
                    const zone = stock?.context.zone ?? "MID_RANGE";
                    const momLabel = stock ? momentumDisplay(stock.momentum.label) : null;
                    const presLabel = stock ? pressureDisplay(stock.pressure.label) : null;
                    const mDir = stock ? momentumDirection(stock.momentum.label) : "flat";
                    const pDir = stock ? pressureDirection(stock.pressure.label) : "flat";
                    const dirToneClass = (d: "up" | "down" | "flat") =>
                      d === "up"
                        ? "text-emerald-600 dark:text-emerald-400/80"
                        : d === "down"
                        ? "text-rose-600 dark:text-rose-400/80"
                        : "text-zinc-500";

                    return (
                      <div
                        key={item.id}
                        className="group relative rounded-xl bg-zinc-50 dark:bg-white/[0.02] border border-zinc-200 dark:border-white/[0.04] cursor-pointer transition-all hover:bg-zinc-100 dark:hover:bg-white/[0.04]"
                        onClick={() => {
                          router.push(`/stock/${encodeURIComponent(item.symbol)}`);
                          setOpen(false);
                        }}
                      >
                        <div className="p-3 space-y-2">
                          {/* Row 1: Symbol + Zone */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-zinc-900 dark:text-foreground">
                                {item.symbol}
                              </span>
                              <span className={`text-[10px] uppercase tracking-wider ${ZONE_TONE[zone]}`}>
                                {ZONE_LABEL[zone]}
                              </span>
                            </div>
                            <button
                              className="opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-rose-500 dark:hover:text-rose-400 transition-all p-1"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeItem(item.symbol);
                              }}
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>

                          {/* Row 2: Momentum + Price + change-since-added */}
                          <div className="flex items-center justify-between text-xs">
                            <span className={`text-[11px] font-semibold ${dirToneClass(mDir)}`}>
                              {momLabel ?? "Loading…"}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="font-mono tabular-nums text-zinc-700 dark:text-foreground/80">
                                ₹
                                {currentPrice.toLocaleString("en-IN", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                              <span
                                className={`font-mono tabular-nums font-bold ${pnlPositive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}
                              >
                                {pnlPositive ? "+" : ""}
                                {pnl.toFixed(2)}%
                              </span>
                            </div>
                          </div>

                          {/* Row 3: Pressure + Time + added price */}
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground/60 dark:text-muted-foreground/40">
                            <span className={dirToneClass(pDir)}>
                              {presLabel ?? ""}
                            </span>
                            <span>
                              {getTimeSince(item.addedAt)} · added ₹{addedPrice.toFixed(2)}
                            </span>
                          </div>
                        </div>

                        <ChevronRight className="absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/0 group-hover:text-muted-foreground/40 transition-all" />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>,
        document.body,
      )
    : null;

  return (
    <>
      {/* Navbar trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="relative flex items-center justify-center size-8 rounded-lg transition-colors hover:bg-zinc-100 dark:hover:bg-white/[0.06] text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400"
        title="Watch Zone"
      >
        <Eye className="size-4" />
        {items.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 text-[9px] font-bold rounded-full bg-emerald-500 text-white">
            {items.length}
          </span>
        )}
      </button>

      {sheetPortal}
    </>
  );
}

// ── Add to Watch Zone button (used by stock-detail) ──

interface AddToWatchZoneProps {
  symbol: string;
  price: number;
  isLoggedIn: boolean;
  /** "OPTION" marks an index option; default is undefined (stock) */
  kind?: "OPTION";
  onAdded?: () => void;
}

export function AddToWatchZoneButton({ symbol, price, isLoggedIn, kind, onAdded }: AddToWatchZoneProps) {
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

  if (!isLoggedIn) return null;

  const handleAdd = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (added || loading) return;
    setLoading(true);
    try {
      // The API still accepts the legacy fields for back-compat — we send neutral placeholders.
      // For options, signalType="OPTION" is used as a marker so the watch-zone can render
      // them as option cards instead of stock cards.
      const res = await apiFetch("/api/watch-zone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          addedPrice: price,
          signalAction: kind === "OPTION" ? "OPTION" : "WATCH",
          signalType: kind ?? null,
        }),
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
            ? `bg-emerald-500/25 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-500/40 ${animating ? "scale-125" : "scale-100"}`
            : "bg-emerald-500/15 text-emerald-700/80 dark:text-emerald-400/70 ring-1 ring-emerald-500/25 hover:bg-emerald-500/25 hover:text-emerald-700 dark:hover:text-emerald-400 hover:ring-emerald-500/40 active:scale-90"
        }`}
        onClick={handleAdd}
        title={added ? "Added to Watch Zone" : "Add to Watch Zone"}
      >
        {added ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
      </button>
      {toast &&
        createPortal(
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] animate-fade-in-up">
            <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl border border-zinc-200 dark:border-white/[0.08] shadow-2xl shadow-black/10 dark:shadow-black/40">
              <div className="flex items-center justify-center size-8 rounded-full bg-yellow-500/15 text-yellow-600 dark:text-yellow-400">
                <Eye className="size-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{toast}</p>
                <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                  Open Watch Zone to manage your list
                </p>
              </div>
              <button
                onClick={() => setToast(null)}
                className="text-muted-foreground/40 hover:text-foreground ml-2"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
