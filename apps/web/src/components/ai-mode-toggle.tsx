"use client";

import { useState } from "react";
import { Bot, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useServerConfig } from "@/context/config-context";

// Navbar toggle for the experimental AI Verdict module. Visible to admin
// users only. One-click flip — turns the AI scheduler + UI on/off without
// a server restart.
//
// On = violet glow + Bot icon (filled).
// Off = muted Bot icon.
// While toggling = spinner.
export function AiModeToggle() {
  const { aiModeEnabled, toggleAiMode, isLoading: configLoading } = useServerConfig();
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    setErrorMsg(null);
    const next = !aiModeEnabled;
    const res = await toggleAiMode(next);
    setBusy(false);
    if (!res.ok) {
      setErrorMsg(res.error ?? "Toggle failed");
      // Auto-clear error after 4s
      setTimeout(() => setErrorMsg(null), 4000);
    }
  }

  const tooltip = errorMsg
    ? errorMsg
    : aiModeEnabled
      ? "AI Mode ON — click to disable"
      : "AI Mode OFF — click to enable";

  const baseClass = aiModeEnabled
    ? "bg-violet-500/15 text-violet-600 dark:text-violet-400 ring-1 ring-violet-500/40 shadow-sm shadow-violet-500/20 hover:bg-violet-500/20"
    : "text-muted-foreground hover:text-foreground";

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => void onClick()}
        disabled={busy || configLoading}
        aria-label="Toggle AI mode"
        title={tooltip}
        className={baseClass}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Bot className="size-4" strokeWidth={aiModeEnabled ? 2.4 : 2} />
        )}
        {aiModeEnabled && (
          <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-violet-500" />
        )}
      </Button>
      {errorMsg && (
        <span className="absolute top-full mt-1 right-0 z-50 whitespace-nowrap rounded-md bg-rose-500/10 px-2 py-1 text-[10px] font-semibold text-rose-600 dark:text-rose-400 ring-1 ring-rose-500/30 shadow-lg">
          {errorMsg}
        </span>
      )}
    </div>
  );
}
