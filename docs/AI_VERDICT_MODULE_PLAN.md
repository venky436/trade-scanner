# AI Verdict Module — Final Plan (Plug-in / Plug-out, Experimental)

## Context

The trade-scanner already runs a deterministic rule engine that emits `Outlook` per stock (BOUNCE / BREAKOUT / REJECTION / BREAKDOWN / NO_CLEAR_EDGE) and surfaces it as a BUY/SELL/WAIT chip on the home cards. **That stays as-is.**

This plan adds an **independently toggleable, experimental AI verdict module**: Gemini 2.0 Flash is given our structured per-stock telemetry + a curated reference of our metric semantics + market context + detected patterns + the last 24 × 5-min candles. It returns its own BUY / SELL / WAIT call with an entry / stop-loss / target / reasoning. The AI module runs alongside the rule engine as a second, independent signal. Every AI call + outcome is persisted so the user can measure whether AI actually adds value.

### Positioning

This is labelled "AI Verdict Module (Experimental)" everywhere — module name, UI badges, admin page title. The rule engine is the primary system. AI is on probation for the first 30–60 trading days: collect data, then decide whether to keep it, retune the prompt, swap models, or revert. **No trade decisions should be based on AI alone during the observation period.**

### Hard requirement — plug-in / plug-out

A single env flag controls the whole module:
- `AI_MODE_ENABLED=true` + restart → scheduler runs, route registered, frontend renders
- `AI_MODE_ENABLED=false` + restart → zero AI code paths, no Gemini calls, no key needed, existing rule UI unchanged

**4 guard points** (3 startup + 1 defensive):
1. `apps/server/src/index.ts` — guards `createAiCallService().start()`
2. `apps/server/src/server.ts` — guards `server.register(aiRoute)`
3. `apps/server/src/services/ai-call.service.ts` — defensive throw inside `evaluate()` if flag is off
4. `GET /api/config` returns `{ aiModeEnabled }` → frontend components self-disable

### Scope (tight, to control cost)

Selection set per cycle is the **union** (deduped by symbol) of three lanes:

1. **Top 6 NEAR_SUPPORT** stocks with `confidence ≥ 0.65`, sorted by confidence DESC
2. **Top 6 NEAR_RESISTANCE** stocks with `confidence ≥ 0.65`, sorted by confidence DESC
3. **Strong Factor Alignment** stocks — `confidence ≥ 0.85` AND outlook ∈ {BOUNCE_EXPECTED, REJECTION_POSSIBLE, BREAKOUT_LIKELY, BREAKDOWN_RISK}, cap 6

This matches the dashboard sections exactly (`ZONE_SECTION_CAP = 6`, `ZONE_SECTION_CONF_FLOOR = 0.65`) — AI evaluates the same stocks the user sees on the home screen, no wasted tokens on low-conviction stocks.

Typical deduped count: **10–13 stocks per cycle.** Hard cap: 16. Most Strong Factor stocks are also in the top-5 lanes (directional outlooks require being at a level + HIGH confidence pushes them up the zone rankings), so overlap keeps the effective count low.

- Every **5 min**, active **09:45 → 15:30 IST**
- Plus **on-demand** when user opens any stock detail page (rate-limited to 1 forced refresh per symbol per 60s)
- **Single user** — personal-use tool, no multi-tenant complexity

### Cost

- Scheduled: ~13 stocks avg × 69 cycles ≈ **~900 calls/day** (worst case ~1,100). On-demand: ~30/day.
- Tokens per call: ~3,300 input + ~300 output
- Gemini 2.0 Flash with system-prompt context caching: **~₹130 / 10 days, ~₹500 / month**
- Without caching: ~₹350 / 10 days, ~₹1,100 / month
- Trivial either way.

---

## End-to-end flowchart

