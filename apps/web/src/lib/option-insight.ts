// Option insight derivation — purely transforms the existing IntelligenceSnapshot
// into a CALL/PUT/NEUTRAL bias label. NO new market data, no greeks, no chain depth.
// Options live entirely off the underlying index's intelligence.

import type { IntelligenceSnapshot, Outlook } from "./types";

export type OptionBias = "CALL" | "PUT" | "NEUTRAL";

export interface OptionInsight {
  bias: OptionBias;
  reasoning: string;
}

// Outlook → CALL/PUT mapping per the spec
const BIAS_BY_OUTLOOK: Record<Outlook, OptionBias> = {
  BREAKOUT_LIKELY: "CALL",
  BOUNCE_EXPECTED: "CALL",
  BREAKDOWN_RISK: "PUT",
  REJECTION_POSSIBLE: "PUT",
  NO_CLEAR_EDGE: "NEUTRAL",
};

function reasoningFor(intel: IntelligenceSnapshot): string {
  switch (intel.outlook) {
    case "BREAKOUT_LIKELY":
      return "Upward momentum near resistance — CALL side has the cleaner edge.";
    case "BOUNCE_EXPECTED":
      return "Buyers defending support — CALL side favorable while the level holds.";
    case "BREAKDOWN_RISK":
      return "Sellers pressing support — PUT side has the cleaner edge.";
    case "REJECTION_POSSIBLE":
      return "Sellers stepping in at resistance — PUT side favorable while the level holds.";
    case "NO_CLEAR_EDGE":
    default:
      return "No clear directional edge right now — avoid directional bets.";
  }
}

export function toOptionInsight(intel: IntelligenceSnapshot): OptionInsight {
  return {
    bias: BIAS_BY_OUTLOOK[intel.outlook],
    reasoning: reasoningFor(intel),
  };
}

// ── Strikes ──

// Strike spacing per supported index.
export const STRIKE_SPACING: Record<string, number> = {
  "NIFTY 50": 50,
  "NIFTY BANK": 100,
  "NIFTY FIN SERVICE": 100,
};

export interface Strike {
  /** Round-number strike price */
  price: number;
  /** "CE" if at-or-above current price, "PE" if below — convention only */
  side: "CE" | "PE";
  /** True for the strike closest to current price */
  isAtm: boolean;
}

/**
 * Get 3 strikes around the current price: ATM-1 spacing, ATM, ATM+1 spacing.
 * Side label follows the convention: strike below price = PE, at-or-above = CE.
 */
export function getATMStrikes(price: number, spacing: number): Strike[] {
  if (price <= 0 || spacing <= 0) return [];
  const atm = Math.round(price / spacing) * spacing;
  const strikes: Strike[] = [
    { price: atm - spacing, side: "PE", isAtm: false },
    { price: atm, side: atm >= price ? "CE" : "PE", isAtm: true },
    { price: atm + spacing, side: "CE", isAtm: false },
  ];
  return strikes;
}

// ── Supported indices ──

export interface SupportedIndex {
  /** Symbol used in stockMap (must match Kite instrument name) */
  symbol: string;
  /** Display name shown to user */
  displayName: string;
  /** Strike spacing in rupees */
  spacing: number;
}

export const SUPPORTED_OPTION_INDICES: SupportedIndex[] = [
  { symbol: "NIFTY 50", displayName: "NIFTY", spacing: 50 },
  { symbol: "NIFTY BANK", displayName: "BANKNIFTY", spacing: 100 },
  { symbol: "NIFTY FIN SERVICE", displayName: "NIFTY FIN", spacing: 100 },
];
