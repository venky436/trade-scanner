import type { FastifyInstance } from "fastify";
import type { AiCallService } from "../services/ai-call.service.js";
import { authMiddleware } from "../modules/auth/auth.middleware.js";

interface AiRouteOpts {
  /** Returns the AI service when active. May be null if AI_MODE_ENABLED is off. */
  getAiCallService: () => AiCallService | null;
}

// Routes for the AI verdict module. Registered ONLY when AI_MODE_ENABLED=true
// (see server.ts). When the flag flips off + server restarts, these routes
// return 404 — frontend's useAiCalls/useAiCall hooks gracefully handle that.
//
// All routes behind authMiddleware (existing JWT auth) — no anon access.
export async function aiRoute(fastify: FastifyInstance, opts: AiRouteOpts) {
  /**
   * GET /api/ai/calls
   * Returns the current snapshot of all cached AI verdicts (top stocks
   * evaluated in the last 5-min cycle). Polled by the dashboard.
   */
  fastify.get("/api/ai/calls", { preHandler: [authMiddleware] }, async (_req, reply) => {
    const svc = opts.getAiCallService();
    if (!svc) return reply.status(503).send({ error: "AI service not running" });
    return { calls: svc.getAllCached() };
  });

  /**
   * POST /api/ai/call/:symbol
   * Force a fresh AI call for the given symbol. Rate-limited to 1 forced
   * refresh per symbol per 60s — additional requests within the cooldown
   * serve the cached value (if any). Used by the stock-detail page on open.
   */
  fastify.post("/api/ai/call/:symbol", { preHandler: [authMiddleware] }, async (req, reply) => {
    const svc = opts.getAiCallService();
    if (!svc) return reply.status(503).send({ error: "AI service not running" });

    const { symbol } = req.params as { symbol: string };
    // Light sanitization — symbols are alphanumeric + spaces (e.g. "NIFTY 50")
    if (!symbol || symbol.length > 100 || /[^A-Za-z0-9 .\-&]/.test(symbol)) {
      return reply.status(400).send({ error: "Invalid symbol" });
    }

    try {
      const call = await svc.evaluateOnDemand(symbol);
      if (!call) {
        return reply.status(503).send({ error: "Could not evaluate (no data or upstream error)" });
      }
      return { call };
    } catch (err) {
      return reply.status(500).send({ error: "Evaluation failed", detail: (err as Error).message });
    }
  });
}
