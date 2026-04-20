import type { FastifyInstance } from "fastify";
import type { SignalAccuracyService } from "../services/signal-accuracy.service.js";
import type { SignalTrackingService } from "../services/signal-tracking.service.js";
import { getAccuracyMetricsFromDB, getAccuracySignalsFromDB } from "../services/signal-accuracy.service.js";
import { getTrackingMetricsFromDB, getTrackingSignalsFromDB } from "../services/signal-tracking.service.js";
import { authMiddleware, adminGuard } from "../modules/auth/auth.middleware.js";

interface AdminRouteOpts {
  getAccuracyService: () => SignalAccuracyService | null;
  getTrackingService?: () => SignalTrackingService | null;
}

export async function adminRoute(fastify: FastifyInstance, opts: AdminRouteOpts) {
  // Today's accuracy metrics
  fastify.get("/api/admin/accuracy", { preHandler: [authMiddleware, adminGuard] }, async (_req, reply) => {
    const service = opts.getAccuracyService();
    const metrics = service
      ? await service.getMetrics()
      : await getAccuracyMetricsFromDB();
    return metrics ?? { error: "No data" };
  });

  // Accuracy for a specific date
  fastify.get("/api/admin/accuracy/:date", { preHandler: [authMiddleware, adminGuard] }, async (req, reply) => {
    const service = opts.getAccuracyService();
    const { date } = req.params as { date: string };
    const metrics = service
      ? await service.getMetrics(new Date(date))
      : await getAccuracyMetricsFromDB(new Date(date));
    return metrics ?? { error: "No data" };
  });

  // Signal records for a specific date (defaults to today)
  fastify.get("/api/admin/accuracy/signals", { preHandler: [authMiddleware, adminGuard] }, async (req, reply) => {
    const service = opts.getAccuracyService();
    const { date } = req.query as { date?: string };
    const targetDate = date ? new Date(date) : undefined;
    const signals = service
      ? await service.getRecentSignals(500, targetDate)
      : await getAccuracySignalsFromDB(500, targetDate);
    return { signals, count: signals.length };
  });

  // ── Signal Tracking (confidence-bucketed, 15-min evaluation) ──

  fastify.get("/api/admin/tracking", { preHandler: [authMiddleware, adminGuard] }, async (_req, reply) => {
    const service = opts.getTrackingService?.();
    const metrics = service
      ? await service.getMetrics()
      : await getTrackingMetricsFromDB();
    return metrics ?? { error: "No data" };
  });

  fastify.get("/api/admin/tracking/:date", { preHandler: [authMiddleware, adminGuard] }, async (req, reply) => {
    const service = opts.getTrackingService?.();
    const { date } = req.params as { date: string };
    const metrics = service
      ? await service.getMetrics(new Date(date))
      : await getTrackingMetricsFromDB(new Date(date));
    return metrics ?? { error: "No data" };
  });

  fastify.get("/api/admin/tracking/signals", { preHandler: [authMiddleware, adminGuard] }, async (req, reply) => {
    const service = opts.getTrackingService?.();
    const { date } = req.query as { date?: string };
    const targetDate = date ? new Date(date) : undefined;
    const signals = service
      ? await service.getRecentSignals(200, targetDate)
      : await getTrackingSignalsFromDB(200, targetDate);
    return { signals, count: signals.length };
  });
}
