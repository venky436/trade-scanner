import type { FastifyInstance } from "fastify";
import { getAiModeEnabled, setAiModeEnabled } from "../lib/runtime-config.js";
import { authMiddleware, adminGuard } from "../modules/auth/auth.middleware.js";

interface ConfigRouteOpts {
  /** Called when AI mode is being turned ON. Should start AI services. */
  onAiModeEnable?: () => void | Promise<void>;
  /** Called when AI mode is being turned OFF. Should stop AI services. */
  onAiModeDisable?: () => void | Promise<void>;
}

// Runtime feature-flag endpoints. GET is unauthenticated (frontend needs it
// at boot to decide whether to render AI components). POST is admin-only
// (toggles in-memory flag + invokes lifecycle hooks).
//
// On server restart, the flag resets to the env var's value (`AI_MODE_ENABLED`).
export async function configRoute(fastify: FastifyInstance, opts: ConfigRouteOpts = {}) {
  // Public read — frontend ConfigProvider polls this at boot
  fastify.get("/api/config", async () => {
    return { aiModeEnabled: getAiModeEnabled() };
  });

  // Admin-only write — flips the in-memory flag + starts/stops AI services
  fastify.post("/api/config/ai-mode", { preHandler: [authMiddleware, adminGuard] }, async (req, reply) => {
    const { enabled } = (req.body ?? {}) as { enabled?: unknown };
    if (typeof enabled !== "boolean") {
      return reply.status(400).send({ error: "Body must be { enabled: boolean }" });
    }
    const before = getAiModeEnabled();
    if (before === enabled) {
      return { aiModeEnabled: enabled, changed: false };
    }

    // Validate the API key is set BEFORE flipping to true — otherwise the
    // first Gemini call would crash on first cycle.
    if (enabled && !process.env.GEMINI_API_KEY) {
      return reply.status(400).send({
        error: "GEMINI_API_KEY not set on server — cannot enable AI mode",
      });
    }

    setAiModeEnabled(enabled);

    try {
      if (enabled) {
        await opts.onAiModeEnable?.();
        console.log("[Config] AI mode ENABLED via runtime toggle");
      } else {
        await opts.onAiModeDisable?.();
        console.log("[Config] AI mode DISABLED via runtime toggle");
      }
    } catch (err) {
      // Rollback the flag if lifecycle handlers failed
      setAiModeEnabled(before);
      return reply.status(500).send({
        error: "Failed to toggle AI mode",
        detail: (err as Error).message,
      });
    }

    return { aiModeEnabled: enabled, changed: true };
  });
}
