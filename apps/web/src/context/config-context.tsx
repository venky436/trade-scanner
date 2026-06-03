"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api";

// Tiny config provider — fetches /api/config at app mount, exposes server
// feature flags to all components, and provides a toggle for AI mode that
// hits POST /api/config/ai-mode (admin-only on the server).
//
// The server's in-memory flag is the source of truth. On server restart it
// resets to the env var (AI_MODE_ENABLED); the runtime toggle is convenience.

interface ServerConfig {
  aiModeEnabled: boolean;
  isLoading: boolean;
  /** Toggle AI mode on the server. Returns whether the operation succeeded. */
  toggleAiMode: (next: boolean) => Promise<{ ok: boolean; error?: string }>;
}

const ConfigContext = createContext<ServerConfig>({
  aiModeEnabled: false,
  isLoading: true,
  toggleAiMode: async () => ({ ok: false, error: "ConfigProvider not mounted" }),
});

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [aiModeEnabled, setAiModeEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await apiFetch("/api/config");
      if (!res.ok) {
        setIsLoading(false);
        return;
      }
      const data = await res.json();
      if (typeof data?.aiModeEnabled === "boolean") {
        setAiModeEnabled(data.aiModeEnabled);
      }
    } catch {
      // default off
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void fetchConfig(); }, [fetchConfig]);

  const toggleAiMode = useCallback(async (next: boolean) => {
    try {
      const res = await apiFetch("/api/config/ai-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        return { ok: false, error: data?.error ?? `Request failed (${res.status})` };
      }
      const data = await res.json();
      if (typeof data?.aiModeEnabled === "boolean") {
        setAiModeEnabled(data.aiModeEnabled);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }, []);

  return (
    <ConfigContext.Provider value={{ aiModeEnabled, isLoading, toggleAiMode }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useServerConfig(): ServerConfig {
  return useContext(ConfigContext);
}