```
┌────────────────────────────────────────────────────────────────────────┐
│  apps/server/.env                                                       │
│    AI_MODE_ENABLED=true|false  (default false)                          │
│    GEMINI_API_KEY=...          (required only when true)                │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        ▼ guard 1                  ▼ guard 2                  ▼ guard 4
   index.ts:                  server.ts:                  GET /api/config
   start AI scheduler?        register /api/ai/*?         → { aiModeEnabled }
        │                          │                          │
        └─────────────┬────────────┘                          ▼
                      ▼                              Frontend ConfigProvider
        ┌──────────────────────────────┐             reads once at boot;
        │  guard 3: ai-call.service    │             AI components self-disable
        │  evaluate() throws if off    │             when aiModeEnabled = false
        │  (defensive backup)          │
        └──────────────┬───────────────┘
                       │
                       │ (when AI_MODE_ENABLED=true)
                       ▼
   ┌────────────────────────────────────────────────────────────────┐
   │              SCHEDULED CYCLE — every 5 min                      │
   │              Active window: 09:45 → 15:30 IST                   │
   └─────────────────────────────────┬──────────────────────────────┘
                                     │
                                     ▼
   Compute MARKET CONTEXT ONCE per cycle (cache for reuse across 10 calls):
     • NIFTY trend + % change
     • BANKNIFTY trend + % change
     • Sector trends (top sectors by NSE classification)
     • market_regime: TRENDING_UP / TRENDING_DOWN / RANGING / HIGH_VOLATILITY
                                     │
                                     ▼
   Pick top 5 NEAR_SUPPORT + top 5 NEAR_RESISTANCE stocks
   (from in-memory stockMap, sorted by confidence DESC)
                                     │
                                     ▼
   For each of the 10 stocks (parallel) ────────────────────────────┐
                                     │                               │
                                     ▼                               │
   GATHER PER-STOCK DATA (all already in server memory):             │
     • IntelligenceSnapshot (price, zone, momentum, pressure,        │
       volatility, ATR)                                              │
     • Support ₹ + Resistance ₹ + range width                        │
     • RVOL (current 5-min vol ÷ 20-day avg vol)                     │
     • Detected candlestick patterns                                 │
     • Last 24 × 5-min candles (OHLCV)                               │
     • Session: OPENING (9:45–10:00) / MID (10:00–14:30) /           │
       CLOSING (14:30–15:30)                                         │
     • + cached market context from above                            │
                                     │                               │
                                     ▼                               │
   BUILD PROMPT                                                      │
                                                                     │
   SYSTEM PROMPT (~2.5K tokens, context-cached for cost):            │
     Loaded once from docs/AI_REFERENCE.md. Contains:                │
       - Metric semantics (how OUR momentum/pressure/volatility/     │
         zone/ATR/RVOL are computed, with bucket thresholds)         │
       - Decision task: BUY / SELL / WAIT                            │
       - "WAIT is the default. Only fire BUY/SELL when ALL hold:    │
          1. Directional bias clear                                  │
          2. Momentum + pressure aligned with direction              │
          3. Pattern present at structural level                     │
          4. R:R ≥ 1.0 (ideally ≥ 2)                                 │
          5. Not fighting market trend"                              │
       - Trade plan rules:                                           │
          stopLoss anchored to structure (below hammer wick /        │
                                          below support / etc.)     │
          stopLoss distance: 0.25 × ATR ≤ |entry - SL| ≤ 1.5 × ATR  │
          target distance: |target - entry| ≤ 4 × ATR                │
          target anchored to next significant level                  │
       - Use standardised `reasons` codes from the enum              │
       - Use standardised `risk_flags` from the enum                 │
                                                                     │
   USER PROMPT (~800 tokens, structured, NO rule verdict):           │
     SYMBOL: RELIANCE                                                │
     SESSION: MID                                                    │
     PRICE: ₹2458.30  (change +0.42%)                                │
                                                                     │
     MARKET CONTEXT                                                  │
       NIFTY:     STRONG_UP   (+0.55%)                               │
       BANKNIFTY: WEAK_UP     (+0.21%)                               │
       Sector (Energy): NEUTRAL                                      │
       market_regime: TRENDING_UP                                    │
                                                                     │
     POSITION                                                        │
       zone: NEAR_SUPPORT                                            │
       support level: ₹2455 (0.13% below price)                      │
       resistance level: ₹2492 (1.37% above price)                   │
       range width: ₹37 (1.50%)                                      │
                                                                     │
     METRICS                                                         │
       momentum: STRONG_UP, value 0.78                               │
       pressure: BUY, value 0.71                                     │
       volatility: MEDIUM, value 0.60                                │
       ATR(14): ₹9.40                                                │
       RVOL: 2.4x                                                    │
                                                                     │
     DETECTED PATTERNS                                               │
       HAMMER (bullish, single-candle)                               │
                                                                     │
     LAST 24 × 5-MIN CANDLES (oldest first)                          │
       09:15  O 2451 H 2454 L 2449 C 2453 vol 12340                  │
       …                                                             │
       10:00  O 2455 H 2459 L 2452 C 2458 vol 21500                  │
                                     │                               │
                                     ▼                               │
   CALL GEMINI 2.0 FLASH                                             │
     temperature: 0.1                                                │
     responseMimeType: "application/json"                            │
     responseSchema: { verdict, confidence, patterns, reasons,       │
                       reasoning, entry, stopLoss, target,           │
                       riskReward, risk_flags }                      │
                                     │                               │
                                     ▼                               │
   AI returns structured JSON:                                       │
   {                                                                 │
     verdict: "BUY",                                                 │
     confidence: 0.84,           ← RANK, not probability             │
     patterns: ["Hammer", "Bullish Pin Bar"],                        │
     reasons: ["SUPPORT_BOUNCE", "HAMMER", "BUY_PRESSURE",           │
               "STRONG_MOMENTUM", "MARKET_ALIGNED"],                 │
     reasoning: "Hammer at support, rising buy pressure, stop        │
                 placed below the wick. R:R favourable.",            │
     entry:      2458.30,                                            │
     stopLoss:   2452.00,        ← below hammer's low (structural)   │
     target:     2474.00,        ← near resistance                   │
     riskReward: 2.5,                                                │
     risk_flags: ["SMALL_BODY"]                                      │
   }                                                                 │
                                     │                               │
                                     ▼                               │
   VALIDATE (server-side, before persisting):                        │
     • verdict must be BUY / SELL / WAIT                             │
     • If BUY:  stopLoss < entry < target AND R:R ≥ 1                │
     • If SELL: target < entry < stopLoss AND R:R ≥ 1                │
     • |entry - stopLoss| between 0.25 × ATR and 1.5 × ATR           │
     • |target - entry| ≤ 4 × ATR                                    │
     • Structural check (BUY):  SL ≤ support OR SL ≤ pattern low    │
     • Structural check (SELL): SL ≥ resistance OR SL ≥ pattern high│
     • If any check fails → downgrade verdict to WAIT,               │
       null out trade plan, add risk_flag                            │
                                     │                               │
                                     ▼                               │
   PERSIST to DB (ai_calls table):                                   │
     id, symbol, computed_at,                                        │
     model_name, prompt_version,                                     │
     verdict, confidence, patterns[], reasons[], reasoning,          │
     entry, stop_loss, target, risk_reward, risk_flags[],            │
     rule_verdict, rule_confidence  ← snapshot for agreement matrix  │
     market_regime,                                                  │
     metrics_snapshot (JSONB — for prompt-debug + replay),           │
     raw_response (JSONB — full Gemini response)                     │
                                     │                               │
                                     ▼                               │
   CACHE in-memory (TTL 5 min)  ◄───────────────────────────────────┘


   ┌────────────────────────────────────────────────────────────────┐
   │  OUTCOME EVALUATOR (mirrors signal-tracking.service.ts)         │
   │                                                                  │
   │  Background timer every 30s:                                    │
   │    For each ai_calls row, when 15m / 30m / 60m elapsed:         │
   │      compute outcome (SUCCESS / FAILED / NEUTRAL / WAIT_OK)    │
   │      compute max_favorable_pct, max_adverse_pct,                │
   │              target_hit, stop_hit                               │
   │    Write to ai_call_outcomes (FK to ai_calls.id)                │
   │                                                                  │
   │  WAIT-quality scoring (added after first 30 days of data):     │
   │    AI=WAIT counts as WAIT_OK if stock |change| stays            │
   │    within ±1 ATR over 60m. Else WAIT_MISSED.                    │
   └────────────────────────────────────────────────────────────────┘


   ┌────────────────────────────────────────────────────────────────┐
   │  ADMIN PAGE: /admin/ai-performance                              │
   │                                                                  │
   │  Stats always shown with (n=X) sample count:                    │
   │    AI win rate by outcome window: 15m / 30m / 60m               │
   │    Expectancy (winRate × avgGain − lossRate × avgLoss)          │
   │    Avg R:R achieved, max favourable / adverse move              │
   │    By session (OPENING / MID / CLOSING)                         │
   │    By market_regime                                             │
   │    By top reason codes                                          │
   │                                                                  │
   │  AGREEMENT MATRIX (rule × AI, last 30 days):                   │
   │             Rule=BUY     Rule=SELL    Rule=WAIT                 │
   │  AI=BUY   62% (n=42)    n=3          n=14                       │
   │  AI=SELL  n=2           58% (n=31)   n=8                        │
   │  AI=WAIT  n=11          n=9          85% WAIT_OK (n=180)        │
   │                                                                  │
   │  The highest-conviction trade is the diagonal AGREE cell with   │
   │  the biggest n + highest win rate.                              │
   └────────────────────────────────────────────────────────────────┘


   ┌────────────────────────────────────────────────────────────────┐
   │  ON-DEMAND PATH (any stock detail page)                         │
   │                                                                  │
   │  User opens /stock/SYMBOL                                       │
   │       │                                                         │
   │       ▼                                                         │
   │  Frontend POST /api/ai/call/:symbol                             │
   │  (rate-limited: max 1 per symbol per 60s — beyond that,         │
   │   serve cached if fresh, else 429)                              │
   │       │                                                         │
   │       ▼                                                         │
   │  Same pipeline as scheduled: gather → prompt → Gemini →         │
   │  validate → persist → cache                                     │
   │       │                                                         │
   │       ▼                                                         │
   │  Frontend renders AiAnalysisCard in ~2-3 sec                    │
   └────────────────────────────────────────────────────────────────┘


   ┌────────────────────────────────────────────────────────────────┐
   │  CIRCUIT BREAKER (fail-open)                                    │
   │                                                                  │
   │  On any Gemini failure (timeout / 5xx / malformed JSON /        │
   │  validation rejection):                                         │
   │    • Log the error                                              │
   │    • Return null to caller                                      │
   │    • Frontend hides the AI chip / shows "AI unavailable"        │
   │    • Scanner keeps running normally — rule engine unaffected    │
   │  No retries (cycle re-fires in 5 min anyway)                    │
   └────────────────────────────────────────────────────────────────┘
```

