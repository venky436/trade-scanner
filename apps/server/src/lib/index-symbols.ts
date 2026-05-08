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
