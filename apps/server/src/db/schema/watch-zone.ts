import { pgTable, serial, uuid, varchar, numeric, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const watchZone = pgTable("watch_zone", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  symbol: varchar("symbol", { length: 50 }).notNull(),
  addedPrice: numeric("added_price", { precision: 12, scale: 2 }).notNull(),
  signalAction: varchar("signal_action", { length: 10 }).notNull(), // BUY or SELL
  signalType: varchar("signal_type", { length: 20 }), // BOUNCE, BREAKOUT, CONTINUATION, etc.
  addedAt: timestamp("added_at").defaultNow().notNull(),
});
