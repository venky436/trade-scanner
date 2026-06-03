import type { AiVerdictResponse, RiskFlag } from "./ai-prompt.js";

// Server-side validation of Gemini's response. Catches inconsistent trade
// plans and forces them down to WAIT rather than letting bad math reach the
// UI. The AI's reasoning can still be wrong; this is the math safety net.
//
// All validation is structural — we do NOT second-guess the verdict itself
// or the reasoning. The only thing we override is the trade plan numbers
// when they violate hard constraints (inverted SL/target, R:R < 1, SL way
// too tight or way too wide, etc.).

export interface ValidationContext {
  /** Current ATR(14) for the symbol — used to bound SL distance. */
  atr: number;
  /** Nearest support level ₹ — used to sanity-check BUY stop placement. */
  supportLevel: number | null;
  /** Nearest resistance level ₹ — used to sanity-check SELL stop placement. */
  resistanceLevel: number | null;
}

export interface ValidationResult {
  /** The (possibly-downgraded) response to use. */
  response: AiVerdictResponse;
  /** True when the original verdict was BUY/SELL but we forced it to WAIT. */
  downgraded: boolean;
  /** Reason for the downgrade — null when no downgrade occurred. */
  downgradeReason: string | null;
}

// Limits — see plan §"VALIDATE" and "WHEN VERDICT IS BUY OR SELL"
const MIN_RR = 1.0;
const SL_MIN_ATR_MULT = 0.25;
const SL_MAX_ATR_MULT = 1.5;
const TARGET_MAX_ATR_MULT = 4.0;

// Floor for ATR sanity — if AI gives an entry of ₹100 and ATR comes through
// as 0, our ATR-bounded checks would be meaningless. Fall back to 0.5% of
// entry as a synthetic ATR.
function effectiveAtr(atr: number, entry: number): number {
  if (atr > 0) return atr;
  return Math.max(entry * 0.005, 0.01);
}

function downgrade(
  original: AiVerdictResponse,
  reason: string,
  extraFlags: RiskFlag[] = [],
): ValidationResult {
  return {
    response: {
      ...original,
      verdict: "WAIT",
      entry: null,
      stopLoss: null,
      target: null,
      riskReward: null,
      risk_flags: dedupeFlags([...original.risk_flags, ...extraFlags]),
    },
    downgraded: true,
    downgradeReason: reason,
  };
}

function dedupeFlags(flags: RiskFlag[]): RiskFlag[] {
  return [...new Set(flags)];
}

/**
 * Validate an AI verdict against structural + ATR-bounded rules. Returns
 * either the unmodified response (when valid) or a downgraded WAIT.
 *
 * Behaviour by verdict:
 *   - WAIT         → always passes (no trade plan to validate). Even if the
 *                     AI populated trade-plan fields, we null them.
 *   - BUY / SELL   → must have entry, stopLoss, target, riskReward all set
 *                     to finite numbers, must satisfy the order constraints
 *                     (SL on the correct side of entry, target on the other),
 *                     SL distance must be 0.25-1.5 × ATR, target distance
 *                     must be ≤ 4 × ATR, riskReward must be ≥ 1.
 */
export function validateAiResponse(
  response: AiVerdictResponse,
  ctx: ValidationContext,
): ValidationResult {
  // WAIT path — null any trade-plan fields the model may have populated
  if (response.verdict === "WAIT") {
    return {
      response: {
        ...response,
        entry: null,
        stopLoss: null,
        target: null,
        riskReward: null,
      },
      downgraded: false,
      downgradeReason: null,
    };
  }

  // BUY / SELL path — all four numbers required
  const { entry, stopLoss, target, riskReward } = response;
  if (
    entry == null || stopLoss == null || target == null || riskReward == null ||
    !Number.isFinite(entry) || !Number.isFinite(stopLoss) ||
    !Number.isFinite(target) || !Number.isFinite(riskReward)
  ) {
    return downgrade(response, "missing or non-finite trade plan numbers", ["WEAK_CONFIRMATION"]);
  }

  if (entry <= 0 || stopLoss <= 0 || target <= 0) {
    return downgrade(response, "non-positive price in trade plan", ["WEAK_CONFIRMATION"]);
  }

  // Order constraints
  if (response.verdict === "BUY") {
    if (!(stopLoss < entry && entry < target)) {
      return downgrade(response, `BUY requires stopLoss < entry < target, got SL=${stopLoss} entry=${entry} target=${target}`, ["WEAK_CONFIRMATION"]);
    }
  } else {
    // SELL — mirror
    if (!(target < entry && entry < stopLoss)) {
      return downgrade(response, `SELL requires target < entry < stopLoss, got target=${target} entry=${entry} SL=${stopLoss}`, ["WEAK_CONFIRMATION"]);
    }
  }

  // R:R floor
  const slDist = Math.abs(entry - stopLoss);
  const tgtDist = Math.abs(target - entry);
  const computedRR = slDist > 0 ? tgtDist / slDist : 0;
  if (computedRR < MIN_RR) {
    return downgrade(response, `R:R ${computedRR.toFixed(2)} below floor ${MIN_RR}`, ["POOR_RR"]);
  }
  // Tolerate ≤ 10% drift between AI's stated riskReward and our computed one
  // (rounding etc) — anything bigger means AI miscalculated; trust the math.
  if (Math.abs(riskReward - computedRR) / Math.max(computedRR, 0.01) > 0.1) {
    // Patch the field rather than reject — small drift is benign
    response = { ...response, riskReward: Number(computedRR.toFixed(2)) };
  }

  // ATR-bounded checks
  const atrToUse = effectiveAtr(ctx.atr, entry);
  const slAtrMult = slDist / atrToUse;
  const tgtAtrMult = tgtDist / atrToUse;

  if (slAtrMult < SL_MIN_ATR_MULT) {
    return downgrade(
      response,
      `SL distance ${slDist.toFixed(2)} = ${slAtrMult.toFixed(2)}×ATR — below floor ${SL_MIN_ATR_MULT}× (too tight, will get stopped on noise)`,
      ["NARROW_RANGE"],
    );
  }
  if (slAtrMult > SL_MAX_ATR_MULT) {
    return downgrade(
      response,
      `SL distance ${slDist.toFixed(2)} = ${slAtrMult.toFixed(2)}×ATR — above ceiling ${SL_MAX_ATR_MULT}× (too wide, poor R:R)`,
      ["POOR_RR"],
    );
  }
  if (tgtAtrMult > TARGET_MAX_ATR_MULT) {
    return downgrade(
      response,
      `Target distance ${tgtDist.toFixed(2)} = ${tgtAtrMult.toFixed(2)}×ATR — above ceiling ${TARGET_MAX_ATR_MULT}× (unrealistic in one move)`,
      ["OVEREXTENDED_MOVE"],
    );
  }

  // Structural sanity (soft — only emit risk flag, do NOT downgrade).
  // The AI is allowed to anchor its stop to wicks/patterns we don't track,
  // so a structural mismatch shouldn't auto-kill the trade.
  const structuralFlags: RiskFlag[] = [];
  if (response.verdict === "BUY" && ctx.supportLevel != null && stopLoss > ctx.supportLevel) {
    structuralFlags.push("WEAK_CONFIRMATION");
  }
  if (response.verdict === "SELL" && ctx.resistanceLevel != null && stopLoss < ctx.resistanceLevel) {
    structuralFlags.push("WEAK_CONFIRMATION");
  }

  return {
    response: {
      ...response,
      risk_flags: dedupeFlags([...response.risk_flags, ...structuralFlags]),
    },
    downgraded: false,
    downgradeReason: null,
  };
}
