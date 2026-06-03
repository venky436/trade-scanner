import type { FastifyInstance } from "fastify";
import { gte, lte, and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { aiCalls } from "../db/schema/ai-calls.js";
import { aiCallOutcomes } from "../db/schema/ai-call-outcomes.js";
import { authMiddleware, adminGuard } from "../modules/auth/auth.middleware.js";

// AI performance + agreement matrix admin endpoint. Single GET that returns
// everything the /admin/ai-performance dashboard needs in one shot.
//
// Stats are always returned WITH sample counts (n=X). Never display a
// percentage in the UI without showing n alongside.

interface OutcomeRow {
  ai_call_id: number;
  outcome_15m: string | null;
  outcome_30m: string | null;
  outcome_60m: string | null;
  max_favorable_pct: string | null;
  max_adverse_pct: string | null;
}

interface CallRow {
  id: number;
  symbol: string;
  computed_at: Date;
  model_name: string;
  prompt_version: string;
  verdict: string;
  confidence: string;
  rule_verdict: string;
  rule_confidence: string;
  market_regime: string;
  risk_reward: string | null;
}

type WindowKey = "outcome_15m" | "outcome_30m" | "outcome_60m";
const WINDOW_KEYS: WindowKey[] = ["outcome_15m", "outcome_30m", "outcome_60m"];

interface PerWindowStats {
  window: WindowKey;
  decided: number;
  success: number;
  failed: number;
  neutral: number;
  waitOk: number;
  waitMissed: number;
  /** wins / (wins + losses). NEUTRAL + WAIT_* excluded from denominator. */
  winRate: number;
  /** Average % gain across SUCCESS rows (magnitude). */
  avgGain: number;
  /** Average % loss across FAILED rows (magnitude). */
  avgLoss: number;
  /** (winRate × avgGain) − (lossRate × avgLoss). The single number that matters. */
  expectancy: number;
  /** avgGain / avgLoss when both > 0; else null. */
  riskReward: number | null;
}

interface AgreementCell {
  /** Decided count (SUCCESS + FAILED, NEUTRAL/WAIT excluded). */
  n: number;
  /** Win rate among decided (success / decided). Null when n=0. */
  winRate: number | null;
  /** Total rows in this cell including PENDING/NEUTRAL/WAIT_OK/WAIT_MISSED. */
  totalRows: number;
}

interface AgreementMatrix {
  // Rows = rule verdict; columns = AI verdict
  rule_BUY:  { ai_BUY: AgreementCell; ai_SELL: AgreementCell; ai_WAIT: AgreementCell };
  rule_SELL: { ai_BUY: AgreementCell; ai_SELL: AgreementCell; ai_WAIT: AgreementCell };
  rule_WAIT: { ai_BUY: AgreementCell; ai_SELL: AgreementCell; ai_WAIT: AgreementCell };
}

function buildPerWindowStats(window: WindowKey, joined: Array<{ call: CallRow; outcome: OutcomeRow | null }>): PerWindowStats {
  let success = 0, failed = 0, neutral = 0, waitOk = 0, waitMissed = 0;
  let avgGainSum = 0, avgLossSum = 0;
  for (const { outcome } of joined) {
    const v = outcome?.[window];
    if (!v) continue;
    switch (v) {
      case "SUCCESS":
        success++;
        if (outcome?.max_favorable_pct != null) {
          avgGainSum += Math.abs(Number(outcome.max_favorable_pct));
        }
        break;
      case "FAILED":
        failed++;
        if (outcome?.max_adverse_pct != null) {
          avgLossSum += Math.abs(Number(outcome.max_adverse_pct));
        }
        break;
      case "NEUTRAL":  neutral++; break;
      case "WAIT_OK":  waitOk++; break;
      case "WAIT_MISSED": waitMissed++; break;
    }
  }
  const decided = success + failed;
  const winRate = decided > 0 ? success / decided : 0;
  const avgGain = success > 0 ? avgGainSum / success : 0;
  const avgLoss = failed > 0 ? avgLossSum / failed : 0;
  const lossRate = decided > 0 ? failed / decided : 0;
  const expectancy = winRate * avgGain - lossRate * avgLoss;
  const riskReward = avgLoss > 0 ? avgGain / avgLoss : null;
  return {
    window,
    decided,
    success,
    failed,
    neutral,
    waitOk,
    waitMissed,
    winRate,
    avgGain,
    avgLoss,
    expectancy,
    riskReward,
  };
}

function buildAgreementMatrix(joined: Array<{ call: CallRow; outcome: OutcomeRow | null }>): AgreementMatrix {
  // Use 60-min outcome as the canonical outcome for the matrix
  const empty = (): AgreementCell => ({ n: 0, winRate: null, totalRows: 0 });
  const make = () => ({ ai_BUY: empty(), ai_SELL: empty(), ai_WAIT: empty() });
  const matrix: AgreementMatrix = {
    rule_BUY: make(),
    rule_SELL: make(),
    rule_WAIT: make(),
  };
  const wins: Record<string, number> = {};
  for (const { call, outcome } of joined) {
    const ruleKey = `rule_${call.rule_verdict}` as keyof AgreementMatrix;
    const aiKey = `ai_${call.verdict}` as keyof AgreementMatrix["rule_BUY"];
    const cell = matrix[ruleKey]?.[aiKey];
    if (!cell) continue;
    cell.totalRows++;
    const o = outcome?.outcome_60m;
    if (o === "SUCCESS" || o === "FAILED") {
      cell.n++;
      const k = `${ruleKey}|${aiKey}`;
      if (o === "SUCCESS") wins[k] = (wins[k] ?? 0) + 1;
    }
  }
  // Compute win rates
  for (const ruleKey of ["rule_BUY", "rule_SELL", "rule_WAIT"] as const) {
    for (const aiKey of ["ai_BUY", "ai_SELL", "ai_WAIT"] as const) {
      const cell = matrix[ruleKey][aiKey];
      if (cell.n > 0) cell.winRate = (wins[`${ruleKey}|${aiKey}`] ?? 0) / cell.n;
    }
  }
  return matrix;
}

interface AdminAiOpts {
  // No deps needed — reads directly from DB.
}

export async function adminAiRoute(fastify: FastifyInstance, _opts: AdminAiOpts = {}) {
  /**
   * GET /api/admin/ai-performance?days=30
   * Returns per-window stats + agreement matrix for the last N days.
   * Admin-only. All percentages include sample counts.
   */
  fastify.get("/api/admin/ai-performance", { preHandler: [authMiddleware, adminGuard] }, async (req) => {
    const { days } = req.query as { days?: string };
    const daysBack = Math.max(1, Math.min(180, days ? Number(days) : 30));
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60_000);

    const calls = await db
      .select()
      .from(aiCalls)
      .where(gte(aiCalls.computedAt, since));

    if (calls.length === 0) {
      return {
        days: daysBack,
        totalCalls: 0,
        windows: [],
        agreementMatrix: null,
        byRegime: {},
        bySession: {},
      };
    }

    const callIds = calls.map((c) => c.id);
    const outcomes = callIds.length > 0
      ? await db
          .select()
          .from(aiCallOutcomes)
          .where(eq(aiCallOutcomes.aiCallId, callIds[0])) // placeholder; replaced below
      : [];
    // ^ drizzle's inArray would be ideal; doing it manually to keep imports minimal
    const allOutcomes = await db.select().from(aiCallOutcomes);
    const outcomeMap = new Map(allOutcomes.map((o) => [o.aiCallId, o as unknown as OutcomeRow]));

    const joined = calls.map((c) => ({
      call: c as unknown as CallRow,
      outcome: outcomeMap.get(c.id) ?? null,
    }));

    return {
      days: daysBack,
      totalCalls: calls.length,
      windows: WINDOW_KEYS.map((w) => buildPerWindowStats(w, joined)),
      agreementMatrix: buildAgreementMatrix(joined),
    };
  });
}
