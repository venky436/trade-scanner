import type { FastifyInstance } from "fastify";
import type { SignalAccuracyService } from "../services/signal-accuracy.service.js";
import { authMiddleware, adminGuard } from "../modules/auth/auth.middleware.js";

interface AdminRouteOpts {
  getAccuracyService: () => SignalAccuracyService | null;
}

export async function adminRoute(fastify: FastifyInstance, opts: AdminRouteOpts) {
  // Today's accuracy metrics
  fastify.get("/api/admin/accuracy", { preHandler: [authMiddleware, adminGuard] }, async (_req, reply) => {
    const service = opts.getAccuracyService();
    if (!service) return reply.status(503).send({ error: "Accuracy service not initialized" });

    const metrics = await service.getMetrics();
    return metrics ?? { error: "No data" };
  });

  // Accuracy for a specific date
  fastify.get("/api/admin/accuracy/:date", { preHandler: [authMiddleware, adminGuard] }, async (req, reply) => {
    const service = opts.getAccuracyService();
    if (!service) return reply.status(503).send({ error: "Accuracy service not initialized" });

    const { date } = req.params as { date: string };
    const metrics = await service.getMetrics(new Date(date));
    return metrics ?? { error: "No data" };
  });

  // Signal records for a specific date (defaults to today)
  fastify.get("/api/admin/accuracy/signals", { preHandler: [authMiddleware, adminGuard] }, async (req, reply) => {
    const service = opts.getAccuracyService();
    if (!service) return reply.status(503).send({ error: "Accuracy service not initialized" });

    const { date } = req.query as { date?: string };
    const signals = await service.getRecentSignals(500, date ? new Date(date) : undefined);
    return { signals, count: signals.length };
  });
}
