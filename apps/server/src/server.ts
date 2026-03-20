import Fastify from "fastify";
import cors from "@fastify/cors";

export async function buildServer() {
  const server = Fastify({ logger: true });

  await server.register(cors, { origin: true });

  server.get("/health", async () => ({ status: "ok" }));

  return server;
}
