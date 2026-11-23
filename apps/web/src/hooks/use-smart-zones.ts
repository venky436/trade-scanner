"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { SmartZonesResponse } from "@/lib/types";

const POLL_INTERVAL_MS = 15_000;

/** Smart zones — /api/sections/smart-zones, refreshed every 15 s (live price + status). */
export function useSmartZones(): { data: SmartZonesResponse | null; isLoading: boolean } {
  const [data, setData] = useState<SmartZonesResponse | null>(null);
  const [isLoading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await apiFetch("/api/sections/smart-zones");
        if (!res.ok) return;
        const body = (await res.json()) as SmartZonesResponse;
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
