import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateAiResponse, type ValidationContext } from "./ai-validate.js";
import type { AiVerdictResponse } from "./ai-prompt.js";

function buyResponse(over: Partial<AiVerdictResponse> = {}): AiVerdictResponse {
  return {
    verdict: "BUY",
    confidence: 0.8,
    patterns: ["Hammer"],
    reasons: ["SUPPORT_BOUNCE", "HAMMER"],
    reasoning: "Hammer at support with rising pressure.",
    entry: 100,
    stopLoss: 99,        // 1 below entry (1 × ATR if ATR=1)
    target: 102,         // 2 above entry → R:R = 2.0
    riskReward: 2.0,
    risk_flags: [],
    ...over,
  };
}

function sellResponse(over: Partial<AiVerdictResponse> = {}): AiVerdictResponse {
  return {
    verdict: "SELL",
    confidence: 0.8,
    patterns: ["Shooting Star"],
    reasons: ["RESISTANCE_REJECTION"],
    reasoning: "Shooting star at resistance with rising sell pressure.",
    entry: 100,
    stopLoss: 101,       // 1 above
    target: 98,          // 2 below → R:R = 2.0
    riskReward: 2.0,
    risk_flags: [],
    ...over,
  };
}

function waitResponse(over: Partial<AiVerdictResponse> = {}): AiVerdictResponse {
  return {
    verdict: "WAIT",
    confidence: 0.4,
    patterns: [],
    reasons: [],
    reasoning: "Mixed signals, no clear edge.",
    entry: null,
    stopLoss: null,
    target: null,
    riskReward: null,
    risk_flags: [],
    ...over,
  };
}

const ctx = (over: Partial<ValidationContext> = {}): ValidationContext => ({
  atr: 1.0,
  supportLevel: 98,
  resistanceLevel: 105,
  ...over,
});

describe("validateAiResponse — WAIT path", () => {
  it("passes WAIT unchanged", () => {
    const r = validateAiResponse(waitResponse(), ctx());
    assert.equal(r.downgraded, false);
    assert.equal(r.response.verdict, "WAIT");
  });

  it("nulls trade plan fields even if AI set them on a WAIT verdict", () => {
    const r = validateAiResponse(
      waitResponse({ entry: 100, stopLoss: 99, target: 102, riskReward: 2 }),
      ctx(),
    );
    assert.equal(r.response.entry, null);
    assert.equal(r.response.stopLoss, null);
    assert.equal(r.response.target, null);
    assert.equal(r.response.riskReward, null);
  });
});

describe("validateAiResponse — BUY happy path", () => {
  it("passes a valid BUY through unchanged", () => {
    const r = validateAiResponse(buyResponse(), ctx());
    assert.equal(r.downgraded, false);
    assert.equal(r.response.verdict, "BUY");
    assert.equal(r.response.entry, 100);
    assert.equal(r.response.stopLoss, 99);
    assert.equal(r.response.target, 102);
  });
});

describe("validateAiResponse — BUY math failures", () => {
  it("downgrades when SL not below entry", () => {
    const r = validateAiResponse(buyResponse({ stopLoss: 101 }), ctx());
    assert.equal(r.downgraded, true);
    assert.equal(r.response.verdict, "WAIT");
    assert.equal(r.response.entry, null);
  });

  it("downgrades when target not above entry", () => {
    const r = validateAiResponse(buyResponse({ target: 99.5 }), ctx());
    assert.equal(r.downgraded, true);
  });

  it("downgrades when R:R < 1", () => {
    const r = validateAiResponse(buyResponse({ stopLoss: 99, target: 100.5, riskReward: 0.5 }), ctx());
    assert.equal(r.downgraded, true);
    assert.ok(r.response.risk_flags.includes("POOR_RR"));
  });

  it("downgrades when SL too tight (< 0.25 × ATR)", () => {
    // ATR=1, SL 0.1 from entry → 0.1×ATR → below 0.25 floor
    const r = validateAiResponse(
      buyResponse({ entry: 100, stopLoss: 99.9, target: 100.5, riskReward: 5.0 }),
      ctx({ atr: 1.0 }),
    );
    assert.equal(r.downgraded, true);
    assert.ok(r.response.risk_flags.includes("NARROW_RANGE"));
  });

  it("downgrades when SL too wide (> 1.5 × ATR)", () => {
    // ATR=1, SL 2.0 from entry → 2.0×ATR → above 1.5 ceiling
    const r = validateAiResponse(
      buyResponse({ entry: 100, stopLoss: 98.0, target: 104, riskReward: 2.0 }),
      ctx({ atr: 1.0 }),
    );
    assert.equal(r.downgraded, true);
    assert.ok(r.response.risk_flags.includes("POOR_RR"));
  });

  it("downgrades when target too far (> 4 × ATR)", () => {
    // ATR=1, target 5.0 above → 5×ATR
    const r = validateAiResponse(
      buyResponse({ entry: 100, stopLoss: 99, target: 105, riskReward: 5.0 }),
      ctx({ atr: 1.0 }),
    );
    assert.equal(r.downgraded, true);
    assert.ok(r.response.risk_flags.includes("OVEREXTENDED_MOVE"));
  });

  it("downgrades when entry/SL/target missing", () => {
    const r = validateAiResponse(buyResponse({ entry: null }), ctx());
    assert.equal(r.downgraded, true);
  });

  it("patches mismatched riskReward field but keeps verdict", () => {
    // entry 100, SL 99, target 102 → R:R = 2.0; but AI said 3.5
    const r = validateAiResponse(buyResponse({ riskReward: 3.5 }), ctx());
    assert.equal(r.downgraded, false);
    assert.equal(r.response.verdict, "BUY");
    assert.equal(r.response.riskReward, 2.0);
  });

  it("adds WEAK_CONFIRMATION flag when SL is above support (but does not downgrade)", () => {
    // BUY, SL 99.5, support 99 → SL above support
    const r = validateAiResponse(
      buyResponse({ entry: 100, stopLoss: 99.5, target: 102, riskReward: 4.0 }),
      ctx({ atr: 1.0, supportLevel: 99 }),
    );
    assert.equal(r.downgraded, false);
    assert.ok(r.response.risk_flags.includes("WEAK_CONFIRMATION"));
  });
});

describe("validateAiResponse — SELL mirror", () => {
  it("passes valid SELL", () => {
    const r = validateAiResponse(sellResponse(), ctx());
    assert.equal(r.downgraded, false);
    assert.equal(r.response.verdict, "SELL");
  });

  it("downgrades when SL not above entry", () => {
    const r = validateAiResponse(sellResponse({ stopLoss: 99 }), ctx());
    assert.equal(r.downgraded, true);
  });

  it("downgrades when target not below entry", () => {
    const r = validateAiResponse(sellResponse({ target: 100.5 }), ctx());
    assert.equal(r.downgraded, true);
  });
});

describe("validateAiResponse — ATR fallback", () => {
  it("uses 0.5% of entry as synthetic ATR when ATR is 0", () => {
    // Entry 100, synthetic ATR = 0.5, SL distance must be 0.125 to 0.75
    // Use SL=99.7 → distance 0.3 → 0.6×synth-ATR → within bounds
    const r = validateAiResponse(
      buyResponse({ entry: 100, stopLoss: 99.7, target: 100.7, riskReward: 2.33 }),
      ctx({ atr: 0 }),
    );
    assert.equal(r.downgraded, false);
  });
});
