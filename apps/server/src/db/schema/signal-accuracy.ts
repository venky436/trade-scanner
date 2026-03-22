import { pgTable, serial, varchar, integer, numeric, timestamp } from "drizzle-orm/pg-core";

export const signalAccuracyLog = pgTable("signal_accuracy_log", {
  id: serial("id").primaryKey(),

  symbol: varchar("symbol", { length: 50 }).notNull(),
  signalType: varchar("signal_type", { length: 20 }).notNull(), // BREAKOUT/BREAKDOWN/BOUNCE/REJECTION
  action: varchar("action", { length: 10 }).notNull(), // BUY/SELL

  signalScore: integer("signal_score").notNull(),

  entryPrice: numeric("entry_price", { precision: 12, scale: 2 }).notNull(),
  entryTime: timestamp("entry_time").notNull(),

  targetPrice: numeric("target_price", { precision: 12, scale: 2 }).notNull(),
  stopLoss: numeric("stop_loss", { precision: 12, scale: 2 }).notNull(),

  evaluationTime: timestamp("evaluation_time").notNull(),

  maxPrice: numeric("max_price", { precision: 12, scale: 2 }),
  minPrice: numeric("min_price", { precision: 12, scale: 2 }),
  finalPrice: numeric("final_price", { precision: 12, scale: 2 }),

  targetHitTime: timestamp("target_hit_time"),
  stopHitTime: timestamp("stop_hit_time"),

  result: varchar("result", { length: 10 }), // SUCCESS/FAILED/NEUTRAL

  createdAt: timestamp("created_at").defaultNow().notNull(),
});
