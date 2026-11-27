"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { TrendResponse, TrendStock } from "@/lib/types";

const POLL_INTERVAL_MS = 30_000;

/** Trend Structure lane — /api/sections/trend, refreshed every 30 s. */
export function useTrendStocks(limit = 10): { stocks: TrendStock[]; meta: TrendResponse["meta"] | null; isLoading: boolean } {
  const [stocks, setStocks] = useState<TrendStock[]>([]);
  const [meta, setMeta] = useState<TrendResponse["meta"] | null>(null);
  const [isLoading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await apiFetch(`/api/sections/trend?limit=${limit}`);
        if (!res.ok) return;
        const data = (await res.json()) as TrendResponse;
        if (active) {
          setStocks(data.stocks);
          setMeta(data.meta);
        }
      } catch {
        /* keep the last list */
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    const id = window.setInterval(load, POLL_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [limit]);
  return { stocks, meta, isLoading };
}
