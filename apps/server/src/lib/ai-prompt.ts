import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Candle,
  IntelligenceSnapshot,
  MarketContext,
  PatternSignal,
} from "./types.js";
import { Type, type Schema } from "./gemini-client.js";
import type { MarketRegime } from "./market-regime.js";

// Owns:
//   - AI_SYSTEM_PROMPT  (loaded once at module init from docs/AI_REFERENCE.md)
//   - PROMPT_VERSION    (bump when prompt or schema changes — persisted in DB)
//   - buildUserPrompt() (per-call structured data dump, NO rule verdict)
//   - AI_RESPONSE_SCHEMA (Gemini-enforced JSON shape)
//
// PROMPT_VERSION discipline: every change to system prompt OR user prompt
// format OR response schema MUST bump this string. The DB column is the only
// way later analytics can avoid mixing apples and oranges across iterations.

export const PROMPT_VERSION = "v3.0" as const;

// ─── System prompt (one-time, baked) ────────────────────────────────────────
// Resolves docs/AI_REFERENCE.md relative to the server's cwd (apps/server)
// so it works in both `bun run dev` and the compiled docker image.
function loadSystemPrompt(): string {
  const candidates = [
    join(process.cwd(), "../../docs/AI_REFERENCE.md"),  // from apps/server in monorepo
    join(process.cwd(), "docs/AI_REFERENCE.md"),         // from repo root
  ];
  for (const path of candidates) {
    try {
      return readFileSync(path, "utf-8");
    } catch {
      // Try next candidate
    }
  }
  throw new Error(
    "AI_REFERENCE.md not found — expected at docs/AI_REFERENCE.md relative to repo root. " +
    "Check that the file exists and the server is started from the correct cwd.",
  );
}

export const AI_SYSTEM_PROMPT = loadSystemPrompt();

// ─── User prompt builder ────────────────────────────────────────────────────

export type Session = "OPENING" | "MID" | "CLOSING";

export interface PromptInput {
  snapshot: IntelligenceSnapshot;
  /** Resolved support level ₹ — may be the same as snapshot.context.level if zone=NEAR_SUPPORT */
  supportLevel: number | null;
  /** Resolved resistance level ₹ */
  resistanceLevel: number | null;
  /** ATR(14) in ₹. May be 0 when insufficient candles. */
  atr: number;
  /** Relative volume — current 5-min vol ÷ 20-day avg 5-min vol. Null when avg unknown. */
  rvol: number | null;
  /** Pattern engine output for the most recent candles. May be null. */
  pattern: PatternSignal | null;
  /** Last N × 5-min candles (oldest first). */
  recentCandles: Candle[];
  /** Cached market context (computed once per scheduler cycle). */
  market: MarketContext | null;
  /** Pre-computed regime label. */
  marketRegime: MarketRegime;
  /** Sector trend label, if known. Optional. */
  sectorTrend?: string;
  /** Session bucket derived from current IST time. */
  session: Session;
}

function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function fmtPrice(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return `₹${n.toFixed(digits)}`;
}

function fmtRvol(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return `${n.toFixed(2)}x`;
}

function fmtCandle(c: Candle): string {
  // Compact one-line row. Time is shown as HH:MM IST when computable, else seconds-since-epoch.
  const tsMs = c.time > 1e12 ? c.time : c.time * 1000;
  const d = new Date(tsMs);
  const istHours = String((d.getUTCHours() + 5) % 24).padStart(2, "0");
  // Account for the 30-min IST offset from UTC
  const istMins = String((d.getUTCMinutes() + 30) % 60).padStart(2, "0");
  return `  ${istHours}:${istMins}  O ${c.open.toFixed(2)}  H ${c.high.toFixed(2)}  L ${c.low.toFixed(2)}  C ${c.close.toFixed(2)}  vol ${c.volume}`;
}

