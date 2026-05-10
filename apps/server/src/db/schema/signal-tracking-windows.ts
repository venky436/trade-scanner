import { pgTable, serial, integer, varchar, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { signalTracking } from "./signal-tracking.js";

// Per-window outcome rows for the multi-window tracking experiment.
// One row per (signal × window). 3 rows are inserted at trigger time
// (windowMinutes = 4 / 8 / 12), each starting in PENDING; evaluate()
// locks each independently when its window elapses.
//
// The 8-min row is "canonical": when it locks, signal-tracking.service.ts
// also writes the same outcome into the parent signal_tracking row's
// outcome columns, so existing readers (Recent Signals table, social feed,
// /social/[id], legacy admin) keep working without joining this table.
export const signalTrackingWindows = pgTable("signal_tracking_windows", {
  id: serial("id").primaryKey(),

  signalId: integer("signal_id")
    .notNull()
    .references(() => signalTracking.id, { onDelete: "cascade" }),

  windowMinutes: integer("window_minutes").notNull(),

  status: varchar("status", { length: 10 }).notNull().default("PENDING"),

  priceAfter: numeric("price_after", { precision: 12, scale: 2 }),
  changePercent: numeric("change_percent", { precision: 8, scale: 4 }),
  changePoints: numeric("change_points", { precision: 12, scale: 2 }),

  maxPrice: numeric("max_price", { precision: 12, scale: 2 }),
  minPrice: numeric("min_price", { precision: 12, scale: 2 }),
  maxProfitPercent: numeric("max_profit_percent", { precision: 8, scale: 4 }),
  maxDrawdownPercent: numeric("max_drawdown_percent", { precision: 8, scale: 4 }),

  evaluatedAt: timestamp("evaluated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  signalIdIdx: index("idx_stw_signal").on(t.signalId),
  pendingIdx: index("idx_stw_pending").on(t.status),
}));
