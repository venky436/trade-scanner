import { GoogleGenAI, Type, type Schema } from "@google/genai";

// Thin wrapper around the Google Generative AI SDK. Single exported function
// `callGemini` — handles auth, schema-enforced JSON output, one retry on
// transient errors, and fail-open semantics (returns null on permanent
// failure so the caller never breaks).
//
// We construct the client lazily on first use so simply importing this
// module from a flag-gated code path does not require GEMINI_API_KEY to
// be set. If the flag is off, this module is never called and the SDK is
// never initialized.

export const GEMINI_MODEL = "gemini-2.5-flash" as const;

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (client) return client;
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY is not set — required when AI_MODE_ENABLED=true. " +
      "See docs/AI_VERDICT_MODULE_PLAN.md or .env.example.",
    );
  }
  client = new GoogleGenAI({ apiKey: key });
  return client;
}

export interface GeminiCallStats {
  /** Total input tokens (system + user). May be undefined if SDK omits. */
  inputTokens?: number;
  /** Output tokens billed. */
  outputTokens?: number;
  /** Cached input tokens (only if context caching kicked in). */
  cachedInputTokens?: number;
  /** Wall-clock latency in ms. */
  durationMs: number;
}

export interface GeminiCallResult<T> {
  /** Parsed + schema-validated response, or null if call failed. */
  data: T | null;
  /** Raw response object from Gemini (useful to persist for replay). */
  raw: unknown;
  /** Cost + latency stats. Always populated. */
  stats: GeminiCallStats;
  /** Error message when data is null. */
  error?: string;
}

interface CallOptions {
  systemPrompt: string;
  userPrompt: string;
  responseSchema: Schema;
  /** Temperature (default 0.1 — near-deterministic but allows tie-breaks). */
  temperature?: number;
  /** Whether to attempt one retry on transient errors. Default true. */
  retryOnce?: boolean;
}

/**
 * Call Gemini with a structured-output JSON schema. Returns parsed JSON
 * matching the schema, or null on permanent failure (with `error` populated).
 *
 * Fail-open semantics: never throws on Gemini-side errors. The caller can
 * always log `error` and fall back to the rule engine.
 *
 * Note: this function DOES throw if `GEMINI_API_KEY` is missing, since that
 * is a configuration bug the caller should not silently swallow.
 */
export async function callGemini<T>(opts: CallOptions): Promise<GeminiCallResult<T>> {
  const t0 = Date.now();
  const ai = getClient();
  const config = {
    systemInstruction: opts.systemPrompt,
    temperature: opts.temperature ?? 0.1,
    responseMimeType: "application/json",
    responseSchema: opts.responseSchema,
  };

  async function attempt(): Promise<GeminiCallResult<T>> {
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: opts.userPrompt,
        config,
      });

      const text = response.text;
      if (!text) {
        return {
          data: null,
          raw: response,
          stats: makeStats(response, t0),
          error: "Gemini returned empty text",
        };
      }

      let parsed: T;
      try {
        parsed = JSON.parse(text) as T;
      } catch (e) {
        return {
          data: null,
          raw: response,
          stats: makeStats(response, t0),
          error: `JSON parse failed: ${(e as Error).message}`,
        };
      }

      return { data: parsed, raw: response, stats: makeStats(response, t0) };
    } catch (e) {
      const err = e as Error;
      return {
        data: null,
        raw: null,
        stats: { durationMs: Date.now() - t0 },
        error: `Gemini call failed: ${err.message}`,
      };
    }
  }

  const first = await attempt();
  if (first.data) return first;
  if (opts.retryOnce === false) return first;

  // Single retry on permanent failure (covers transient 5xx / network blips).
  // Don't retry parse failures aggressively — they likely repeat.
  if (first.error?.startsWith("JSON parse failed")) return first;
  return await attempt();
}

function makeStats(response: unknown, t0: number): GeminiCallStats {
  const usage = (response as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number } }).usageMetadata;
  return {
    inputTokens: usage?.promptTokenCount,
    outputTokens: usage?.candidatesTokenCount,
    cachedInputTokens: usage?.cachedContentTokenCount,
    durationMs: Date.now() - t0,
  };
}

// Re-export Type from the SDK so callers (ai-prompt.ts) can build schemas
// without importing the SDK directly.
export { Type };
export type { Schema };
