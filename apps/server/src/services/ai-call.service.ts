import { db } from "../db/index.js";
import { aiCalls } from "../db/schema/ai-calls.js";
import { marketDataService } from "./market-data.service.js";
import { toIntelligence, buildMarketContext } from "../lib/intelligence-transformer.js";
import { detectPattern } from "../lib/pattern-engine.js";
import { computeATR } from "../lib/atr.js";
import { computeRvol } from "../lib/volatility-metrics.js";
import { isIndexSymbol } from "../lib/index-symbols.js";
import { selectAiTargets } from "../lib/section-selector.js";
import { callGemini, GEMINI_MODEL } from "../lib/gemini-client.js";
import {
  AI_SYSTEM_PROMPT,
  AI_RESPONSE_SCHEMA,
  PROMPT_VERSION,
  buildUserPrompt,
  getSessionForIst,
  type AiVerdictResponse,
} from "../lib/ai-prompt.js";
import { validateAiResponse } from "../lib/ai-validate.js";
import { computeMarketRegime, type MarketRegime } from "../lib/market-regime.js";
import { getAiModeEnabled } from "../lib/runtime-config.js";
import type { Candle, IntelligenceSnapshot, MarketContext, PressureResult, MomentumResult, SupportResistanceResult, PatternSignal } from "../lib/types.js";

// ── Constants ─────────────────────────────────────────────────────────────
const TICK_INTERVAL_MS = 5 * 60_000;             // 5 min between cycles
const ACTIVE_WINDOW_START_MIN = 9 * 60 + 45;     // 09:45 IST
const ACTIVE_WINDOW_END_MIN = 15 * 60 + 30;      // 15:30 IST
const CACHE_TTL_MS = 5 * 60_000;                 // 5 min TTL for cached verdicts
const ON_DEMAND_RATE_LIMIT_MS = 60_000;          // 1 forced refresh per symbol per 60 s
const RECENT_CANDLE_COUNT = 24;                  // 2 hr window passed to AI
const STOCK_UNIVERSE_CAP = 500;                  // safety: never iterate more than this

// ── Public record shape (what the cache + route return) ────────────────────
export interface AiCallRecord extends AiVerdictResponse {
  /** Database id of the persisted row. */
  id: number;
  symbol: string;
  computedAt: number;
  ruleVerdict: "BUY" | "SELL" | "WAIT";
  ruleConfidence: number;
  marketRegime: MarketRegime;
  /** True when validate() forced a downgrade — useful for the admin page. */
  downgraded: boolean;
  downgradeReason: string | null;
}

