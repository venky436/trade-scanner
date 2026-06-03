"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useServerConfig } from "@/context/config-context";
import type { AiVerdict } from "@/lib/types";

// Polling cadence for the cached-calls list. 30s matches the dashboard
// polling cadence used elsewhere — fast enough for fresh data, slow enough
// that we're not flooding the network.
const POLL_INTERVAL_MS = 30_000;

/**
 * Subscribes to all cached AI verdicts from the server (the top stocks the
 * scheduler evaluated in the last 5-min cycle). Returns a Map keyed by symbol.
 * Self-disables (returns empty Map, no polling) when aiModeEnabled is false.
 */
export function useAiCalls(): { calls: Map<string, AiVerdict>; isLoading: boolean } {
  const { aiModeEnabled } = useServerConfig();
  const [calls, setCalls] = useState<Map<string, AiVerdict>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!aiModeEnabled) {
      setIsLoading(false);
      setCalls(new Map());
      return;
    }
    let active = true;
    async function poll() {
      try {
        const res = await apiFetch("/api/ai/calls");
        if (!res.ok) {
          if (active) setIsLoading(false);
          return;
        }
        const data = await res.json();
        if (active && Array.isArray(data?.calls)) {
          const map = new Map<string, AiVerdict>();
          for (const c of data.calls as AiVerdict[]) {
            map.set(c.symbol, c);
          }
          setCalls(map);
          setIsLoading(false);
        }
      } catch {
        if (active) setIsLoading(false);
      }
    }
    void poll();
    const id = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => { active = false; clearInterval(id); };
  }, [aiModeEnabled]);

  return { calls, isLoading };
}

// Auto-refresh cadence for an open detail page. Matches the backend
// scheduler cycle so a user who stays on a page gets a fresh AI verdict
// every 5 min even if the symbol isn't in the top-10 scheduled set.
// Server still rate-limits to 1 on-demand per symbol per 60s, so this is
// effectively a "tick every 5 min" call.
const AI_CALL_AUTO_REFRESH_MS = 5 * 60_000;

/**
 * On-demand AI call for a single symbol. Triggers a POST on mount + every
 * AI_CALL_AUTO_REFRESH_MS while the page is open + on manual `refresh()`.
 * Server rate-limits duplicate on-demand calls (returns cached if within 60s).
 * Self-disables when aiModeEnabled is false or symbol is null.
 */
export function useAiCall(symbol: string | null): {
  verdict: AiVerdict | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const { aiModeEnabled } = useServerConfig();
  const [verdict, setVerdict] = useState<AiVerdict | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!aiModeEnabled || !symbol) {
      setVerdict(null);
      setIsLoading(false);
      setError(null);
      return;
    }
    let active = true;
    // Track a retry timer so we can clean it up on unmount
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    async function call(opts: { isInitial: boolean; isRetry?: boolean }): Promise<void> {
      // Don't blow away an existing verdict on auto-refresh — only show the
      // spinner for the initial call or an explicit refresh
      if (opts.isInitial && !opts.isRetry) {
        setIsLoading(true);
        setError(null);
      }
      try {
        const res = await apiFetch(`/api/ai/call/${encodeURIComponent(symbol!)}`, { method: "POST" });
        if (!res.ok) {
          if (!active) return;
          // 503 = service warming up or in-flight collision — auto-retry once
          // after a short delay before surfacing as a hard error
          if (res.status === 503 && !opts.isRetry) {
            retryTimer = setTimeout(() => { void call({ isInitial: opts.isInitial, isRetry: true }); }, 2500);
            return;
          }
          setError(res.status === 503 ? "AI service unavailable" : `Request failed (${res.status})`);
          setIsLoading(false);
          return;
        }
        const data = await res.json();
        if (active && data?.call) {
          setVerdict(data.call as AiVerdict);
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

    void call({ isInitial: true });
    const intervalId = setInterval(() => void call({ isInitial: false }), AI_CALL_AUTO_REFRESH_MS);
    return () => {
      active = false;
      clearInterval(intervalId);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [aiModeEnabled, symbol, refreshKey]);

  return { verdict, isLoading, error, refresh };
}
