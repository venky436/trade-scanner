import { pgTable, serial, varchar, numeric, timestamp, text, jsonb, index } from "drizzle-orm/pg-core";

// Persists every AI verdict call (Gemini's response per stock per cycle).
// One row per call. Outcomes live in the sibling `ai_call_outcomes` table.
//
// Design notes:
//   - `model_name` + `prompt_version` make stats comparable across model swaps
//     and prompt edits. Aggregating without these would mix incompatible runs.
//   - `metrics_snapshot` + `raw_response` are the prompt-debug + replay path.
//     Without them you cannot reproduce why AI made a given call later.
//   - `rule_verdict` is the snapshot of the deterministic rule engine at the
//     same moment — used by the agreement-matrix admin page.
//   - Cleanup: archive (not delete) rows older than 90 days into
//     `ai_calls_archive` via a separate cron — see plan §13.
export const aiCalls = pgTable("ai_calls", {
  id: serial("id").primaryKey(),

  symbol: varchar("symbol", { length: 50 }).notNull(),
  computedAt: timestamp("computed_at").defaultNow().notNull(),

  // Versioning — never aggregate without filtering on these
  modelName: varchar("model_name", { length: 100 }).notNull(),
  promptVersion: varchar("prompt_version", { length: 50 }).notNull(),

  // The verdict itself
  verdict: varchar("verdict", { length: 10 }).notNull(),                    // BUY / SELL / WAIT
  confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),  // 0..1, RANK not probability
  patterns: text("patterns").array(),                                       // free-form pattern names
  reasons: text("reasons").array(),                                         // enum codes
  reasoning: text("reasoning").notNull(),                                   // 2-3 sentence narrative
  riskFlags: text("risk_flags").array(),                                    // enum codes

  // Trade plan (nullable when verdict = WAIT)
  entry: numeric("entry", { precision: 12, scale: 2 }),
  stopLoss: numeric("stop_loss", { precision: 12, scale: 2 }),
  target: numeric("target", { precision: 12, scale: 2 }),
  riskReward: numeric("risk_reward", { precision: 5, scale: 2 }),

  // Snapshot of rule engine at the same instant — for agreement matrix
  ruleVerdict: varchar("rule_verdict", { length: 10 }).notNull(),
  ruleConfidence: numeric("rule_confidence", { precision: 4, scale: 3 }).notNull(),

  // Broader context at call time
  marketRegime: varchar("market_regime", { length: 20 }).notNull(),         // TRENDING_UP / TRENDING_DOWN / RANGING / HIGH_VOLATILITY

  // Replay + debug
  metricsSnapshot: jsonb("metrics_snapshot").notNull(),  // full prompt inputs (IntelligenceSnapshot + market ctx)
  rawResponse: jsonb("raw_response").notNull(),          // full Gemini response, pre-validation
}, (t) => ({
  symbolTimeIdx: index("idx_ai_calls_symbol_time").on(t.symbol, t.computedAt),
  verdictIdx: index("idx_ai_calls_verdict").on(t.verdict, t.computedAt),
}));