// ── Dependencies (mirror signal-tracking.service.ts pattern) ───────────────
export interface AiCallServiceDeps {
  getCachedLevels: () => Record<string, SupportResistanceResult>;
  getPressure: (symbol: string) => PressureResult | null;
  getMomentum: (symbol: string) => MomentumResult | null;
  getRecentCandles: (symbol: string, n: number) => Candle[];
  /** All tracked symbols (for building the snapshot pool). */
  getAllSymbols: () => string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function nowIstTotalMinutes(date = new Date()): number {
  // IST = UTC + 5:30
  return (date.getUTCHours() * 60 + date.getUTCMinutes() + 330) % (24 * 60);
}

function isWithinActiveWindow(date = new Date()): boolean {
  const m = nowIstTotalMinutes(date);
  return m >= ACTIVE_WINDOW_START_MIN && m < ACTIVE_WINDOW_END_MIN;
}

function mapOutlookToRuleVerdict(outlook: string): "BUY" | "SELL" | "WAIT" {
  if (outlook === "BOUNCE_EXPECTED" || outlook === "BREAKOUT_LIKELY") return "BUY";
  if (outlook === "REJECTION_POSSIBLE" || outlook === "BREAKDOWN_RISK") return "SELL";
  return "WAIT";
}

/**
 * Build an IntelligenceSnapshot for one symbol from the live in-memory
 * state. Uses the same code path the WebSocket broadcast uses
 * (`toIntelligence()`), so the AI sees identical numbers to the user.
 */
function buildSnapshot(
  symbol: string,
  deps: AiCallServiceDeps,
): { intel: IntelligenceSnapshot; candles: Candle[] } | null {
  const quote = marketDataService.getQuote(symbol);
  if (!quote || quote.lastPrice <= 0) return null;

  const sr = deps.getCachedLevels()[symbol] ?? null;
  const momentum = deps.getMomentum(symbol);
  const pressure = deps.getPressure(symbol);
  const candles = deps.getRecentCandles(symbol, RECENT_CANDLE_COUNT);

  const intel = toIntelligence({
    symbol,
    price: quote.lastPrice,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    close: quote.close,
    timestamp: quote.timestamp,
    pressure,
    momentum,
    sr,
    recentCandles: candles,
  });

  return { intel, candles };
}

// ── Service factory ────────────────────────────────────────────────────────

export interface AiCallService {
  start(): void;
  stop(): void;
  /** Force a fresh call for one symbol (rate-limited). */
  evaluateOnDemand(symbol: string): Promise<AiCallRecord | null>;
  /** Cached call for one symbol (may be stale up to CACHE_TTL_MS). */
  getCached(symbol: string): AiCallRecord | null;
  /** Snapshot of all non-expired cached calls. */
  getAllCached(): AiCallRecord[];
}

export function createAiCallService(deps: AiCallServiceDeps): AiCallService {
  const cache = new Map<string, AiCallRecord>();
  // Map symbol → in-flight Promise so concurrent callers share the result
  // (was a Set — that caused React StrictMode double-mount on the frontend
  // to receive null on the second call while the first was still in flight,
  // surfacing as a spurious 503 to the user).
  const inflight = new Map<string, Promise<AiCallRecord | null>>();
  const lastOnDemandAt = new Map<string, number>();
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let marketContextCache: { ctx: MarketContext | null; regime: MarketRegime; computedAt: number } | null = null;

  function getCached(symbol: string): AiCallRecord | null {
    const c = cache.get(symbol);
    if (!c) return null;
    if (Date.now() - c.computedAt > CACHE_TTL_MS) return null;
    return c;
  }

  function getAllCached(): AiCallRecord[] {
    const out: AiCallRecord[] = [];
    const cutoff = Date.now() - CACHE_TTL_MS;
    for (const r of cache.values()) {
      if (r.computedAt >= cutoff) out.push(r);
    }
    return out.sort((a, b) => b.computedAt - a.computedAt);
  }

  function ensureMarketContext(): { ctx: MarketContext | null; regime: MarketRegime } {
    const now = Date.now();
    if (marketContextCache && now - marketContextCache.computedAt < TICK_INTERVAL_MS) {
      return { ctx: marketContextCache.ctx, regime: marketContextCache.regime };
    }
    const niftyQuote = marketDataService.getQuote("NIFTY 50") ?? null;
    const bankNiftyQuote = marketDataService.getQuote("NIFTY BANK") ?? null;
    const ctx = niftyQuote || bankNiftyQuote
      ? buildMarketContext(niftyQuote, bankNiftyQuote)
      : null;
    const regime = computeMarketRegime(ctx);
    marketContextCache = { ctx, regime, computedAt: now };
    return { ctx, regime };
  }

  /**
   * Pure data-gathering for one symbol. Returns the validated AI response
   * + everything needed to persist. Returns null when the call failed
   * end-to-end (Gemini error, missing data, etc.) — caller logs + skips.
   */
  async function performCall(
    symbol: string,
  ): Promise<AiCallRecord | null> {
    // Defensive guard 3 — never call Gemini when the flag is off
    if (!getAiModeEnabled()) {
      throw new Error("[ai-call] evaluate() called with AI_MODE_ENABLED disabled — bug?");
    }

    const snap = buildSnapshot(symbol, deps);
    if (!snap) return null;

    const { intel, candles } = snap;
    const sr = deps.getCachedLevels()[symbol] ?? null;
    const pressure = deps.getPressure(symbol);
    const atr = computeATR(candles, 14) ?? 0;
    const rvol = computeRvol(candles);
    const pattern: PatternSignal | null = sr
      ? detectPattern({
          candles,
          currentPrice: intel.price,
          supportZone: sr.supportZone,
          resistanceZone: sr.resistanceZone,
          pressure,
        })
      : null;
    const { ctx: market, regime } = ensureMarketContext();
    const session = getSessionForIst();

    const userPrompt = buildUserPrompt({
      snapshot: intel,
      supportLevel: sr?.supportZone?.level ?? null,
      resistanceLevel: sr?.resistanceZone?.level ?? null,
      atr,
      rvol,
      pattern,
      recentCandles: candles,
      market,
      marketRegime: regime,
      session,
    });

    const result = await callGemini<AiVerdictResponse>({
      systemPrompt: AI_SYSTEM_PROMPT,
      userPrompt,
      responseSchema: AI_RESPONSE_SCHEMA,
    });

    if (!result.data) {
      console.warn(`[AI] ${symbol} Gemini call failed: ${result.error} (${result.stats.durationMs}ms)`);
      return null;
    }

    const { response: validated, downgraded, downgradeReason } = validateAiResponse(result.data, {
      atr,
      supportLevel: sr?.supportZone?.level ?? null,
      resistanceLevel: sr?.resistanceZone?.level ?? null,
    });

    // Build the row + persist
    const ruleVerdict = mapOutlookToRuleVerdict(intel.outlook);
    const metricsSnapshot = {
      intelligence: intel,
      market,
      session,
      atr,
      rvol,
      supportLevel: sr?.supportZone?.level ?? null,
      resistanceLevel: sr?.resistanceZone?.level ?? null,
      pattern,
    };

    try {
      const [inserted] = await db
        .insert(aiCalls)
        .values({
          symbol,
          modelName: GEMINI_MODEL,
          promptVersion: PROMPT_VERSION,
          verdict: validated.verdict,
          confidence: validated.confidence.toFixed(3),
          patterns: validated.patterns,
          reasons: validated.reasons,
          reasoning: validated.reasoning,
          riskFlags: validated.risk_flags,
          entry: validated.entry != null ? validated.entry.toFixed(2) : null,
          stopLoss: validated.stopLoss != null ? validated.stopLoss.toFixed(2) : null,
          target: validated.target != null ? validated.target.toFixed(2) : null,
          riskReward: validated.riskReward != null ? validated.riskReward.toFixed(2) : null,
          ruleVerdict,
          ruleConfidence: intel.confidence.toFixed(3),
          marketRegime: regime,
          metricsSnapshot: metricsSnapshot as unknown as Record<string, unknown>,
          rawResponse: (result.raw ?? {}) as Record<string, unknown>,
        })
        .returning({ id: aiCalls.id });

      const record: AiCallRecord = {
        ...validated,
        id: inserted.id,
        symbol,
        computedAt: Date.now(),
        ruleVerdict,
        ruleConfidence: intel.confidence,
        marketRegime: regime,
        downgraded,
        downgradeReason,
      };
      cache.set(symbol, record);

      const tokenInfo = result.stats.inputTokens != null
        ? `[${result.stats.inputTokens}in/${result.stats.outputTokens ?? 0}out, ${result.stats.durationMs}ms]`
        : `[${result.stats.durationMs}ms]`;
      const downgradeNote = downgraded ? ` ⚠downgraded: ${downgradeReason}` : "";
      console.log(`[AI] ${symbol}: ${validated.verdict} (rule=${ruleVerdict}, conf=${validated.confidence.toFixed(2)}) ${tokenInfo}${downgradeNote}`);

      return record;
    } catch (err) {
      console.warn(`[AI] ${symbol} DB persist failed:`, (err as Error).message);
      return null;
    }
  }

  async function evaluate(symbol: string, source: "scheduled" | "on-demand"): Promise<AiCallRecord | null> {
    // Share the in-flight promise so concurrent callers get the same result.
    // This is the key dedup that prevents React StrictMode's double-mount
    // from producing a spurious 503 on the second POST.
    const existing = inflight.get(symbol);
    if (existing) return existing;

    const promise = (async () => {
      try {
        const record = await performCall(symbol);
        if (source === "on-demand") lastOnDemandAt.set(symbol, Date.now());
        return record;
      } finally {
        inflight.delete(symbol);
      }
    })();
    inflight.set(symbol, promise);
    return promise;
  }

  async function evaluateOnDemand(symbol: string): Promise<AiCallRecord | null> {
    if (!getAiModeEnabled()) return null;

    // Rate limit: serve cache if within the cooldown
    const lastAt = lastOnDemandAt.get(symbol);
    if (lastAt && Date.now() - lastAt < ON_DEMAND_RATE_LIMIT_MS) {
      const cached = getCached(symbol);
      if (cached) return cached;
    }
    return evaluate(symbol, "on-demand");
  }

  async function tick(): Promise<void> {
    if (!isWithinActiveWindow()) return;
    if (!getAiModeEnabled()) return;

    // Build full snapshot pool from the in-memory market data, then run the
    // shared selector. This is the SAME logic the frontend will use via the
    // sections endpoint, so the user and the AI see the same stocks.
    const symbols = deps.getAllSymbols().slice(0, STOCK_UNIVERSE_CAP);
    const pool: IntelligenceSnapshot[] = [];
    for (const sym of symbols) {
      if (isIndexSymbol(sym)) continue;
      const snap = buildSnapshot(sym, deps);
      if (snap) pool.push(snap.intel);
    }

    const targets = selectAiTargets(pool);
    if (targets.length === 0) {
      console.log(`[AI] Cycle: no targets met selection criteria (pool=${pool.length})`);
      return;
    }

    const t0 = Date.now();
    const results = await Promise.allSettled(targets.map((t) => evaluate(t.symbol, "scheduled")));
    const ok = results.filter((r) => r.status === "fulfilled" && r.value).length;
    const fail = results.length - ok;
    console.log(`[AI] Cycle: ${ok}/${targets.length} evaluated (${fail} failed/skipped) in ${Date.now() - t0}ms`);
  }

  function start(): void {
    if (tickTimer) return;
    if (!getAiModeEnabled()) return; // safety — caller shouldn't have called us
    console.log(`[AI] Scheduler started — top stocks every ${TICK_INTERVAL_MS / 60_000} min, active ${Math.floor(ACTIVE_WINDOW_START_MIN / 60)}:${String(ACTIVE_WINDOW_START_MIN % 60).padStart(2, "0")}–${Math.floor(ACTIVE_WINDOW_END_MIN / 60)}:${String(ACTIVE_WINDOW_END_MIN % 60).padStart(2, "0")} IST. Model=${GEMINI_MODEL} prompt=${PROMPT_VERSION}`);
    // Kick first tick after a 10s warmup so quote map is populated
    setTimeout(() => { void tick(); }, 10_000);
    tickTimer = setInterval(() => { void tick(); }, TICK_INTERVAL_MS);
  }

  function stop(): void {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
      console.log("[AI] Scheduler stopped");
    }
  }

  return { start, stop, evaluateOnDemand, getCached, getAllCached };
}