---

## Backend changes

All new files. Existing engines, broadcast, signal-tracking, watch-zone, admin — untouched.

### New files

| File | Purpose |
|---|---|
| `apps/server/src/lib/gemini-client.ts` | Thin wrapper around `@google/genai`. Reads `GEMINI_API_KEY`, calls `gemini-2.0-flash-exp` with `temperature: 0.1` + `responseSchema`. Returns `null` on failure (caller falls back). Enables context caching for the system prompt. Logs token counts. |
| `apps/server/src/lib/ai-prompt.ts` | Exports `AI_SYSTEM_PROMPT` (loaded once from `docs/AI_REFERENCE.md`), `buildUserPrompt(input)`, `AI_RESPONSE_SCHEMA`, and `PROMPT_VERSION = "v3.0"` constant. |
| `apps/server/src/lib/ai-validate.ts` | Pure function `validateAiResponse(response, snapshot)` — applies SL/TP bounds + structural checks. Returns either the cleaned response or a downgraded WAIT. |
| `apps/server/src/lib/market-regime.ts` | Pure function `computeMarketRegime(nifty, bankNifty)` → `TRENDING_UP / TRENDING_DOWN / RANGING / HIGH_VOLATILITY`. |
| `apps/server/src/services/ai-call.service.ts` | Factory mirroring `signal-tracking.service.ts`. Owns the cache, the 5-min timer, the in-flight dedup set, the rate-limiter for on-demand. Computes market context once per cycle, reuses across the 10 stocks. **Defensive guard 3 inside `evaluate()`.** |
| `apps/server/src/services/ai-outcome.service.ts` | Mirrors `signal-tracking.service.ts`. Polls every 30s, computes 15m/30m/60m outcomes + WAIT-quality, writes `ai_call_outcomes` rows. |
| `apps/server/src/routes/ai.route.ts` | Two endpoints, behind `authMiddleware`: `GET /api/ai/calls`, `POST /api/ai/call/:symbol` (rate-limited). |
| `apps/server/src/routes/config.route.ts` | Unauthenticated: `GET /api/config` → `{ aiModeEnabled }`. |
| `apps/server/src/routes/admin-ai.route.ts` | Admin-only: `GET /api/admin/ai-performance?days=30` → stats + agreement matrix. |
| `apps/server/src/db/schema/ai-calls.ts` | Drizzle schema for `ai_calls` table. |
| `apps/server/src/db/schema/ai-call-outcomes.ts` | Drizzle schema for `ai_call_outcomes` table. |
| `docs/AI_REFERENCE.md` | ~2K-token curated doc of metric semantics. Loaded once at server boot, used as the system prompt. Single source of truth — edit this file to change AI's understanding. |

