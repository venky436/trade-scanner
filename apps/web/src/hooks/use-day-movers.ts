"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useMarketData } from "./use-market-data";
import type {
  DayMover,
  DayMoverDirectionFilter,
  DayMoverSortKey,
  DayMoversResponse,
} from "@/lib/types";

// Matches the Volatile lane's cadence — same WS-driven re-fetch pattern so
// both tabs feel equally live.
const POLL_INTERVAL_MS = 30_000;
const WS_REFETCH_DEBOUNCE_MS = 2_000;

export interface UseDayMoversOptions {
  direction: DayMoverDirectionFilter;
  priceMin: number | null;
  priceMax: number | null;
  sortBy: DayMoverSortKey;
}

export interface UseDayMoversResult {
  stocks: DayMover[];
  meta: DayMoversResponse["meta"] | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Subscribes to the Day Movers lane from /api/sections/day-movers.
 * Re-fetches every POLL_INTERVAL_MS + on WS-tick batches (debounced).
 * Mirrors useVolatileStocks for consistency.
 */
export function useDayMovers(opts: UseDayMoversOptions): UseDayMoversResult {
  const { stockMap } = useMarketData();
  const [stocks, setStocks] = useState<DayMover[]>([]);
  const [meta, setMeta] = useState<DayMoversResponse["meta"] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = () => setRefreshKey((k) => k + 1);
  const queryString = buildQueryString(opts);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;

    async function fetchOnce(showLoadingSpinner: boolean): Promise<void> {
      if (showLoadingSpinner) setIsLoading(true);
      try {
        const res = await apiFetch(`/api/sections/day-movers?${queryString}`);
        if (!res.ok) {
          if (active) {
            setError(`Request failed (${res.status})`);
            setIsLoading(false);
          }
          return;
        }
        const data: DayMoversResponse = await res.json();
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

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setRefreshKey((k) => k + 1);
    }, WS_REFETCH_DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [stockMap]);

  return { stocks, meta, isLoading, error, refresh };
}

function buildQueryString(opts: UseDayMoversOptions): string {
  const params = new URLSearchParams();
  params.set("direction", opts.direction);
  if (opts.priceMin !== null) params.set("priceMin", String(opts.priceMin));
  if (opts.priceMax !== null) params.set("priceMax", String(opts.priceMax));
  params.set("sortBy", opts.sortBy);
  return params.toString();
}