export function buildUserPrompt(input: PromptInput): string {
  const { snapshot, supportLevel, resistanceLevel, atr, rvol, pattern, recentCandles, market, marketRegime, sectorTrend, session } = input;

  // Distances + range width
  const supportDist = supportLevel != null && snapshot.price > 0
    ? ((snapshot.price - supportLevel) / snapshot.price) * 100
    : null;
  const resistanceDist = resistanceLevel != null && snapshot.price > 0
    ? ((resistanceLevel - snapshot.price) / snapshot.price) * 100
    : null;
  const rangeWidth = supportLevel != null && resistanceLevel != null
    ? resistanceLevel - supportLevel
    : null;
  const rangeWidthPct = rangeWidth != null && snapshot.price > 0
    ? (rangeWidth / snapshot.price) * 100
    : null;

  const lines: string[] = [];
  lines.push(`SYMBOL: ${snapshot.symbol}`);
  lines.push(`SESSION: ${session}`);
  lines.push(`PRICE: ${fmtPrice(snapshot.price)}  (change ${fmtPct(snapshot.change)})`);
  lines.push("");

  // Market context block
  lines.push("MARKET CONTEXT");
  if (market) {
    lines.push(`  NIFTY:     ${market.nifty.direction} (${fmtPct(market.nifty.changePercent)})`);
    lines.push(`  BANKNIFTY: ${market.bankNifty.direction} (${fmtPct(market.bankNifty.changePercent)})`);
  } else {
    lines.push(`  NIFTY:     unknown`);
    lines.push(`  BANKNIFTY: unknown`);
  }
  if (sectorTrend) lines.push(`  Sector:    ${sectorTrend}`);
  lines.push(`  market_regime: ${marketRegime}`);
  lines.push("");

  // Position
  lines.push("POSITION");
  lines.push(`  zone: ${snapshot.context.zone}`);
  lines.push(
    `  support level:    ${fmtPrice(supportLevel)}` +
    (supportDist != null ? `  (${supportDist.toFixed(2)}% below price)` : ""),
  );
  lines.push(
    `  resistance level: ${fmtPrice(resistanceLevel)}` +
    (resistanceDist != null ? `  (${resistanceDist.toFixed(2)}% above price)` : ""),
  );
  if (rangeWidth != null && rangeWidthPct != null) {
    lines.push(`  range width:      ${fmtPrice(rangeWidth)} (${rangeWidthPct.toFixed(2)}%)`);
  }
  lines.push("");

  // Metrics
  lines.push("METRICS");
  lines.push(`  momentum:    ${snapshot.momentum.label.padEnd(11)}  value ${snapshot.momentum.score.toFixed(2)}`);
  lines.push(`  pressure:    ${snapshot.pressure.label.padEnd(11)}  value ${snapshot.pressure.score.toFixed(2)}`);
  lines.push(`  volatility:  ${snapshot.volatility.label.padEnd(11)}  value ${snapshot.volatility.score.toFixed(2)}`);
  lines.push(`  ATR(14):     ${atr > 0 ? fmtPrice(atr) : "n/a (insufficient candles)"}`);
  lines.push(`  RVOL:        ${fmtRvol(rvol)}`);
  lines.push("");

  // Detected patterns
  lines.push("DETECTED PATTERNS");
  if (pattern) {
    lines.push(`  ${pattern.pattern} (${pattern.direction.toLowerCase()}, strength=${pattern.strength}) — ${pattern.reason}`);
  } else {
    lines.push("  (none detected by engine — you may still identify patterns from raw candles)");
  }
  lines.push("");

  // Candles
  lines.push(`LAST ${recentCandles.length} × 5-MIN CANDLES (oldest first)`);
  if (recentCandles.length === 0) {
    lines.push("  (no recent candles available — cold start or fresh symbol)");
  } else {
    for (const c of recentCandles) lines.push(fmtCandle(c));
  }

  return lines.join("\n");
}

// ─── Response schema (Gemini-enforced) ──────────────────────────────────────

export const REASON_CODES = [
  "SUPPORT_BOUNCE",
  "RESISTANCE_REJECTION",
  "BREAKOUT",
  "BREAKDOWN",
  "HAMMER",
  "ENGULFING",
  "MORNING_STAR",
  "EVENING_STAR",
  "BUY_PRESSURE",
  "SELL_PRESSURE",
  "STRONG_MOMENTUM",
  "MARKET_ALIGNED",
  "RVOL_SURGE",
  "STRUCTURAL_LEVEL",
  "RISK_REWARD_FAVOURABLE",
] as const;
export type ReasonCode = typeof REASON_CODES[number];

export const RISK_FLAGS = [
  "LOW_VOLUME",
  "HIGH_VOLATILITY",
  "WEAK_PATTERN",
  "AGAINST_MARKET_TREND",
  "POOR_RR",
  "NARROW_RANGE",
  "OVEREXTENDED_MOVE",
  "WEAK_CONFIRMATION",
  "SMALL_BODY",
  "OPENING_NOISE",
  "CLOSING_VOLATILITY",
  "INSUFFICIENT_CONFLUENCE",
] as const;
export type RiskFlag = typeof RISK_FLAGS[number];

export interface AiVerdictResponse {
  verdict: "BUY" | "SELL" | "WAIT";
  confidence: number;
  patterns: string[];
  reasons: ReasonCode[];
  reasoning: string;
  // Nullable when verdict = WAIT
  entry: number | null;
  stopLoss: number | null;
  target: number | null;
  riskReward: number | null;
  risk_flags: RiskFlag[];
}

export const AI_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    verdict: { type: Type.STRING, enum: ["BUY", "SELL", "WAIT"] },
    confidence: { type: Type.NUMBER, minimum: 0, maximum: 1 },
    patterns: { type: Type.ARRAY, items: { type: Type.STRING } },
    reasons: {
      type: Type.ARRAY,
      items: { type: Type.STRING, enum: [...REASON_CODES] },
    },
    reasoning: { type: Type.STRING },
    entry: { type: Type.NUMBER, nullable: true },
    stopLoss: { type: Type.NUMBER, nullable: true },
    target: { type: Type.NUMBER, nullable: true },
    riskReward: { type: Type.NUMBER, nullable: true },
    risk_flags: {
      type: Type.ARRAY,
      items: { type: Type.STRING, enum: [...RISK_FLAGS] },
    },
  },
  required: ["verdict", "confidence", "patterns", "reasons", "reasoning", "risk_flags"],
};

// ─── Session helper ─────────────────────────────────────────────────────────
// Returns the current session bucket from IST time. Pure — accepts an
// optional `date` for testability.
export function getSessionForIst(date: Date = new Date()): Session {
  // IST = UTC + 5:30
  const istMinutes = (date.getUTCHours() * 60 + date.getUTCMinutes() + 330) % (24 * 60);
  // Buckets (in IST):
  //   09:45 - 10:00  → OPENING   (585 - 600 min)
  //   10:00 - 14:30  → MID       (600 - 870 min)
  //   14:30 - 15:30  → CLOSING   (870 - 930 min)
  if (istMinutes < 600) return "OPENING";
  if (istMinutes < 870) return "MID";
  return "CLOSING";
}