### Modified files (minimal, guarded)

| File | Change |
|---|---|
| `apps/server/src/index.ts` | Add `if (AI_MODE_ENABLED) { createAiCallService(deps).start(); createAiOutcomeService(deps).start(); }` |
| `apps/server/src/server.ts` | Always register `configRoute` and `adminAiRoute`. Register `aiRoute` only when flag on. |
| `apps/server/src/.env.example` | Document `AI_MODE_ENABLED=false` + `GEMINI_API_KEY=` |
| `apps/server/package.json` | `bun add @google/genai` (~600 KB) |

### DB schema additions

```sql
CREATE TABLE ai_calls (
  id                 SERIAL PRIMARY KEY,
  symbol             VARCHAR(50) NOT NULL,
  computed_at        TIMESTAMP   NOT NULL DEFAULT NOW(),
  model_name         VARCHAR(100) NOT NULL,    -- "gemini-2.0-flash-exp"
  prompt_version     VARCHAR(50)  NOT NULL,    -- "v3.0"
  verdict            VARCHAR(10) NOT NULL,     -- BUY / SELL / WAIT
  confidence         NUMERIC(4,3) NOT NULL,
  patterns           TEXT[],
  reasons            TEXT[],
  reasoning          TEXT NOT NULL,
  entry              NUMERIC(12,2),
  stop_loss          NUMERIC(12,2),
  target             NUMERIC(12,2),
  risk_reward        NUMERIC(5,2),
  risk_flags         TEXT[],
  rule_verdict       VARCHAR(10) NOT NULL,     -- snapshot for agreement matrix
  rule_confidence    NUMERIC(4,3) NOT NULL,
  market_regime      VARCHAR(20) NOT NULL,     -- TRENDING_UP etc.
  metrics_snapshot   JSONB NOT NULL,           -- prompt-debug + replay
  raw_response       JSONB NOT NULL            -- full Gemini response
);
CREATE INDEX idx_ai_calls_symbol_time ON ai_calls (symbol, computed_at);
CREATE INDEX idx_ai_calls_verdict     ON ai_calls (verdict, computed_at);

CREATE TABLE ai_call_outcomes (
  ai_call_id         INTEGER PRIMARY KEY REFERENCES ai_calls(id) ON DELETE CASCADE,
  outcome_15m        VARCHAR(15),   -- SUCCESS / FAILED / NEUTRAL / WAIT_OK / WAIT_MISSED / PENDING
  outcome_30m        VARCHAR(15),
  outcome_60m        VARCHAR(15),
  max_favorable_pct  NUMERIC(8,4),
  max_adverse_pct    NUMERIC(8,4),
  target_hit         BOOLEAN,
  stop_hit           BOOLEAN,
  evaluated_at       TIMESTAMP DEFAULT NOW()
);

-- Archive table (cron moves rows > 90 days into this table; never delete)
CREATE TABLE ai_calls_archive          (LIKE ai_calls          INCLUDING ALL);
CREATE TABLE ai_call_outcomes_archive  (LIKE ai_call_outcomes  INCLUDING ALL);
```

