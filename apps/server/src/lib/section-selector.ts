import type { IntelligenceSnapshot, Outlook, VolatileStock, VolatileSortKey } from "./types.js";
import { isIndexSymbol } from "./index-symbols.js";

// Single source of truth for the three "lane" selections shown on the home
// dashboard AND used by the AI verdict scheduler. By centralising the
// constants + selection logic here, the cards the user sees and the stocks
// the AI evaluates are guaranteed to be the same set. Change a constant in
// this file and both the frontend (via /api/sections) and the AI scheduler
// pick up the new bar simultaneously.
//
// Pure functions only — no state, no side effects, no imports of services.
// Easy to unit-test, cheap to call.

// ─── Constants (the single source of truth) ────────────────────────────────

/** Max cards rendered in Near Support / Near Resistance lanes. */
export const ZONE_SECTION_CAP = 6;

/** Stocks near a level only qualify when their overall confidence ≥ this floor. */
export const ZONE_SECTION_CONF_FLOOR = 0.65;

/** Max cards rendered in the Strong Factor Alignment lane. */
export const STRONG_ALIGNMENT_CAP = 6;

/** Strong Factor Alignment uses a tighter floor than the zone lanes. */
export const STRONG_ALIGNMENT_FLOOR = 0.85;

/** Outlooks that count as "directional" for the Strong Factor lane. */
export const DIRECTIONAL_OUTLOOKS: ReadonlySet<Outlook> = new Set([
  "BOUNCE_EXPECTED",
  "REJECTION_POSSIBLE",
  "BREAKOUT_LIKELY",
  "BREAKDOWN_RISK",
]);

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Drop index symbols from the candidate pool — the dashboard lanes are
 * stock-only; indices are surfaced separately at the top of the page.
 */
function excludeIndices(snapshots: IntelligenceSnapshot[]): IntelligenceSnapshot[] {
  return snapshots.filter((s) => !isIndexSymbol(s.symbol));
}

/**
 * Sort by confidence descending — the universal ranking for all lanes.
 * Returns a new array (does not mutate the input).
 */
function byConfidenceDesc(snapshots: IntelligenceSnapshot[]): IntelligenceSnapshot[] {
  return [...snapshots].sort((a, b) => b.confidence - a.confidence);
}

// ─── Lane selectors ────────────────────────────────────────────────────────

/**
 * Top N stocks (by confidence DESC) in NEAR_SUPPORT zone with confidence ≥ floor.
 * Indices excluded. N defaults to ZONE_SECTION_CAP.
 */
export function selectNearSupport(snapshots: IntelligenceSnapshot[]): IntelligenceSnapshot[] {
  return byConfidenceDesc(
    excludeIndices(snapshots).filter(
      (s) => s.context.zone === "NEAR_SUPPORT" && s.confidence >= ZONE_SECTION_CONF_FLOOR,
    ),
  ).slice(0, ZONE_SECTION_CAP);
}

/**
 * Top N stocks (by confidence DESC) in NEAR_RESISTANCE zone with confidence ≥ floor.
 * Indices excluded.
 */
export function selectNearResistance(snapshots: IntelligenceSnapshot[]): IntelligenceSnapshot[] {
  return byConfidenceDesc(
    excludeIndices(snapshots).filter(
      (s) => s.context.zone === "NEAR_RESISTANCE" && s.confidence >= ZONE_SECTION_CONF_FLOOR,
    ),
  ).slice(0, ZONE_SECTION_CAP);
}

/**
 * Strong Factor Alignment: confidence ≥ STRONG_ALIGNMENT_FLOOR (0.85) AND
 * outlook is one of the directional set. Cap at STRONG_ALIGNMENT_CAP.
 * Indices excluded.
 */
export function selectStrongAlignment(snapshots: IntelligenceSnapshot[]): IntelligenceSnapshot[] {
  return byConfidenceDesc(
    excludeIndices(snapshots).filter(
      (s) => s.confidence >= STRONG_ALIGNMENT_FLOOR && DIRECTIONAL_OUTLOOKS.has(s.outlook),
    ),
  ).slice(0, STRONG_ALIGNMENT_CAP);
}

// ─── Volatile Stocks lane ──────────────────────────────────────────────────
//
// Surfaces stocks that are *moving right now* with enough volume to be
// actually tradeable. Used by the intraday-trading Volatile screen. The
// selector takes pre-enriched VolatileStock candidates (the route handler
// computes the metrics) and filters + sorts + caps.

/** ATR(14) as a % of price must be at least this to qualify as "volatile". */
export const VOLATILE_ATR_PCT_FLOOR = 1.5;
/** RVOL must be at least this — confirms the volatility is on real volume. */
export const VOLATILE_RVOL_FLOOR = 1.5;
/** Hard cap on cards rendered. Keeps the scan list digestible. */
export const VOLATILE_CAP = 20;

export interface SelectVolatileOpts {
  priceMin?: number | null;
  priceMax?: number | null;
  /** Default: "atrPct" — biggest movers first. */
  sortBy?: VolatileSortKey;
}

function volatileSortValue(s: VolatileStock, key: VolatileSortKey): number {
  switch (key) {
    case "atrPct":
      return s.atrPct;
    case "rvol":
      return s.rvol;
    case "changePct":
      // Sort by absolute change so a -3% mover ranks alongside a +3% mover.
      return Math.abs(s.changePct);
    case "lastCandleVolSpike":
      // recentCandles is newest-first; index 0 is the just-closed candle.
      return s.recentCandles[0]?.volMultiplier ?? 0;
  }
}

/**
 * Filter the candidate pool by the volatility floors and optional price band,
 * sort by the chosen key (descending), cap at VOLATILE_CAP.
 *
 * Pure function — no side effects, easy to unit-test. The route handler is
 * responsible for building the candidate pool (computing atrPct, rvol,
 * recentCandles, etc.) before calling this.
 */
export function selectVolatile(
  candidates: VolatileStock[],
  opts: SelectVolatileOpts = {},
): VolatileStock[] {
  const sortBy = opts.sortBy ?? "atrPct";
  const priceMin = opts.priceMin ?? null;
  const priceMax = opts.priceMax ?? null;

  return [...candidates]
    .filter(
      (c) =>
        c.atrPct >= VOLATILE_ATR_PCT_FLOOR &&
        c.rvol >= VOLATILE_RVOL_FLOOR &&
        (priceMin === null || c.price >= priceMin) &&
        (priceMax === null || c.price <= priceMax),
    )
    .sort((a, b) => volatileSortValue(b, sortBy) - volatileSortValue(a, sortBy))
    .slice(0, VOLATILE_CAP);
}

/**
 * The AI scheduler target set — union of all three lanes, deduped by symbol.
 * Order preserved from the first lane a symbol appeared in (so the highest
 * confidence stocks in NEAR_SUPPORT lead the list — useful for prioritising
 * which to evaluate first if parallel slots fill up).
 *
 * Typical size: 10–13 stocks. Hard cap: ZONE_SECTION_CAP × 2 + STRONG_ALIGNMENT_CAP = 18.
 */
export function selectAiTargets(snapshots: IntelligenceSnapshot[]): IntelligenceSnapshot[] {
  const result: IntelligenceSnapshot[] = [];
  const seen = new Set<string>();
  for (const lane of [
    selectNearSupport(snapshots),
    selectNearResistance(snapshots),
    selectStrongAlignment(snapshots),
  ]) {
    for (const snap of lane) {
      if (seen.has(snap.symbol)) continue;
      seen.add(snap.symbol);
      result.push(snap);
    }
  }
  return result;
}
