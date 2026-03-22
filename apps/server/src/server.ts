import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { stocksRoute } from "./routes/stocks.route.js";
import { authRoute } from "./routes/auth.route.js";
import { adminRoute } from "./routes/admin.route.js";
import { userAuthRoute } from "./modules/auth/auth.routes.js";
import type { WsManager } from "./ws/ws-server.js";
import type { InstrumentMaps, SupportResistanceResult } from "./lib/types.js";
import type { PressureEngine } from "./services/pressure.service.js";
import type { EodJob } from "./services/eod-job.service.js";
import type { SignalAccuracyService } from "./services/signal-accuracy.service.js";

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
  getSignalSnapshot?: (symbol: string) => any;
  getMomentum?: (symbol: string) => any;
}

export async function buildServer(deps: ServerDeps) {
  const server = Fastify({ logger: true });

  await server.register(cors, { origin: true, credentials: true });
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
    getSignalSnapshot: deps.getSignalSnapshot,
    getMomentum: deps.getMomentum,
  });

  await server.register(userAuthRoute);

  await server.register(adminRoute, {
    getAccuracyService: deps.getAccuracyService ?? (() => null),
  });

  return server;
}