### Response schema (Gemini-enforced)

```ts
{
  verdict:    "BUY" | "SELL" | "WAIT",
  confidence: number,                  // 0..1 — RANK, not probability
  patterns:   string[],                // free-form ["Hammer", "Pin Bar"]
  reasons:    ReasonCode[],            // enum
  reasoning:  string,                  // 2-3 sentences
  entry:      number | null,           // null when WAIT
  stopLoss:   number | null,
  target:     number | null,
  riskReward: number | null,           // ≥ 1.0 when BUY/SELL
  risk_flags: RiskFlag[]
}

ReasonCode = SUPPORT_BOUNCE | RESISTANCE_REJECTION | BREAKOUT | BREAKDOWN
           | HAMMER | ENGULFING | MORNING_STAR | EVENING_STAR
           | BUY_PRESSURE | SELL_PRESSURE | STRONG_MOMENTUM
           | MARKET_ALIGNED | RVOL_SURGE | STRUCTURAL_LEVEL
           | RISK_REWARD_FAVOURABLE

RiskFlag   = LOW_VOLUME | HIGH_VOLATILITY | WEAK_PATTERN | AGAINST_MARKET_TREND
           | POOR_RR | NARROW_RANGE | OVEREXTENDED_MOVE | WEAK_CONFIRMATION
           | SMALL_BODY | OPENING_NOISE | CLOSING_VOLATILITY
           | INSUFFICIENT_CONFLUENCE
```

