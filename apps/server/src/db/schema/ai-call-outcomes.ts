import { pgTable, integer, varchar, numeric, timestamp, boolean } from "drizzle-orm/pg-core";
import { aiCalls } from "./ai-calls.js";

// Outcome rows for each ai_calls entry, filled by the background evaluator
// (`ai-outcome.service.ts`) at the 15m / 30m / 60m marks. One-to-one with
// `ai_calls` via the FK primary key — cascade-deletes when the parent is
// archived/removed.
//
// Status values:
//   PENDING      — window not yet elapsed
//   SUCCESS      — verdict was BUY/SELL and price moved in direction
//   FAILED       — verdict was BUY/SELL and price moved against
//   NEUTRAL      — directional verdict but |change| within ±0.2% dead-zone
//   WAIT_OK      — verdict was WAIT and stock stayed within ±1 ATR (good call)
//   WAIT_MISSED  — verdict was WAIT but stock moved sharply (missed opportunity)
//
// The "max favorable / adverse" fields track best/worst excursion in the
// direction of the trade — used for slippage analysis + R-multiple stats.
export const aiCallOutcomes = pgTable("ai_call_outcomes", {
  aiCallId: integer("ai_call_id")
    .primaryKey()
    .references(() => aiCalls.id, { onDelete: "cascade" }),

  outcome15m: varchar("outcome_15m", { length: 15 }),
  outcome30m: varchar("outcome_30m", { length: 15 }),
  outcome60m: varchar("outcome_60m", { length: 15 }),

  maxFavorablePct: numeric("max_favorable_pct", { precision: 8, scale: 4 }),
  maxAdversePct: numeric("max_adverse_pct", { precision: 8, scale: 4 }),

  targetHit: boolean("target_hit"),
  stopHit: boolean("stop_hit"),

  evaluatedAt: timestamp("evaluated_at").defaultNow(),
});
