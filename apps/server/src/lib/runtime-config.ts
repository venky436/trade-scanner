// Runtime config — single-process, in-memory feature flags that can be
// toggled at runtime without a server restart. The env var (set in .env) is
// the boot-time default; an admin can flip the in-memory flag via
// POST /api/config/ai-mode without affecting the env. On the next process
// restart, the flag resets to the env value.
//
// This preserves the plug-in / plug-out hard requirement (env var is still
// the source of truth across deploys), and adds the convenience of toggling
// during a session.

interface RuntimeConfig {
  aiModeEnabled: boolean;
}

const state: RuntimeConfig = {
  aiModeEnabled: process.env.AI_MODE_ENABLED === "true",
};

export function getAiModeEnabled(): boolean {
  return state.aiModeEnabled;
}

export function setAiModeEnabled(enabled: boolean): void {
  state.aiModeEnabled = enabled;
}