---

## Frontend changes

All AI components self-disable when `aiModeEnabled === false`. Zero impact on the rest of the UI in either mode.

### New files

| File | Purpose |
|---|---|
| `apps/web/src/lib/types.ts` *(modify additively)* | Add `AiVerdict`, `ReasonCode`, `RiskFlag` types |
| `apps/web/src/context/config-context.tsx` | Fetches `/api/config` once at boot, exposes `useConfig()` |
| `apps/web/src/hooks/use-ai-calls.ts` | `useAiCalls()` polls `GET /api/ai/calls` every 30s; `useAiCall(symbol)` triggers POST on detail-page mount. Both return empty/no-op when `aiModeEnabled = false`. |
| `apps/web/src/components/ai-verdict-chip.tsx` | Small inline chip. Returns `null` when disabled or no cached entry. Hover tooltip shows reasoning. Label says "AI Rank 84%" (not "probability"). |
| `apps/web/src/components/ai-analysis-card.tsx` | Full card for detail page: verdict + agree/disagree vs rule + patterns + reasoning + trade plan + risk flags. Returns `null` when disabled. |
| `apps/web/src/app/admin/ai-performance/page.tsx` | New admin route — performance + agreement matrix dashboard |
| `apps/web/src/components/ai-performance-dashboard.tsx` | Renders the stats cards + agreement matrix. Mirrors `tracking-dashboard.tsx` styling. |

### Modified files (one-line additions)

| File | Change |
|---|---|
| `apps/web/src/components/market-card.tsx` | Append `<AiVerdictChip symbol={data.symbol} />` to the existing `ActionConfidenceRow` |
| `apps/web/src/components/stock-detail.tsx` | Insert `<AiAnalysisCard symbol={symbol} />` between hero and chart |

---

## Critical files to reference (mirror these patterns)

