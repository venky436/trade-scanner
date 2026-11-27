import type { FastifyInstance, FastifyReply } from "fastify";
import { authMiddleware, adminGuard } from "../modules/auth/auth.middleware.js";
import { marketDataService } from "../services/market-data.service.js";
import { buildTradeSetups } from "../lib/trade-setups.js";
import type { AutoTrader } from "../services/auto-trader.service.js";
import { TradeError, type OrderExecutionService, type TradeSide } from "../services/order-execution.service.js";
import type { Candle, MomentumResult, PressureResult, SupportResistanceResult } from "../lib/types.js";
import type { DayLevels } from "../lib/day-levels.js";

interface TradeRouteDeps {
  getOrderExecution: () => OrderExecutionService | null;
  getCachedLevels: () => Record<string, SupportResistanceResult>;
  getPressure: (symbol: string) => PressureResult | null;
  getMomentum: (symbol: string) => MomentumResult | null;
  getRecentCandles: (symbol: string, n: number) => Candle[];
  getAllSymbols: () => string[];
  getAutoTrader?: () => AutoTrader | null;
  getDayLevels?: (symbol: string) => DayLevels | null;
  getSessionCandles?: (symbol: string) => Candle[];
}

// Trading endpoints — ADMIN only (this is your own account's money).
//
//   GET  /api/trade/config            mode (PAPER/LIVE), paper capital, trading hours
//   GET  /api/trade/setups            top setups near support/resistance (ready + on watch)
//   GET  /api/trade/margin            margin per share, available funds, max quantity
//   GET  /api/trade/auto              auto-trader status (paper only)   POST {enabled} switch on/off
//   POST /api/trade/mode              switch Paper / Real for the whole app  { mode, confirm }
//   GET  /api/trade/account           Zerodha funds + today's positions and P&L
//   POST /api/trades                  place a trade (entry + stop-loss + target)
//   GET  /api/trades                  your trades (?range=today|7d|30d|all&status=active&mode=PAPER|LIVE)
//   GET  /api/trades/stats            P&L statistics (?range&mode)
//   GET  /api/trades/:id              one trade + its event history
//   POST /api/trades/:id/exit         exit an open trade at market
export async function tradeRoute(fastify: FastifyInstance, deps: TradeRouteDeps) {
  const guard = { preHandler: [authMiddleware, adminGuard] };

  function service(): OrderExecutionService {
    const s = deps.getOrderExecution();
    if (!s) throw new TradeError(503, "Order service is not running.");
    return s;
  }

  function fail(reply: FastifyReply, err: unknown) {
    if (err instanceof TradeError) return reply.status(err.status).send({ error: err.message });
    console.error("[TradeRoute]", err);
    return reply.status(500).send({ error: "Something went wrong on the server. Check the server log." });
  }

  fastify.get("/api/trade/config", guard, async (_req, reply) => {
    try {
      return service().getConfig();
    } catch (e) {
      return fail(reply, e);
    }
  });

  // Global Paper / Real switch (navbar). Real needs { confirm: true }.
  fastify.post("/api/trade/mode", guard, async (req, reply) => {
    const b = (req.body ?? {}) as { mode?: unknown; confirm?: unknown };
    if (b.mode !== "PAPER" && b.mode !== "LIVE") return reply.status(400).send({ error: "mode must be PAPER or LIVE" });
    if (b.mode === "LIVE" && b.confirm !== true) return reply.status(400).send({ error: "Switching to real money needs confirmation." });
    try {
      const s = service();
      s.setMode(b.mode);
      return s.getConfig();
    } catch (e) {
      return fail(reply, e);
    }
  });

  // Account for the CURRENT mode: Zerodha funds + positions (Real), or paper balance + paper positions (Paper) + today's positions and P&L (cached 10 s)
  fastify.get("/api/trade/account", guard, async (_req, reply) => {
    try {
      return await service().getAccount();
    } catch (e) {
      return fail(reply, e);
    }
  });

  // Ranked setups (same list the auto-trader uses) — see lib/trade-setups.ts
  fastify.get("/api/trade/setups", guard, async (req) => {
    const limit = Math.min(20, Math.max(1, Number((req.query as { limit?: string }).limit) || 10));
    return buildTradeSetups(deps, limit);
  });

  // Auto-trader (paper only): status + on/off switch
  fastify.get("/api/trade/auto", guard, async (_req, reply) => {
    const a = deps.getAutoTrader?.();
    if (!a) return reply.status(503).send({ error: "Auto-trader is not running." });
    return a.status();
  });
  fastify.post("/api/trade/auto", guard, async (req, reply) => {
    const a = deps.getAutoTrader?.();
    if (!a) return reply.status(503).send({ error: "Auto-trader is not running." });
    const b = (req.body ?? {}) as { enabled?: unknown };
    if (typeof b.enabled !== "boolean") return reply.status(400).send({ error: "enabled must be true or false" });
    return a.setEnabled(b.enabled);
  });

  fastify.get("/api/trade/margin", guard, async (req, reply) => {
    const q = req.query as { symbol?: string; side?: string };
    if (!q.symbol) return reply.status(400).send({ error: "symbol is required" });
    const side = (q.side === "SELL" ? "SELL" : "BUY") as TradeSide;
    try {
      return await service().quoteMargin(q.symbol.toUpperCase(), side);
    } catch (e) {
      return fail(reply, e);
    }
  });

  fastify.post("/api/trades", guard, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    try {
      const trade = await service().placeTrade(req.user!.userId, {
        symbol: String(b.symbol ?? ""),
        side: b.side as TradeSide,
        quantity: Number(b.quantity),
        stopLoss: Number(b.stopLoss),
        target: Number(b.target),
        setup: typeof b.setup === "string" ? b.setup : null,
        confidence: typeof b.confidence === "number" ? b.confidence : null,
      });
      return reply.status(201).send({ trade });
    } catch (e) {
      return fail(reply, e);
    }
  });

  fastify.get("/api/trades", guard, async (req, reply) => {
    const q = req.query as { range?: string; status?: string; mode?: string };
    try {
      const rows = await service().listTrades(req.user!.userId, q);
      // live price for P&L on open positions (any tracked symbol, not just the dashboard's)
      return { trades: rows.map((t) => ({ ...t, ltp: marketDataService.getQuote(t.symbol)?.lastPrice ?? null })) };
    } catch (e) {
      return fail(reply, e);
    }
  });

  fastify.get("/api/trades/stats", guard, async (req, reply) => {
    const q = req.query as { range?: string; mode?: string };
    try {
      return await service().stats(req.user!.userId, q);
    } catch (e) {
      return fail(reply, e);
    }
  });

  fastify.get("/api/trades/:id", guard, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.status(400).send({ error: "Invalid trade id" });
    try {
      return await service().getTrade(req.user!.userId, id);
    } catch (e) {
      return fail(reply, e);
    }
  });

  fastify.post("/api/trades/:id/exit", guard, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.status(400).send({ error: "Invalid trade id" });
    try {
      return { trade: await service().exitTrade(req.user!.userId, id, "MANUAL") };
    } catch (e) {
      return fail(reply, e);
    }
  });
}
