"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useMarketData } from "./use-market-data";
import type {
  VolatileSortKey,
  VolatileStock,
  VolatileStocksResponse,
} from "@/lib/types";

// Baseline polling cadence — matches the rest of the dashboard's intervals.
// We also re-fetch when WS ticks arrive (debounced) so the screen updates
// live during market hours without flooding the endpoint.
const POLL_INTERVAL_MS = 30_000;
const WS_REFETCH_DEBOUNCE_MS = 2_000;

export interface UseVolatileStocksOptions {
  /** Inclusive lower bound on price. null = no lower bound. */
  priceMin: number | null;
  /** Inclusive upper bound on price. null = no upper bound. */
  priceMax: number | null;
  sortBy: VolatileSortKey;
}

export interface UseVolatileStocksResult {
  stocks: VolatileStock[];
  meta: VolatileStocksResponse["meta"] | null;
  isLoading: boolean;
  error: string | null;
  /** Manual refresh — useful for an explicit "refresh" button. */
  refresh: () => void;
}

/**
 * Subscribes to the Volatile lane from /api/sections/volatile.
 *
 * Two re-fetch triggers:
 *   1. Setup interval every POLL_INTERVAL_MS (30s).
 *   2. WS-driven: every time the global stockMap reference changes (i.e. a
 *      tick batch arrived), debounce 2s and re-fetch. This keeps the list
 *      ranked against current prices without spamming the endpoint.
 */
export function useVolatileStocks(
  opts: UseVolatileStocksOptions,
): UseVolatileStocksResult {
  const { stockMap } = useMarketData();
  const [stocks, setStocks] = useState<VolatileStock[]>([]);
  const [meta, setMeta] = useState<VolatileStocksResponse["meta"] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = () => setRefreshKey((k) => k + 1);

  // Build a stable query string from filter opts. Using a string for the
  // useEffect dep avoids re-fetching when callers pass a new object reference
  // but the same values.
  const queryString = buildQueryString(opts);

  // Debounce timer ref persists across renders.
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;

    async function fetchOnce(showLoadingSpinner: boolean): Promise<void> {
      if (showLoadingSpinner) setIsLoading(true);
      try {
        const res = await apiFetch(`/api/sections/volatile?${queryString}`);
        if (!res.ok) {
          if (active) {
            setError(`Request failed (${res.status})`);
            setIsLoading(false);
          }
          return;
        }
        const data: VolatileStocksResponse = await res.json();
        if (active) {
          setStocks(Array.isArray(data?.stocks) ? data.stocks : []);
          setMeta(data?.meta ?? null);
          setError(null);
          setIsLoading(false);
        }
      } catch (e) {
        if (active) {
          setError((e as Error).message);
          setIsLoading(false);
        }
      }
    }

    void fetchOnce(true);
    const intervalId = setInterval(() => void fetchOnce(false), POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(intervalId);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString, refreshKey]);

  // Separate effect for WS-driven refresh — debounced so a burst of ticks
  // collapses into one network call.
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      // Mark a fresh refresh without showing the spinner.
      setRefreshKey((k) => k + 1);
    }, WS_REFETCH_DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
    // stockMap reference changes on every WS batch — that's our trigger.
  }, [stockMap]);

  return { stocks, meta, isLoading, error, refresh };
}

function buildQueryString(opts: UseVolatileStocksOptions): string {
  const params = new URLSearchParams();
  if (opts.priceMin !== null) params.set("priceMin", String(opts.priceMin));
  if (opts.priceMax !== null) params.set("priceMax", String(opts.priceMax));
  params.set("sortBy", opts.sortBy);
  return params.toString();
}