| Existing file | What to mirror |
|---|---|
| `apps/server/src/services/signal-tracking.service.ts` | Factory shape (createX/start/stop), in-memory cache, 30s eval timer, DB persistence pattern, NEUTRAL dead-zone |
| `apps/server/src/services/broadcast.service.ts` | How `marketDataService` + `cachedLevels` + `candleTracker` are wired into a service |
| `apps/server/src/services/candle-tracker.service.ts` | `getRecentCandles(symbol, n)` — feeds AI prompt |
| `apps/server/src/lib/intelligence-transformer.ts` | `toIntelligence()` snapshot for prompt |
| `apps/server/src/lib/pattern-engine.ts` | `detectPattern()` for the pattern field |
| `apps/server/src/routes/admin.route.ts` | `authMiddleware` + admin route pattern |
| `apps/web/src/components/tracking-dashboard.tsx` | Look + feel of the new AI performance page |
| `apps/web/src/lib/api.ts` | `apiFetch` for the new hooks |

---

## Switching modes — the user experience

**Turn AI mode ON:**
```bash
# apps/server/.env
AI_MODE_ENABLED=true
GEMINI_API_KEY=...

# Then:
docker restart trading-backend
```
Refresh frontend — AI chips + cards appear, scheduler starts, every call persisted.

**Turn AI mode OFF:**
```bash
# apps/server/.env
AI_MODE_ENABLED=false

# Then:
docker restart trading-backend
```
Refresh frontend — AI chips + cards vanish. Rule UI continues unchanged. No data deleted; the `ai_calls` table just stops growing.

**One flag, one restart. No code changes.**

---

## Implementation phases

Stage-able so each step is independently verifiable.

| # | Phase | Outcome | Time |
|---|---|---|---|
| 1 | Curate `docs/AI_REFERENCE.md` | One ~2K-token reference doc, reviewed + accurate | 1 hr |
| 2 | DB schema + Drizzle migrations | `ai_calls` + `ai_call_outcomes` + archive tables exist; `npx drizzle-kit push` clean | 30 min |
| 3 | `gemini-client.ts` + `config.route.ts` + smoke test | `curl` returns one real verdict for one hand-built input | 1 hr |
| 4 | `ai-prompt.ts` + `ai-validate.ts` + `market-regime.ts` + tests on 3 stocks | Sample symbols (one at each zone) return sane validated verdicts | 1.5 hr |
| 5 | `ai-call.service.ts` (scheduler + cache + rate-limit + market-context cache + persist) + flag-gated startup | Server logs show 5-min cycles running 10 stocks; toggling flag + restart makes it silent | 1.5 hr |
| 6 | `ai-outcome.service.ts` + 30s evaluator + WAIT-quality after 30 days | Outcomes filling in `ai_call_outcomes` table at 15/30/60m | 1 hr |
| 7 | `ai.route.ts` + `admin-ai.route.ts` + `config-context.tsx` + `use-ai-calls.ts` + AI chip + AI card + admin performance page | End-to-end visible: dashboard chip, detail card, admin matrix | 2.5 hr |
| 8 | **Observation** | 30–60 trading days, AI logs everything, no trade decisions yet | — |
| 9 | Review | Look at agreement matrix + expectancy. Decide: keep / drop / tune prompt / swap model | 1 day |

**Total dev: ~9 hours of focused work.** Then observation.

---

## Verification

1. **Mode OFF — confirm zero footprint**
   ```bash
   # .env: AI_MODE_ENABLED unset or false
   bun run dev
   # Logs MUST NOT contain "[AI]" anywhere
   curl localhost:4002/api/config      # → { "aiModeEnabled": false }
   curl localhost:4002/api/ai/calls    # → 404
   # Frontend: cards identical to today, no chip, no card on detail page
   ```

2. **Mode ON — full pipeline**
   ```bash
   # .env: AI_MODE_ENABLED=true + GEMINI_API_KEY=...
   bun run dev
   # Logs: "[AI] Scheduler started — top-10 every 5 min, active 09:45–15:30 IST"
   # First tick: "[AI] Cycle: 10 stocks, 9 verdicts cached, 1 fail-open, cost ≈ $0.003"
   curl -X POST localhost:4002/api/ai/call/RELIANCE \
     -H "Authorization: Bearer $JWT" | jq
   # → full verdict JSON with entry/stopLoss/target
   ```

