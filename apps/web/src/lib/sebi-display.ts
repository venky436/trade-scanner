// Single source of truth for SEBI-safe display vocabulary.
// Backend keeps producing internal enums (BUY/SELL/Bullish/Breakout/etc.) for
// scoring + tracking; this module is the only place those enums get translated
// into user-facing prose. Every public surface should route its strings through
// these helpers — never render the raw enum.
//
// Two principles:
// 1. Describe, don't predict. "Buying activity observed" not "buy signal".
// 2. Observation, not instruction. "Price reacting near support" not "good entry".

import type {
  IntelligenceSnapshot,
  MomentumLabel,
  PressureLabel,
  VolatilityLabel,
  Zone,
} from "./types";

// ── Compact display labels (used inside cards) ──

export function zoneDisplay(zone: Zone): string {
  if (zone === "NEAR_SUPPORT") return "Near Support Zone";
  if (zone === "NEAR_RESISTANCE") return "Near Resistance Zone";
  return "Mid Range Activity";
}

export function momentumDisplay(label: MomentumLabel): string {
  if (label === "STRONG_UP") return "Building";
  if (label === "WEAK_UP") return "Building (mild)";
  if (label === "NEUTRAL") return "Stable";
  if (label === "WEAK_DOWN") return "Easing";
  return "Weakening";
}

export function pressureDisplay(label: PressureLabel): string {
  if (label === "BUY") return "Buying activity observed";
  if (label === "SELL") return "Selling activity observed";
  if (label === "NOT_APPLICABLE") return "Not applicable for indices";
  return "Neutral participation";
}

export function volatilityDisplay(label: VolatilityLabel): string {
  if (label === "HIGH") return "Elevated";
  if (label === "MEDIUM") return "Moderate";
  return "Low";
}

// ── Direction hints for visual icons ──
// Pure descriptive (matches what the data shows). Up = price rising, Down = falling.
// Used to color arrows / accents on cards. Never paired with "buy/sell" wording.

export type Direction = "up" | "down" | "flat";

export function momentumDirection(label: MomentumLabel): Direction {
  if (label === "STRONG_UP" || label === "WEAK_UP") return "up";
  if (label === "STRONG_DOWN" || label === "WEAK_DOWN") return "down";
  return "flat";
}

export function pressureDirection(label: PressureLabel): Direction {
  if (label === "BUY") return "up";
  if (label === "SELL") return "down";
  // NOT_APPLICABLE → flat (no directional signal). UI uses the label itself
  // to decide whether to render the N/A card; the direction is irrelevant.
  return "flat";
}

// ── Long-form headlines (used on detail page section bodies) ──

export function momentumHeadline(label: MomentumLabel): string {
  if (label === "STRONG_UP") return "Momentum currently building";
  if (label === "WEAK_UP") return "Momentum gradually building";
  if (label === "NEUTRAL") return "Momentum stable";
  if (label === "WEAK_DOWN") return "Momentum easing";
  return "Momentum weakening after recent move";
}

export function pressureHeadline(label: PressureLabel): string {
  if (label === "BUY") return "Buying activity gradually increasing";
  if (label === "SELL") return "Selling activity gradually increasing";
  if (label === "NOT_APPLICABLE") return "Pressure requires order-book volume — not measurable for indices";
  return "Neutral market participation observed";
}

export function volatilityHeadline(label: VolatilityLabel): string {
  if (label === "HIGH") return "Elevated volatility observed";
  if (label === "MEDIUM") return "Moderate volatility environment";
  return "Low volatility environment";
}

// ── Strength descriptor for numeric magnitudes (0..1) ──
// Frames a raw score as a neutral word, never as conviction or recommendation.

export function strengthDescriptor(score: number): string {
  const s = Math.max(0, Math.min(1, score));
  if (s >= 0.75) return "High";
  if (s >= 0.5) return "Moderate";
  if (s >= 0.25) return "Mild";
  return "Low";
}

// ── Market Observation — descriptive single sentence ──
// Composed from zone + momentum + pressure + volatility. Pure description, no
// prediction language. Returned string is suitable for the card's observation
// line and the detail-page Observation section.

