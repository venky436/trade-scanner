import Fastify from "fastify";
import cors from "@fastify/cors";
import { stocksRoute } from "./routes/stocks.route.js";
import { authRoute } from "./routes/auth.route.js";
import type { WsManager } from "./ws/ws-server.js";
import type { InstrumentMaps, SupportResistanceResult } from "./lib/types.js";
import type { PressureEngine } from "./services/pressure.service.js";
import type { EodJob } from "./services/eod-job.service.js";

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
}

export async function buildServer(deps: ServerDeps) {
  const server = Fastify({ logger: true });

  await server.register(cors, { origin: true });

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
  });

  return server;
}
