// Single source of truth for backend index detection. Indices need
// different threshold scaling on momentum/volatility (they move much
// smaller % than individual stocks) and skip pressure entirely (Kite
// index ticks carry no traded volume — pressure is structurally 0).
// Frontend has a separate INDEX_NAMES set in apps/web/src/lib/constants.ts;
// keeping them duplicated to preserve the API boundary.
export const INDEX_SYMBOLS = new Set([
  "NIFTY 50",
  "NIFTY BANK",
  "SENSEX",
  "NIFTY FIN SERVICE",
  "INDIA VIX",
]);

export function isIndexSymbol(symbol: string): boolean {
  return INDEX_SYMBOLS.has(symbol);
}

// Re-exported here so callers don't need a separate import from index-futures-config.
import { isFutureSymbol } from "./index-futures-config.js";

/**
 * "Index-like" = spot index OR index-future. Used for momentum threshold
 * selection (both move at ~0.1-0.3% per 5-min candle, vs ~0.5-1% for stocks),
 * NOT for pressure / lane exclusion — futures have real volume and belong in
 * the trading lanes. Use `isIndexSymbol` for the strict spot-only check.
 */
export function isIndexLikeSymbol(symbol: string): boolean {
  return isIndexSymbol(symbol) || isFutureSymbol(symbol);
}
