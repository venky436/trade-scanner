import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { stocksRoute } from "./routes/stocks.route.js";
import { authRoute } from "./routes/auth.route.js";
import { adminRoute } from "./routes/admin.route.js";
import { docsRoute } from "./routes/docs.route.js";
import { watchZoneRoute } from "./routes/watch-zone.route.js";
import { configRoute } from "./routes/config.route.js";
import { aiRoute } from "./routes/ai.route.js";
import { adminAiRoute } from "./routes/admin-ai.route.js";
import { sectionsRoute } from "./routes/sections.route.js";
import { userAuthRoute } from "./modules/auth/auth.routes.js";
import type { WsManager } from "./ws/ws-server.js";
import type { InstrumentMaps, SupportResistanceResult, Candle, MomentumResult, PressureResult } from "./lib/types.js";
import type { PressureEngine } from "./services/pressure.service.js";
import type { EodJob } from "./services/eod-job.service.js";
import type { SignalAccuracyService } from "./services/signal-accuracy.service.js";
import type { SignalTrackingService } from "./services/signal-tracking.service.js";
import type { AiCallService } from "./services/ai-call.service.js";

interface ServerDeps {
  apiKey: string;
  apiSecret: string;
  onAccessToken: (accessToken: string) => Promise<void>;
  getWsManager: () => WsManager | null;
  getAccessToken: () => string | null;
  getInstrumentMaps: () => InstrumentMaps | null;
  getPressureEngine: () => PressureEngine | null;
  onLevelsComputed?: (levels: Record<string, SupportResistanceResult>) => void;
  getCachedLevels?: () => Record<string, SupportResistanceResult>;
  getEodJob?: () => EodJob | null;
  getAccuracyService?: () => SignalAccuracyService | null;
  getTrackingService?: () => SignalTrackingService | null;
  getMomentum?: (symbol: string) => any;
  // AI verdict module — provided only when AI is currently enabled. Type
  // allows null so the server boots cleanly with the flag off.
  getAiCallService?: () => AiCallService | null;
  // Lifecycle hooks for runtime AI mode toggle (POST /api/config/ai-mode)
  onAiModeEnable?: () => void | Promise<void>;
  onAiModeDisable?: () => void | Promise<void>;
  // For the sections endpoint (used by frontend + AI scheduler)
  getCachedLevelsMap?: () => Record<string, SupportResistanceResult>;
  getPressureSignal?: (symbol: string) => PressureResult | null;
  getMomentumSignal?: (symbol: string) => MomentumResult | null;
  getRecentCandles?: (symbol: string, n: number) => Candle[];
  getAllSymbols?: () => string[];
}

export async function buildServer(deps: ServerDeps) {
  const server = Fastify({ logger: true });

  await server.register(cors, { origin: true, credentials: true, methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"] });
  await server.register(cookie);

  server.get("/health", async () => ({ status: "ok" }));

  await server.register(authRoute, {
    apiKey: deps.apiKey,
    apiSecret: deps.apiSecret,
    onAccessToken: deps.onAccessToken,
    isConnected: () => deps.getAccessToken() !== null,
  });

  await server.register(stocksRoute, {
    apiKey: deps.apiKey,
    getWsManager: deps.getWsManager,
    getAccessToken: deps.getAccessToken,
    getInstrumentMaps: deps.getInstrumentMaps,
    getPressureEngine: deps.getPressureEngine,
    onLevelsComputed: deps.onLevelsComputed,
    getCachedLevels: deps.getCachedLevels,
    getEodJob: deps.getEodJob,
    getMomentum: deps.getMomentum,
  });

  await server.register(userAuthRoute);

  await server.register(adminRoute, {
    getAccuracyService: deps.getAccuracyService ?? (() => null),
    getTrackingService: deps.getTrackingService ?? (() => null),
  });

  await server.register(docsRoute);
  await server.register(watchZoneRoute);
  await server.register(configRoute, {
    onAiModeEnable: deps.onAiModeEnable,
    onAiModeDisable: deps.onAiModeDisable,
  });

  // Admin AI performance + sections endpoint — always registered (they read
  // from DB / in-memory state; harmless when AI mode is off, just return
  // empty results).
  await server.register(adminAiRoute);
  if (deps.getCachedLevelsMap && deps.getPressureSignal && deps.getMomentumSignal && deps.getRecentCandles && deps.getAllSymbols) {
    await server.register(sectionsRoute, {
      getCachedLevels: deps.getCachedLevelsMap,
      getPressure: deps.getPressureSignal,
      getMomentum: deps.getMomentumSignal,
      getRecentCandles: deps.getRecentCandles,
      getAllSymbols: deps.getAllSymbols,
    });
  }

  // AI route — always registered. The route itself checks if the service is
  // available and returns 503 when AI mode is off. This lets the runtime
  // toggle work without re-registering routes.
  if (deps.getAiCallService) {
    await server.register(aiRoute, { getAiCallService: deps.getAiCallService });
  }

  return server;
}
