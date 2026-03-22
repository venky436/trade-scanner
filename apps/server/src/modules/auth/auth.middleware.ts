import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyAccessToken, type JwtPayload } from "../../utils/jwt.js";

// Extend Fastify request with user
declare module "fastify" {
  interface FastifyRequest {
    user?: JwtPayload;
  }
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return reply.status(401).send({ error: "Authentication required" });
  }

  const token = authHeader.substring(7);

  try {
    const payload = verifyAccessToken(token);
    request.user = payload;
  } catch {
    return reply.status(401).send({ error: "Invalid or expired token" });
  }
}

export async function adminGuard(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) {
    return reply.status(401).send({ error: "Authentication required" });
  }

  if (request.user.role !== "ADMIN") {
    return reply.status(403).send({ error: "Admin access required" });
  }
}
