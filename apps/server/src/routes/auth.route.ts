import type { FastifyInstance } from "fastify";
import { KiteConnect } from "kiteconnect";
import { saveSession } from "../lib/session-store.js";

interface AuthRouteOpts {
  apiKey: string;
  apiSecret: string;
  onAccessToken: (accessToken: string) => Promise<void>;
  isConnected: () => boolean;
}

export async function authRoute(fastify: FastifyInstance, opts: AuthRouteOpts) {
  const { apiKey, apiSecret, onAccessToken, isConnected } = opts;

  // GET /api/auth/login → redirects to Kite login page
  fastify.get("/api/auth/login", async (_req, reply) => {
    const loginUrl = `https://kite.trade/connect/login?v=3&api_key=${apiKey}`;
    return reply.redirect(loginUrl);
  });

  // GET /api/auth/callback → Kite redirects here with request_token
  fastify.get("/api/auth/callback", async (req, reply) => {
    const { request_token, action } = req.query as {
      request_token?: string;
      action?: string;
    };

    if (action !== "login" || !request_token) {
      return reply.status(400).send({ error: "Invalid callback" });
    }

    try {
      const kc = new KiteConnect({ api_key: apiKey });
      const session = await kc.generateSession(request_token, apiSecret);
      const accessToken = session.access_token;

      console.log("Kite access token obtained successfully");

      // Persist token so it survives server restarts
      saveSession(accessToken);

      // Trigger market data startup
      await onAccessToken(accessToken);

      // Redirect to frontend
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      return reply.redirect(frontendUrl);
    } catch (err: any) {
      console.error("Kite auth failed:", err.message);
      return reply.status(500).send({ error: "Authentication failed", detail: err.message });
    }
  });

  // GET /api/auth/status → is Kite connected?
  fastify.get("/api/auth/status", async () => {
    return { connected: isConnected() };
  });
}
