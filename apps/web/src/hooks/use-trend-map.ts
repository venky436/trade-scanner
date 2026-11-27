"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { LevelPatternFlag, TrendFlag } from "@/lib/types";

// One shared poll for every card on the page (not one request per card).
const POLL_MS = 30_000;
let trends: Record<string, TrendFlag> = {};
let patterns: Record<string, LevelPatternFlag> = {};
let timer: number | null = null;
const listeners = new Set<() => void>();

async function load() {
  try {
    const res = await apiFetch("/api/sections/trend-map");
    if (!res.ok) return;
    const data = (await res.json()) as { trends?: Record<string, TrendFlag>; patterns?: Record<string, LevelPatternFlag> };
    trends = data.trends ?? {};
    patterns = data.patterns ?? {};
    listeners.forEach((l) => l());
  } catch {
    /* keep the last map */
  }
}

/** Trend read (EARLY / CONFIRMED) + candlestick pattern at a line, for a symbol — shared, refreshed every 30 s. */
export function useStockFlags(symbol: string): { trend: TrendFlag | null; pattern: LevelPatternFlag | null } {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    if (timer == null) {
      void load();
      timer = window.setInterval(load, POLL_MS);
    }
    return () => {
      listeners.delete(l);
      if (listeners.size === 0 && timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
  }, []);
  return { trend: trends[symbol] ?? null, pattern: patterns[symbol] ?? null };
}