export function marketObservation(snap: Pick<IntelligenceSnapshot, "context" | "momentum" | "pressure" | "volatility">): string {
  const zone = snap.context.zone;
  const mDir = momentumDirection(snap.momentum.label);
  const pDir = pressureDirection(snap.pressure.label);
  const volHigh = snap.volatility.label === "HIGH";

  // Aligned cases — multiple factors pointing the same way (descriptive, not predictive)
  if (zone === "NEAR_SUPPORT" && (mDir === "up" || pDir === "up")) {
    return "Price reacting near recent support area";
  }
  if (zone === "NEAR_RESISTANCE" && (mDir === "down" || pDir === "down")) {
    return "Selling activity observed near resistance area";
  }
  if (zone === "NEAR_RESISTANCE" && pDir === "up") {
    return "Buying activity observed near resistance area";
  }
  if (zone === "NEAR_SUPPORT" && pDir === "down") {
    return "Selling activity observed near support area";
  }

  // High-alignment but no clear zone bias
  if (mDir !== "flat" && pDir !== "flat" && mDir === pDir) {
    return "Multiple market factors currently aligned";
  }

  // Volatility-led
  if (volHigh) return "Elevated volatility observed in current range";

  // Mixed / quiet
  if (mDir !== pDir && mDir !== "flat" && pDir !== "flat") {
    return "Momentum and pressure showing mixed alignment";
  }
  return "Price consolidating within recent range";
}

// ── Market Interpretation — short paragraph for detail page ──
// Replaces the old "Suggested Approach" + "Possible Scenario" sections.
// Interprets current conditions; never instructs the user.

export function marketInterpretation(snap: Pick<IntelligenceSnapshot, "context" | "momentum" | "pressure" | "volatility">): string {
  const zone = snap.context.zone;
  const mDir = momentumDirection(snap.momentum.label);
  const pDir = pressureDirection(snap.pressure.label);
  const aligned = mDir !== "flat" && pDir !== "flat" && mDir === pDir;
  const mixed = mDir !== pDir && mDir !== "flat" && pDir !== "flat";

  if (zone === "NEAR_SUPPORT" && aligned && mDir === "up") {
    return "Market structure currently shows reactive activity near a recent support level with alignment across momentum and pressure factors.";
  }
  if (zone === "NEAR_RESISTANCE" && aligned && mDir === "down") {
    return "Market structure currently shows reactive activity near a recent resistance level with alignment across momentum and pressure factors.";
  }
  if (mixed) {
    return "Price activity indicates mixed participation across momentum and pressure factors.";
  }
  if (aligned) {
    return "Multiple market factors currently align in the same direction across the recent observation window.";
  }
  return "Current market conditions show moderate activity with no strong directional alignment observed.";
}

// ── Market Conditions — bullet list for detail page ──
// Replaces the old "Risk" section. Present-tense neutral statements about the
// current environment.

export function marketConditions(snap: Pick<IntelligenceSnapshot, "context" | "momentum" | "pressure" | "volatility">): string[] {
  const items: string[] = [];

  // Volatility line
  if (snap.volatility.label === "HIGH") {
    items.push("Elevated volatility may result in wider short-term price movement.");
  } else if (snap.volatility.label === "LOW") {
    items.push("Low volatility environment currently observed.");
  } else {
    items.push("Moderate volatility observed in the current range.");
  }

  // Alignment line
  const mDir = momentumDirection(snap.momentum.label);
  const pDir = pressureDirection(snap.pressure.label);
  if (mDir !== pDir && mDir !== "flat" && pDir !== "flat") {
    items.push("Mixed momentum and pressure alignment detected.");
  } else if (mDir === pDir && mDir !== "flat") {
    items.push("Momentum and pressure currently aligned.");
  } else {
    items.push("Neutral participation across momentum and pressure factors.");
  }

  // Zone line
  if (snap.context.zone === "NEAR_SUPPORT") {
    items.push("Price activity within close range of a recent support level.");
  } else if (snap.context.zone === "NEAR_RESISTANCE") {
    items.push("Price activity within close range of a recent resistance level.");
  } else {
    items.push("Price activity within the mid-range of recent levels.");
  }

  return items;
}

// ── "Updated X min ago" — live freshness indicator ──
// Computed from a millis timestamp. Returns natural-language string that
// recomputes on every render (caller should re-render at least once a minute).

export function formatTimeAgo(timestampMs: number, nowMs: number = Date.now()): string {
  const diffSec = Math.max(0, Math.round((nowMs - timestampMs) / 1000));
  if (diffSec < 5) return "Updated just now";
  if (diffSec < 60) return `Updated ${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin === 1) return "Updated 1 min ago";
  if (diffMin < 60) return `Updated ${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr === 1) return "Updated 1 hour ago";
  return `Updated ${diffHr} hours ago`;
}
