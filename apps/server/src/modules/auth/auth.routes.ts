import type { FastifyInstance } from "fastify";
import { registerUser, loginUser, refreshAccessToken, logoutUser, getUserById } from "./auth.service.js";
import { authMiddleware } from "./auth.middleware.js";

const COOKIE_NAME = "refresh_token";
const IS_PROD = process.env.NODE_ENV === "production";

export async function userAuthRoute(fastify: FastifyInstance) {
  // ── Register ──
  fastify.post("/api/user/register", async (req, reply) => {
    const { email, password, name } = req.body as { email?: string; password?: string; name?: string };

    if (!email || !password) {
      return reply.status(400).send({ error: "Email and password are required" });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply.status(400).send({ error: "Invalid email format" });
    }

    if (password.length < 8) {
      return reply.status(400).send({ error: "Password must be at least 8 characters" });
    }

    try {
      const user = await registerUser({ email, password, name });
      return { success: true, user };
    } catch (err: any) {
      return reply.status(409).send({ error: err.message });
    }
  });

  // ── Login ──
  fastify.post("/api/user/login", async (req, reply) => {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      return reply.status(400).send({ error: "Email and password are required" });
    }

    try {
      const userAgent = req.headers["user-agent"];
      const ip = req.ip;
      const result = await loginUser({ email, password }, userAgent, ip);

      // Set refresh token as HTTP-only cookie
      reply.setCookie(COOKIE_NAME, result.refreshToken, {
        httpOnly: true,
        secure: IS_PROD,
        sameSite: IS_PROD ? "strict" : "lax",
        path: "/",
        maxAge: 7 * 24 * 60 * 60, // 7 days
      });

      return {
        accessToken: result.accessToken,
        user: result.user,
      };
    } catch (err: any) {
      const msg = err.message?.includes("Invalid") ? err.message : "Login failed. Please try again.";
      return reply.status(401).send({ error: msg });
    }
  });

  // ── Refresh Token ──
  fastify.post("/api/user/refresh", async (req, reply) => {
    const refreshToken = req.cookies?.[COOKIE_NAME];

    if (!refreshToken) {
      return reply.status(401).send({ error: "No refresh token" });
    }

    try {
      const result = await refreshAccessToken(refreshToken);

      // Set new refresh token cookie
      reply.setCookie(COOKIE_NAME, result.refreshToken, {
        httpOnly: true,
        secure: IS_PROD,
        sameSite: IS_PROD ? "strict" : "lax",
        path: "/",
        maxAge: 7 * 24 * 60 * 60,
      });

      return { accessToken: result.accessToken };
    } catch (err: any) {
      reply.clearCookie(COOKIE_NAME, { path: "/" });
      return reply.status(401).send({ error: err.message });
    }
  });

  // ── Logout ──
  fastify.post("/api/user/logout", async (req, reply) => {
    const refreshToken = req.cookies?.[COOKIE_NAME];
    if (refreshToken) {
      await logoutUser(refreshToken);
    }
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return { success: true };
  });

  // ── Get Current User ──
  fastify.get("/api/user/me", { preHandler: [authMiddleware] }, async (req, reply) => {
    if (!req.user) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const user = await getUserById(req.user.userId);
    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }

    return { user };
  });
}
