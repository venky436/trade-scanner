import type { FastifyInstance } from "fastify";
import type { SignalAccuracyService } from "../services/signal-accuracy.service.js";

interface AdminRouteOpts {
  getAccuracyService: () => SignalAccuracyService | null;
}

export async function adminRoute(fastify: FastifyInstance, opts: AdminRouteOpts) {
  // Today's accuracy metrics
  fastify.get("/api/admin/accuracy", async (_req, reply) => {
    const service = opts.getAccuracyService();
    if (!service) return reply.status(503).send({ error: "Accuracy service not initialized" });

    const metrics = await service.getMetrics();
    return metrics ?? { error: "No data" };
  });

  // Accuracy for a specific date
  fastify.get("/api/admin/accuracy/:date", async (req, reply) => {
    const service = opts.getAccuracyService();
    if (!service) return reply.status(503).send({ error: "Accuracy service not initialized" });

    const { date } = req.params as { date: string };
    const metrics = await service.getMetrics(new Date(date));
    return metrics ?? { error: "No data" };
  });

  // Recent signal records
  fastify.get("/api/admin/accuracy/signals", async (_req, reply) => {
    const service = opts.getAccuracyService();
    if (!service) return reply.status(503).send({ error: "Accuracy service not initialized" });

    const signals = await service.getRecentSignals(50);
    return { signals, count: signals.length };
  });
}