3. **Persistence working**
   ```sql
   SELECT symbol, verdict, confidence, model_name, prompt_version, market_regime
     FROM ai_calls ORDER BY computed_at DESC LIMIT 10;
   -- After 15-30-60 min: outcomes fill in
   SELECT a.symbol, a.verdict, o.outcome_15m, o.outcome_30m, o.outcome_60m
     FROM ai_calls a JOIN ai_call_outcomes o ON o.ai_call_id = a.id
     ORDER BY a.computed_at DESC LIMIT 10;
   ```

4. **Frontend visual check (mode ON)**
   - Top-5 NEAR_SUPPORT cards show `🤖 AI: BUY · Hammer · Rank 84%` chip
   - Click any stock → detail page shows full AI Analysis card with trade plan
   - Open a non-top-10 stock → on-demand AI call fires (loading ~2s → card appears)
   - Admin: `/admin/ai-performance` shows stats with `(n=X)` sample counts + agreement matrix

5. **Rate limit working**
   - Rapidly refresh detail page → second+ refreshes within 60s return cached, not new Gemini calls

6. **Circuit breaker working**
   - Temporarily set bad API key → `[AI]` errors logged, frontend shows "AI unavailable", scanner keeps running normally

7. **Flip mode OFF mid-session**
   - Restart with `AI_MODE_ENABLED=false`
   - Confirm: scheduler stops, route returns 404, frontend hides AI components, no errors

8. **Cost check after 24h ON**
   - Sum `[AI] cost ≈ $X` log lines → should be ≤ $0.50/day, ideally ~$0.16 with caching

9. **No regressions**
   - `/admin/tracking` works
   - Live WS prices flash
   - Watch Zone works
   - Login / auth works

---

## Design philosophy notes

- **Confidence is a RANK, not a probability.** UI labels say "Rank 84%" not "84% likely". Use confidence to sort opportunities; do not assume an 84-confidence trade wins 84% of the time. Calibration is a Phase 2 concern after hundreds of samples.

- **WAIT is a valid output, not a failure.** A WAIT that avoids a stop is a good decision. The outcome evaluator scores WAIT calls separately (`WAIT_OK` vs `WAIT_MISSED`) so the system isn't punished for prudence.

- **AI is on probation.** No trade decisions during observation period. Position size based purely on rule engine; AI is informational until data proves otherwise.

- **Fail-open.** AI failures must never block the scanner. The rule engine is the source of truth; AI is the optional second opinion.

- **Plug-in / plug-out is a hard requirement, not a nice-to-have.** Every guard point is a load-bearing wall.

---

## Out of scope for v1 (deferred — known + intentional)

- **Confidence calibration** — needs hundreds of decided trades first. Add a `calibrated_confidence` column later.
- **Opportunity-score stock selection** — current top-5 NEAR_SUPPORT + top-5 NEAR_RESISTANCE is simpler. Revisit if observation data shows we're missing obvious setups elsewhere.
- **Replay AI call (admin button)** — `metrics_snapshot` + `raw_response` are persisted, so manual replay via curl is possible. UI button later if needed.
- **Live runtime toggle in admin UI** — env flag + restart for v1. Add a UI toggle later if it becomes annoying.
- **Multiple AI providers side-by-side** — single provider. Swap `gemini-client.ts` for `claude-client.ts` later.
- **Streaming AI responses to UI** — 2-3 sec return-on-complete is fine.
- **Hard daily cost cap** — log usage first, add a circuit breaker once we know real numbers.
- **AI verdicts on Watch Zone items** — top-10 + on-demand only.
- **Better rule-engine features (VWAP, RSI, opening-range-breakout, multi-timeframe alignment)** — separate workstream. Better engine inputs improve AI more than a better model.
