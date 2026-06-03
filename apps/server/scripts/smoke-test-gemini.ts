// Phase 3 smoke test — verifies @google/genai SDK + API key + JSON schema
// enforcement all work end-to-end. Does NOT touch the live scheduler,
// pipeline, or DB. Pure standalone script.
//
// Run with:  cd apps/server && npx tsx scripts/smoke-test-gemini.ts

import "dotenv/config";
import { callGemini, Type } from "../src/lib/gemini-client.js";

const SYSTEM = `You are a test responder. Given any input, return a JSON object
matching the schema with verdict="WAIT", confidence=0.5, and a one-sentence
reasoning. This is purely a connectivity test.`;

const USER = `Test ping. Please respond with the structured JSON exactly as
the schema requires.`;

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    verdict: { type: Type.STRING, enum: ["BUY", "SELL", "WAIT"] },
    confidence: { type: Type.NUMBER },
    reasoning: { type: Type.STRING },
  },
  required: ["verdict", "confidence", "reasoning"],
};

interface SmokeResult {
  verdict: "BUY" | "SELL" | "WAIT";
  confidence: number;
  reasoning: string;
}

async function main() {
  console.log("[smoke] AI_MODE_ENABLED =", process.env.AI_MODE_ENABLED ?? "<unset>");
  console.log("[smoke] GEMINI_API_KEY  =", process.env.GEMINI_API_KEY ? `<set, ${process.env.GEMINI_API_KEY.length} chars>` : "<unset>");
  console.log("[smoke] Calling Gemini...");

  const result = await callGemini<SmokeResult>({
    systemPrompt: SYSTEM,
    userPrompt: USER,
    responseSchema: SCHEMA,
  });

  console.log("[smoke] Latency:", result.stats.durationMs, "ms");
  console.log("[smoke] Tokens:", JSON.stringify({
    input: result.stats.inputTokens,
    output: result.stats.outputTokens,
    cachedInput: result.stats.cachedInputTokens,
  }));

  if (!result.data) {
    console.error("[smoke] ❌ FAILED:", result.error);
    process.exit(1);
  }

  console.log("[smoke] ✓ Parsed response:");
  console.log(JSON.stringify(result.data, null, 2));

  if (result.data.verdict !== "WAIT") {
    console.warn("[smoke] ⚠ verdict was not WAIT (model didn't follow instruction); SDK still works though.");
  }

  console.log("[smoke] ✓ End-to-end OK");
}

main().catch((e) => {
  console.error("[smoke] ❌ Unhandled error:", e);
  process.exit(1);
});
