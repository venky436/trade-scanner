"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { OpeningMoversResponse } from "@/lib/types";

const POLL_INTERVAL_MS = 15_000;

/** Opening movers — /api/sections/opening-movers, refreshed every 15 s (live price on the cards). */
export function useOpeningMovers(): { data: OpeningMoversResponse | null; isLoading: boolean } {
  const [data, setData] = useState<OpeningMoversResponse | null>(null);
  const [isLoading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await apiFetch("/api/sections/opening-movers");
        if (!res.ok) return;
        const body = (await res.json()) as OpeningMoversResponse;
        if (active) setData(body);
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
  }, []);
  return { data, isLoading };
}
