import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { watchZone } from "../db/schema/watch-zone.js";
import { authMiddleware } from "../modules/auth/auth.middleware.js";

const MAX_WATCH_ZONE_ITEMS = 10;

export async function watchZoneRoute(fastify: FastifyInstance) {
  // ── GET /api/watch-zone — get user's watch zone items ──
  fastify.get("/api/watch-zone", { preHandler: [authMiddleware] }, async (req, reply) => {
    if (!req.user) return reply.status(401).send({ error: "Not authenticated" });

    try {
      const items = await db
        .select()
        .from(watchZone)
        .where(eq(watchZone.userId, req.user.userId))
        .orderBy(watchZone.addedAt);

      return { items };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // ── POST /api/watch-zone — add symbol to watch zone ──
  fastify.post("/api/watch-zone", { preHandler: [authMiddleware] }, async (req, reply) => {
    if (!req.user) return reply.status(401).send({ error: "Not authenticated" });

    const { symbol, addedPrice, signalAction, signalType } = req.body as {
      symbol?: string;
      addedPrice?: number;
      signalAction?: string;
      signalType?: string;
    };

    if (!symbol || !addedPrice) {
      return reply.status(400).send({ error: "symbol and addedPrice are required" });
    }

    // signalAction / signalType are kept inert for back-compat: stored if provided,
    // otherwise defaulted. The frontend renders live intelligence, not these fields.
    const storedAction = signalAction ?? "WATCH";

    try {
      // Check limit
      const existing = await db
        .select()
        .from(watchZone)
        .where(eq(watchZone.userId, req.user.userId));

      if (existing.length >= MAX_WATCH_ZONE_ITEMS) {
        return reply.status(400).send({ error: `Watch Zone is full (max ${MAX_WATCH_ZONE_ITEMS}). Remove an item first.` });
      }

      // Check duplicate
      const duplicate = existing.find(item => item.symbol === symbol);
      if (duplicate) {
        return reply.status(400).send({ error: `${symbol} is already in your Watch Zone` });
      }

      const [inserted] = await db.insert(watchZone).values({
        userId: req.user.userId,
        symbol,
        addedPrice: addedPrice.toFixed(2),
        signalAction: storedAction,
        signalType: signalType ?? null,
      }).returning();

      return { success: true, item: inserted };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // ── DELETE /api/watch-zone/:symbol — remove symbol from watch zone ──
  fastify.delete("/api/watch-zone/:symbol", { preHandler: [authMiddleware] }, async (req, reply) => {
    if (!req.user) return reply.status(401).send({ error: "Not authenticated" });

    const { symbol } = req.params as { symbol: string };

    try {
      const deleted = await db
        .delete(watchZone)
        .where(and(
          eq(watchZone.userId, req.user.userId),
          eq(watchZone.symbol, symbol),
        ))
        .returning();

      if (deleted.length === 0) {
        return reply.status(404).send({ error: "Symbol not found in Watch Zone" });
      }

      return { success: true };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });
}
