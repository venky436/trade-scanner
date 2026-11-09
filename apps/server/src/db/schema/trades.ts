import { pgTable, serial, integer, uuid, varchar, numeric, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";

// ── Manual / automated trades placed through Zerodha (or simulated in PAPER mode) ──
//
// ONE row per trade. The row is created the moment you click BUY/SELL and is
// UPDATED IN PLACE as Zerodha reports back (entry filled → stop-loss + target
// placed → one of them hits → closed), so this table always shows the latest
// state of every trade. The full history of what happened is in trade_events.
//
// status lifecycle:
//   PENDING       row created, entry order not sent yet
//   ENTRY_PLACED  entry (MARKET, MIS) sent to Zerodha, waiting for fill
//   OPEN          entry filled; stop-loss + target orders are live
//   EXITING       manual exit / 15:15 square-off in progress
//   CLOSED        position closed — see exit_reason (TARGET / STOP_LOSS / MANUAL / SQUARE_OFF)
//   REJECTED      Zerodha rejected or cancelled the entry — see status_message
//   FAILED        could not even send the entry (API error, not connected, …)
//   UNPROTECTED   ⚠ position may be open WITHOUT a working stop-loss — act in Kite now
export const trades = pgTable(
  "trades",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    mode: varchar("mode", { length: 5 }).notNull(), // PAPER | LIVE
    symbol: varchar("symbol", { length: 50 }).notNull(),
    exchange: varchar("exchange", { length: 10 }).notNull().default("NSE"),
    side: varchar("side", { length: 4 }).notNull(), // BUY | SELL (entry side)
    quantity: integer("quantity").notNull(),
    product: varchar("product", { length: 5 }).notNull().default("MIS"),

    // What you saw when you clicked
    ltpAtOrder: numeric("ltp_at_order", { precision: 12, scale: 2 }).notNull(),
    stopLoss: numeric("stop_loss", { precision: 12, scale: 2 }).notNull(),
    target: numeric("target", { precision: 12, scale: 2 }).notNull(),
    marginRequired: numeric("margin_required", { precision: 14, scale: 2 }),
    marginAvailable: numeric("margin_available", { precision: 14, scale: 2 }),
    setup: varchar("setup", { length: 30 }), // e.g. BOUNCE_EXPECTED (from the scanner)
    confidence: numeric("confidence", { precision: 5, scale: 2 }), // 0..1

    // Lifecycle
    status: varchar("status", { length: 20 }).notNull(),
    statusMessage: text("status_message"),

    entryOrderId: varchar("entry_order_id", { length: 40 }),
    entryStatus: varchar("entry_status", { length: 30 }),
    entryPrice: numeric("entry_price", { precision: 12, scale: 2 }), // average fill
    filledQty: integer("filled_qty"),

    slOrderId: varchar("sl_order_id", { length: 40 }),
    slStatus: varchar("sl_status", { length: 30 }),
    targetOrderId: varchar("target_order_id", { length: 40 }),
    targetStatus: varchar("target_status", { length: 30 }),
    exitOrderId: varchar("exit_order_id", { length: 40 }),
    exitStatus: varchar("exit_status", { length: 30 }),

    exitPrice: numeric("exit_price", { precision: 12, scale: 2 }),
    exitReason: varchar("exit_reason", { length: 20 }), // TARGET | STOP_LOSS | MANUAL | SQUARE_OFF
    pnl: numeric("pnl", { precision: 14, scale: 2 }), // gross, before brokerage/taxes

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    entryAt: timestamp("entry_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    index("trades_user_created_idx").on(t.userId, t.createdAt),
    index("trades_status_idx").on(t.status),
  ],
);

// Append-only audit log: every state change and every raw Zerodha order update.
export const tradeEvents = pgTable(
  "trade_events",
  {
    id: serial("id").primaryKey(),
    tradeId: integer("trade_id").notNull().references(() => trades.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    type: varchar("type", { length: 40 }).notNull(), // CREATED, ENTRY_PLACED, ORDER_UPDATE, SL_PLACED, CLOSED, ERROR …
    message: text("message"),
    data: jsonb("data"),
  },
  (t) => [index("trade_events_trade_idx").on(t.tradeId)],
);

export type Trade = typeof trades.$inferSelect;
export type TradeEvent = typeof tradeEvents.$inferSelect;
