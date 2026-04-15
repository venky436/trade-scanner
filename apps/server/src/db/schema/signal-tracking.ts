import { pgTable, serial, varchar, numeric, timestamp } from "drizzle-orm/pg-core";

export const signalTracking = pgTable("signal_tracking", {
  id: serial("id").primaryKey(),

  symbol: varchar("symbol", { length: 50 }).notNull(),
  signalTime: timestamp("signal_time").notNull(),
  priceAtSignal: numeric("price_at_signal", { precision: 12, scale: 2 }).notNull(),

  outlook: varchar("outlook", { length: 30 }).notNull(),
  confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
  confidenceBucket: varchar("confidence_bucket", { length: 15 }).notNull(),
  zone: varchar("zone", { length: 20 }).notNull(),
  bias: varchar("bias", { length: 10 }).notNull(),

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
});
