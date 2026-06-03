import type { MarketContext } from "./types.js";

// Classifies the broader market into one of four regimes. Used as a column
// on `ai_calls` so we can later slice AI performance by regime (e.g. "AI is
// great in trends, bad in chop").
//
// Pure derivation from the existing MarketContext (NIFTY + BANKNIFTY). No
// new data source.

export type MarketRegime = "TRENDING_UP" | "TRENDING_DOWN" | "RANGING" | "HIGH_VOLATILITY";

// Thresholds (% change vs prev close):
//   - |change| ≥ 0.6%  → trending (direction from sign)
//   - either |change| ≥ 1.2% → HIGH_VOLATILITY (overrides direction)
//   - otherwise         → RANGING
const TRENDING_THRESHOLD_PERCENT = 0.6;
const HIGH_VOLATILITY_THRESHOLD_PERCENT = 1.2;

export function computeMarketRegime(market: MarketContext | null): MarketRegime {
  if (!market) return "RANGING";

  const niftyChange = market.nifty.changePercent;
  const bankNiftyChange = market.bankNifty.changePercent;

  // Either index showing a large move (regardless of direction) → high vol
  if (
    Math.abs(niftyChange) >= HIGH_VOLATILITY_THRESHOLD_PERCENT ||
    Math.abs(bankNiftyChange) >= HIGH_VOLATILITY_THRESHOLD_PERCENT
  ) {
    return "HIGH_VOLATILITY";
  }

  // NIFTY is the dominant signal. We don't OR with BANKNIFTY because they
  // often move together — using NIFTY alone keeps the regime stable.
  if (niftyChange >= TRENDING_THRESHOLD_PERCENT) return "TRENDING_UP";
  if (niftyChange <= -TRENDING_THRESHOLD_PERCENT) return "TRENDING_DOWN";

  return "RANGING";
}
