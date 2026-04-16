# Market Intelligence Layer

> Reframes the user-facing surface from "BUY/SELL signals with a 1–10 score" into "market intelligence" — Zone, Momentum, Pressure, Volatility, Outlook, Confidence, Bias. Engines are unchanged; only the public API + frontend changed.

## Why this exists

The original system told users **what to do** (BUY/SELL with a score). That framing has two problems:

1. It positions the app as a signal provider — high regulatory and trust risk, and it overstates how confident any system can be about a real trade.
2. The 1–10 score double-counted context: S/R proximity contributed 25%, but the same S/R level was also the trigger for BOUNCE/REJECTION detection. The number conflated "where price is" with "what's happening".

The new framing helps users **understand the situation** so they can decide for themselves:

- **Where price is** → `Zone`
- **How strong movement is** → `Momentum` + `Pressure` + `Volatility` (each with a 0–1 score)
- **What is likely** → `Outlook`
- **How reliable** → `Confidence` (HIGH / MEDIUM / LOW)
- **Net read** → `Bias` (small, secondary)

The old internal engines (signal-engine, score-engine, signal-worker, accuracy tracker, admin dashboard) keep running unchanged. The 1–10 score still gates accuracy tracking — it's just hidden from users. The `/admin` page still shows it for validation.

---

## The two parallel pipelines

```
                          ┌────────────────────┐
                          │   KITE CONNECT     │
                          │  (live ticks +     │
                          │   historical)      │
                          └──────────┬─────────┘
                                     │
                                     ▼
         ┌─────────────────────────────────────────┐
         │      UNCHANGED ENGINES (internal)       │
         │                                         │
         │  pressure.service.ts   → value, signal  │
         │  candle-tracker        → 5-min OHLCV    │
         │  momentum-engine.ts    → value, signal  │
         │  pattern-engine.ts     → pattern, dir   │
         │  levels.service.ts     → S/R zones      │
         │  signal-engine.ts      → action, type   │  ◄── still runs
         │  score-engine.ts       → 1-10 score     │  ◄── still runs
         └──────────────┬─────────────────────┬────┘
                        │                     │
          ┌─────────────▼──────┐        ┌────▼──────────────────┐
          │ PUBLIC PATH (NEW)  │        │ INTERNAL PATH (kept)  │
          │                    │        │                       │
          │ intelligence-      │        │ signal-worker +       │
          │ transformer.ts     │        │ accuracy tracker      │
          │ (pure function)    │        │ (gates on score ≥ 9)  │
          └─────────┬──────────┘        └───────────┬───────────┘
                    │                               │
                    ▼                               ▼
          ┌─────────────────────┐         ┌─────────────────────┐
          │ IntelligenceSnapshot│         │ signal_accuracy_log │
          │ { zone, momentum,   │         │   (PostgreSQL)      │
          │   pressure, vol,    │         └──────────┬──────────┘
          │   outlook, bias,    │                    ▼
          │   confidence }      │            ┌────────────────┐
          └──────────┬──────────┘            │ /admin page    │
                     │                       │ (1–10 score    │
                     ▼                       │  + win rate %) │
          ┌─────────────────────┐            └────────────────┘
          │ broadcast.service   │                 (internal)
          │ every 500 ms        │
          └──────────┬──────────┘
                     │
                     ▼
          ┌─────────────────────┐
          │ WebSocket :4002/ws  │
          └──────────┬──────────┘
                     │
                     ▼
          ┌─────────────────────┐
          │ market-data-context │
          │  stockMap<sym, IS>  │
          │  + marketContext    │
          └──────────┬──────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
  ┌──────────┐ ┌──────────┐ ┌──────────┐
  │ market-  │ │ card     │ │ stock-   │
  │ context- │ │ grid     │ │ detail   │
  │ banner   │ │ (cards)  │ │ (4 sec)  │
  └──────────┘ └──────────┘ └──────────┘
                     │
                     ▼
              ┌──────────────┐
              │     USER     │
              │ (sees market │
              │ intelligence,│
              │ no BUY/SELL) │
              └──────────────┘
```

**Key insight:** the two pipelines share the same engine outputs but never overlap downstream. Users only see the intelligence path; accuracy validation lives entirely in the internal path. That's why the change is "no logic changes" — we added a new sibling branch instead of rewriting the existing one.

---

## Per-stock transformation

`apps/server/src/lib/intelligence-transformer.ts` exposes one pure function:

```ts
toIntelligence(input: IntelligenceInput): IntelligenceSnapshot
```

It runs **inline** in the broadcast tick (every 500 ms, for every dirty symbol). No cache. ~150 stocks × pure synchronous function = sub-millisecond cost. Revisit only if profiling shows a bottleneck at higher scale.

```
RAW ENGINE OUTPUT                   →   PUBLIC INTELLIGENCE SHAPE
─────────────────────────────────────────────────────────────────

price = 2458                        →   price: 2458

sr.resistanceZone.distancePercent = 0.3%
sr.resistanceZone.level = 2465      →   context: {
sr.supportZone.distancePercent = 4.1%      zone: "NEAR_RESISTANCE",
                                            distanceToLevel: 0.3,
                                            level: 2465
                                          }

momentum.signal = "STRONG_UP"       →   momentum: {
momentum.value = 0.78                      label: "STRONG_UP",
                                            score: 0.78
                                          }

pressure.signal = "STRONG_BUY"      →   pressure: {
pressure.value = 0.71                      label: "BUY",    ◄── collapsed
                                            score: 0.71
                                          }

candles.high = 2475                 →   volatility: {
candles.low  = 2420                        label: "MEDIUM",
range = 2.2% / price                       score: 0.6
                                          }

                                    →   direction (from zone + momentum):
                                          NEAR_RESISTANCE + momentum > 0
                                          → BUY (breakout implied)

                                    →   confidence formula (direction-aware):
                                          alignedMomentum = max(0.78, 0) = 0.78
                                          alignedPressure = max(0.71, 0) = 0.71
                                          base = (0.78*0.5 + 0.71*0.5) = 0.745
                                          × (1 - 0.6*0.15) = × 0.91
                                        = 0.678
                                    →   confidenceLabel: "MEDIUM"

                                    →   outlook lookup:
                                          NEAR_RESISTANCE + STRONG_UP + MEDIUM
                                          → NO_CLEAR_EDGE
                                          (BREAKOUT_LIKELY needs HIGH conf)

                                    →   bias:
                                          STRONG_UP + BUY → BULLISH
```

---

## The four computations in detail

### 1. Zone

```ts
const NEAR = 1.0; // %

if (resistance is within 1% AND closer than support) → NEAR_RESISTANCE
if (support    is within 1%)                          → NEAR_SUPPORT
otherwise                                             → MID_RANGE
```

When `MID_RANGE`, both `distanceToLevel` and `level` are `null`.

### 2. Momentum (5 labels)

```
backend signal     →     intelligence label
─────────────────────────────────────────────
STRONG_UP          →     STRONG_UP
UP                 →     WEAK_UP
FLAT               →     NEUTRAL          ← honest about no direction
DOWN               →     WEAK_DOWN
STRONG_DOWN        →     STRONG_DOWN

score = |momentum.value|   // 0..1 magnitude
```

### 3. Pressure (3 labels — collapsed)

```
backend signal     →     intelligence label
─────────────────────────────────────────────
STRONG_BUY         →     BUY
BUY                →     BUY
NEUTRAL            →     NEUTRAL
SELL               →     SELL
STRONG_SELL        →     SELL

score = |pressure.value|
```

### 4. Volatility (from intraday range)

Same formula as the original score-engine, just exposed as a 0–1 score + label:

```
range = (intraday high - intraday low) / price

range ≥ 3.0%  → score 1.0   label HIGH
range ≥ 2.0%  → score 0.8   label HIGH
range ≥ 1.0%  → score 0.6   label MEDIUM
range ≥ 0.5%  → score 0.4   label MEDIUM
range <  0.5% → score 0.2   label LOW
```

### 5. Confidence (direction-aware formula)

Confidence measures how strongly the market supports the **implied direction**, not raw magnitude. The pipeline is: `zone → direction → confidence → outlook` (no circular dependency).

**Step 1 — Implied direction** (from zone + raw momentum value):

```
NEAR_RESISTANCE + momentum > 0  → BUY   (breakout implied)
NEAR_RESISTANCE + momentum < 0  → SELL  (rejection implied)
NEAR_SUPPORT    + momentum > 0  → BUY   (bounce implied)
NEAR_SUPPORT    + momentum < 0  → SELL  (breakdown implied)
MID_RANGE       + any           → NEUTRAL
```

**Step 2 — Directional alignment** (only count what supports the direction):

```ts
// BUY direction: only positive values help
alignedMomentum = direction === "BUY" ? max(momentum.value, 0) : max(-momentum.value, 0)
alignedPressure = direction === "BUY" ? max(pressure.value, 0) : max(-pressure.value, 0)
// NEUTRAL direction: both = 0
```

**Step 3 — Minimum alignment check** (filter fake weak signals):

```ts
if (alignedMomentum < 0.2 && alignedPressure < 0.2) → cap at LOW, skip amplifier
```

**Step 4 — Confidence formula** (direction-aware inputs, volatility dampener):

```ts
base       = alignedMomentum * 0.5 + alignedPressure * 0.5
confidence = base * (1 - volatility.score * 0.15)
```

Volatility acts as a **dampener**, not a booster. High-volatility stocks get a slight confidence penalty (max −15%) because wild swings are less predictable. Calm stocks with strong directional alignment are rewarded with near-full confidence.

```
confidence > 0.7  → HIGH
confidence > 0.5  → MEDIUM
otherwise         → LOW
```

**Why this matters:** Previously, `|momentum.value|` and `|pressure.value|` were used — a stock with strong SELL pressure near support would get HIGH confidence for a BOUNCE outlook. Now, wrong-direction strength contributes 0.

### 6. Outlook (decision table — full truth table)

```
zone              momentum       confidence   →  outlook
──────────────────────────────────────────────────────────────
MID_RANGE         *              *            →  NO_CLEAR_EDGE

NEAR_RESISTANCE   STRONG_UP      HIGH         →  BREAKOUT_LIKELY
NEAR_RESISTANCE   STRONG_UP      MED/LOW      →  NO_CLEAR_EDGE
NEAR_RESISTANCE   WEAK_UP        *            →  NO_CLEAR_EDGE
NEAR_RESISTANCE   NEUTRAL        *            →  NO_CLEAR_EDGE
NEAR_RESISTANCE   WEAK_DOWN      *            →  REJECTION_POSSIBLE
NEAR_RESISTANCE   STRONG_DOWN    *            →  REJECTION_POSSIBLE

NEAR_SUPPORT      STRONG_UP      *            →  BOUNCE_EXPECTED
NEAR_SUPPORT      WEAK_UP        *            →  BOUNCE_EXPECTED
NEAR_SUPPORT      NEUTRAL        *            →  NO_CLEAR_EDGE
NEAR_SUPPORT      WEAK_DOWN      *            →  NO_CLEAR_EDGE
NEAR_SUPPORT      STRONG_DOWN    HIGH         →  BREAKDOWN_RISK
NEAR_SUPPORT      STRONG_DOWN    MED/LOW      →  NO_CLEAR_EDGE
```

The `NO_CLEAR_EDGE` fallback prevents quiet stocks from being mislabeled as bearish/bullish setups just because they happen to be near a level.

### 7. Bias (secondary read)

```
momentum is up   AND pressure is BUY   → BULLISH
momentum is down AND pressure is SELL  → BEARISH
otherwise                              → NEUTRAL
```

Bias is a one-line footer, never the hero element.

---

## Public API shape

```ts
interface IntelligenceSnapshot {
  symbol: string;
  price: number;
  change: number;       // % vs prev close
  timestamp: number;

  context: {
    zone: "NEAR_RESISTANCE" | "NEAR_SUPPORT" | "MID_RANGE";
    distanceToLevel: number | null;   // %
    level: number | null;
  };

  momentum: {
    label: "STRONG_UP" | "WEAK_UP" | "NEUTRAL" | "WEAK_DOWN" | "STRONG_DOWN";
    score: number;     // 0..1 magnitude
  };

  pressure: {
    label: "BUY" | "NEUTRAL" | "SELL";
    score: number;     // 0..1
  };

  volatility: {
    label: "HIGH" | "MEDIUM" | "LOW";
    score: number;     // 0..1
  };

  outlook: "BREAKOUT_LIKELY" | "BREAKDOWN_RISK" | "BOUNCE_EXPECTED"
         | "REJECTION_POSSIBLE" | "NO_CLEAR_EDGE";

  bias: "BULLISH" | "BEARISH" | "NEUTRAL";

  confidence: number;          // 0..1
  confidenceLabel: "HIGH" | "MEDIUM" | "LOW";
}

interface MarketContext {
  condition: "TRENDING" | "SIDEWAYS";
  nifty:     { direction: "UP" | "DOWN" | "FLAT"; changePercent: number };
  bankNifty: { direction: "UP" | "DOWN" | "FLAT"; changePercent: number };
}

interface IntelligenceWsMessage {
  type: "snapshot" | "market_update";
  data: IntelligenceSnapshot[];
  market: MarketContext | null;
  timestamp: number;
}
```

`condition` is `TRENDING` when `|nifty change| ≥ 0.3%`, else `SIDEWAYS`.

**The wire format strips everything else.** No `signal.action`, no `score`, no `scoreBreakdown`, no `zoneScore`, no raw signed momentum/pressure values. The frontend cannot reach back into old data.

---

## Endpoints

| Endpoint | Returns | Notes |
|---|---|---|
| `GET /api/stocks` | `{ count, data: IntelligenceSnapshot[], market: MarketContext, timestamp }` | Full scanner list |
| `GET /api/stocks/:symbol/snapshot` | `IntelligenceSnapshot & { open, high, low, close, volume, levels: { support, resistance }, dataSource, computedAt }` | Single stock; `levels` is a chart-helper field for drawing S/R lines, not scoring |
| `GET /api/stocks/levels` | `Record<symbol, SupportResistanceResult>` | Bulk levels (used by chart) — unchanged |
| `GET /api/stocks/search?q=...` | `{ results: [{ symbol, price, change, isTracked }] }` | Symbol search — unchanged |
| `GET /api/stocks/:symbol/history` | `{ symbol, interval, candles }` | Chart history — unchanged |
| WS `/ws` | `IntelligenceWsMessage` | Live updates every 500 ms |
| `GET /api/admin/*` | unchanged | Internal validation dashboard, still uses 1–10 score |

---

## Card visual (per stock, top-to-bottom)

The card was deliberately simplified to **4 elements** so the user can scan dozens of stocks fast:

```
┌──────────────────────────────────────────────┐
│ ▎ RELIANCE                       ₹2458.30  │  ← left zone stripe (kept)
│ ▎ Near Resistance                  +0.42%  │
│ ▎                                          │
│ ▎ ┌──────────────────────────────────────┐ │
│ ▎ │ 🔥                                    │ │  ← OUTLOOK HERO
│ ▎ │ Breakout Likely                       │ │     (the dominant element,
│ ▎ │ ₹2465 · 0.30% away                    │ │      bigger icon, larger text)
│ ▎ └──────────────────────────────────────┘ │
│ ▎                                          │
│ ▎ Confidence   ████████░░  HIGH · 78%      │
└──────────────────────────────────────────────┘
```

Removed from the card (still available on the detail page):
- 3-up metric tiles (Momentum / Pressure / Volatility)
- Bias dot+label footer

Color tones (soft, not aggressive):
- `NEAR_RESISTANCE` / `BREAKDOWN_RISK` / `REJECTION_POSSIBLE` → soft red
- `NEAR_SUPPORT` / `BREAKOUT_LIKELY` / `BOUNCE_EXPECTED` → soft green
- `MID_RANGE` / `NO_CLEAR_EDGE` → zinc

### Visual confidence priority

The card adapts to its `confidenceLabel` so the user's eye lands on what matters:

| Confidence | Treatment |
|---|---|
| `HIGH` (when `highlight` prop is set) | `ring-2` colored ring (emerald for bullish outlooks, rose for bearish) |
| `MEDIUM` | Default appearance |
| `LOW` | `opacity-70`, restored to `opacity-100` on hover |

The `highlight` prop is set by the dashboard for cards in the Top Opportunities lane (see below).

---

## Top Opportunities lane

Above the main "Opportunities" grid, the dashboard renders a small highlighted lane that surfaces the best confidence setups. It exists to give the user a "look here first" shortcut without hiding the rest.

### Selection logic

```ts
const candidates = allStocks.filter(
  (s) => s.context.zone !== "MID_RANGE" && s.outlook !== "NO_CLEAR_EDGE",
);
const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
const top5 = sorted.slice(0, 5);

// Floor: only show the section if at least one card clears 0.6 confidence
const meetsFloor = top5.some((s) => s.confidence >= 0.6);
return meetsFloor ? top5 : [];
```

Notes:
- Always at most 5 cards
- **Excludes `NO_CLEAR_EDGE` outlook** — a stock can be near a level but have flat momentum, in which case it isn't an "opportunity"
- Section hides entirely if no card clears 0.6 confidence (avoids "Top Opportunities" looking broken in dead markets)
- The 5 selected stocks are **excluded from the main Opportunities grid** below — no duplication
- Section label is "Top Opportunities", not "High Confidence" — avoids implying certainty
- All 5 cards render with `highlight={true}` so they get the colored ring

### Layout order in the dashboard

```
┌─ Market Context Banner ──────────────────────────────┐
│ Market: TRENDING   NIFTY ↑   BANKNIFTY ↑             │
└──────────────────────────────────────────────────────┘
┌─ [Stocks | Options] toggle ─┐
└─────────────────────────────┘
┌─ Market Indices ─────────────────────────────────────┐
│ NIFTY 50    BANKNIFTY    SENSEX                       │
└──────────────────────────────────────────────────────┘
┌─ ✨ Top Opportunities ─────────────────────────────────┐  ← only if topOpps.length > 0
│ Best 5 setups by confidence                            │
│ [ ringed cards × 5 ]                                   │
└──────────────────────────────────────────────────────┘
┌─ 📊 Opportunities ─────────────────────────────────────┐
│ Showing X of Y                       [filter dropdown] │
│ [ regular cards × X ]                                  │
└──────────────────────────────────────────────────────┘
```

### Opportunities filter dropdown

The "Opportunities" section header has a dropdown letting the user widen or narrow the grid:

| Option | Filter logic | Default? |
|---|---|---|
| **Actionable setups** | `zone !== "MID_RANGE" && outlook !== "NO_CLEAR_EDGE"` | ✅ |
| All stocks | no filter — every stock in stockMap (excluding indices) | |
| Near resistance only | `zone === "NEAR_RESISTANCE"` | |
| Near support only | `zone === "NEAR_SUPPORT"` | |

The default **Actionable setups** filter is intentionally tighter than just "near a level". A stock can sit at support but have neutral momentum (`outlook === "NO_CLEAR_EDGE"`), and that's not actionable. By filtering both zone AND outlook, the default view stays clean and only shows stocks where the system has a directional read. Users who want the full picture switch to "All stocks".

The two zone-only options (`Near resistance only` / `Near support only`) deliberately do NOT filter outlook — when you explicitly ask for a zone, you want every stock there regardless of whether momentum has formed.

## Top banner (above the grid)

```
┌──────────────────────────────────────────────────────┐
│ Market: TRENDING    NIFTY ↑ +0.42%    BANKNIFTY ↑    │
└──────────────────────────────────────────────────────┘
```

---

## On-demand stocks (search for any NSE symbol)

The navbar search lets users open any NSE symbol, not just the ~514 stocks tracked by the live tick stream. When the user opens a stock detail page for a symbol that isn't in `stockMap`, the stock-detail component falls back to `GET /api/stocks/:symbol/snapshot`, which computes intelligence on-demand from Kite's historical API.

### Why on-demand is tricky

The live engines all depend on data sources that untracked symbols don't have:

| Engine | Live source | On-demand equivalent |
|---|---|---|
| **S/R** (`levels.service.ts`) | 25-day daily candles (from EOD job) | Fetch on request |
| **Momentum** (`momentum-engine.ts`) | 5-min candles from `candle-tracker` (intraday session) | Fetch on request |
| **Pressure** (`pressure.service.ts`) | Live tick stream (buyer/seller volume classification per tick) | **Approximate from candles** (see below) |
| **Volatility** | Intraday high/low from live quote | Daily high/low from last candle |

### Snapshot endpoint flow

`apps/server/src/routes/stocks.route.ts` `/api/stocks/:symbol/snapshot` makes **two parallel Kite API calls** for untracked symbols:

```ts
const [dailyResult, intradayResult] = await Promise.allSettled([
  kc.getHistoricalData(token, "day", dailyFrom, to),      // 25 × daily
  kc.getHistoricalData(token, "5minute", todayFrom, to),  // today's session
]);
```

Results:

1. **Daily candles** (25 × daily)
   - Compute S/R via `getSupportResistance()` — same function used by the live levels worker
   - Fallback price data — if there's no live quote, price/open/high/low/close come from the last daily candle

2. **Intraday 5-min candles** (today's session, ~75 candles)
   - Momentum: `getMomentum(intradayCandles.slice(-3))` — last 3 × 5-min candles, **exactly the same scale as the live engine** (which also uses 3 × 5-min from the candle tracker)
   - Pressure: `pressureFromCandles(intradayCandles.slice(-3))` — approximation, see next section

Both calls use `Promise.allSettled` so the snapshot still renders if either one fails.

### Pressure approximation — `pressureFromCandles`

New helper at `apps/server/src/lib/pressure-from-candles.ts`. Mirrors the live pressure engine's scoring formula but replaces tick-level buyer/seller classification with a per-candle approximation:

**Per-candle classification** (replaces the tick stream):
- Green candle (close > open) → assume 100% of the candle's volume was buyers → `delta = +volume`, `deltaStrength = +1`
- Red candle (close < open) → assume 100% seller volume → `delta = -volume`, `deltaStrength = -1`
- Flat (close == open) → `delta = 0`, `deltaStrength = 0`

**Per-candle score** (same formula as `pressure.service.ts:closeCandle`):
```ts
combined = deltaStrength * 0.5
         + momentum * 0.3
         + volumeStrength * 0.2 * sign(deltaStrength)
```
Where:
- `momentum = clamp((close - open) / open / 0.003, -1, 1)` — same 0.3% normalization as the live engine
- `volumeStrength = clamp(c.volume / avgVolume, 0, 1)` — relative to the mean volume across the 3-candle window (the live engine uses a running day-average; we use window-average to stay self-contained)

**Rolling 3-candle weighted average** (same formula as `getPressureForState`):
```ts
value = scores[0] * 0.2 + scores[1] * 0.3 + scores[2] * 0.5;
if (allPositive || allNegative) value *= 1.15;   // consistency boost
value = clamp(value, -1, 1);
if (Math.abs(value) < 0.3) value = 0;            // dead zone
```

**Signal bucketing** — identical thresholds to the live engine (STRONG_BUY > 0.6, BUY > 0.3, etc).

### Limitations of the approximation

- **Coarser than tick-level**: the live engine classifies *each tick's* volume delta by price direction. The approximation classifies *each candle's entire volume* as one side. In practice this is close enough — studies have shown per-candle sign classification captures ~80% of the signal that tick-level delta gives you.
- **No running day-average volume**: the live engine compares each candle's volume to a running day average (more accurate on mid-day). The approximation uses the 3-candle window's own mean volume. Good enough for a 15-minute view (3 × 5-min).
- **Same dead zone as live engine**: values under ±0.3 zero out, so a choppy stock still shows NEUTRAL — no false signals from noise.

### Test coverage

`apps/server/src/lib/pressure-from-candles.test.ts` — 9 tests covering:
- Guard clauses (< 3 candles → null, zero volume → null)
- Strong BUY / SELL detection
- Doji → NEUTRAL via dead zone
- Mixed direction → mixed trend
- Consistency boost for aligned candles
- Recent-candle weighting
- Confidence = |value| invariant

All pass. Run with `npx tsx --test src/lib/pressure-from-candles.test.ts`.

### What the user sees

| Field | Tracked stock | On-demand stock |
|---|---|---|
| Zone | Real (from cached S/R) | Real (fetched per request) |
| Momentum | Real (3 × 5-min from candle tracker) | Real (3 × 5-min from Kite API) |
| Pressure | Real (tick-level) | **Approximate** (candle-level) |
| Volatility | Real (intraday high/low) | Real (daily high/low) |
| Outlook | Full decision table | Full decision table |
| Confidence | Real | Real (no longer capped at 0.5) |

On-demand stocks can now land HIGH confidence and qualify for Top Opportunities. The `dataSource` field on the snapshot response still returns `"on-demand"` vs `"live"` so the UI can display a subtle badge if needed.

---

## Stock detail page

The detail page is structured as a top-to-bottom decision narrative: hero → plain-language explanation → non-directive framing → supporting data grid → chart. The eye flows from "what is happening" to "how to think about it" before any raw numbers.

```
[ Back to scanner button + AddToWatchZone ]

┌─ HERO HEADER ─────────────────────────────────────────┐
│ 📈 RELIANCE                            ₹2458.30 ▲ 0.42%│
│    Near Resistance · Live ●                            │
│  ┌─ Outlook banner ─────────────────────────────────┐ │
│  │ 🔥 Breakout Likely                                │ │
│  │    Price could break above ₹2465 ...              │ │
│  └──────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘

┌─ 💡 What this means (NEW, full width) ────────────────┐
│ Plain-language conversational explanation of the      │
│ current state — derived from zone × momentum.         │
└──────────────────────────────────────────────────────┘

┌─ 🧭 Suggested Approach (NEW, full width) ─────────────┐
│ Non-directive framing: what to LOOK FOR, never what   │
│ to do. Derived from outlook.                          │
└──────────────────────────────────────────────────────┘

┌─ 4-section grid (supporting data) ────────────────────┐
│ 1. Context Summary │ 2. Momentum Explanation          │
│ 3. Possible Scenario│ 4. Risk                         │
└──────────────────────────────────────────────────────┘

[ Chart with timeframe selector, 320px tall, supportive not dominant ]
```

The chart is kept (it's still useful raw context). The `srLevels` from the snapshot endpoint are passed to it as `supportLevel` / `resistanceLevel` props. **Chart height is intentionally 320px** — the chart is supporting data, not the centerpiece. The two narrative sections above the grid are where the user's attention should land first.

### "What this means" — plain language

Conversational text derived from `zone × momentum`. Examples:

| Zone + momentum | Text |
|---|---|
| `NEAR_SUPPORT` + upward momentum | *"Price is sitting near a support level and showing upward momentum. Buyers are defending the level, which often leads to a short-term bounce. The stronger the buying pressure, the cleaner the move."* |
| `NEAR_RESISTANCE` + downward momentum | *"Price ran up into resistance and is now showing downward momentum. Sellers are stepping in. A short-term pullback from this level is the more probable scenario."* |
| `MID_RANGE` + flat momentum | *"Price is mid-range with no clear momentum. There is no actionable setup right now — better to wait for price to reach a level or for the move to pick up."* |

Implemented as the `whatThisMeans(intel)` helper inside `stock-detail.tsx`.

### "Suggested Approach" — non-directive framing

Outlook → look-for-this guidance. **Never says "buy" or "sell".**

| Outlook | Suggested Approach |
|---|---|
| `BREAKOUT_LIKELY` | *"Look for upward continuation setups above the level. Avoid short positions in this zone while buying pressure holds."* |
| `BOUNCE_EXPECTED` | *"Look for upward setups while the level holds. Avoid shorting into a defended support."* |
| `REJECTION_POSSIBLE` | *"Look for downside continuation. Avoid long positions while sellers are pressing this level."* |
| `BREAKDOWN_RISK` | *"Look for downside setups below the level. Avoid longs until buyers reclaim the support."* |
| `NO_CLEAR_EDGE` | *"No clear edge — better to wait for a cleaner setup before committing in either direction."* |

Implemented as the `suggestedApproach(intel)` helper inside `stock-detail.tsx`.

---

## Index Options module

> Extends the platform to surface a CALL / PUT preference for the 3 main indices — **without** turning into a signal/trade app. Reuses existing index intelligence, adds zero backend.

### Philosophy

Options have **no independent intelligence**. Every option insight is derived 1:1 from the underlying index's existing `IntelligenceSnapshot`. There is no new engine, no new market data, no new server endpoint, no greeks, no IV, no OI. We only add a thin presentation layer that maps the index's `outlook` to a CALL / PUT / NEUTRAL bias.

### Scope (Phase 1)

Supported indices only:

| Display | Symbol (in `stockMap`) | Strike spacing |
|---|---|---|
| NIFTY | `NIFTY 50` | 50 |
| BANKNIFTY | `NIFTY BANK` | 100 |
| SENSEX | `SENSEX` | 100 |

Individual stock options are explicitly **not** supported in this phase.

### Outlook → Option Bias mapping

Pure 1:1 mapping (no new logic):

```
outlook              →  optionBias
─────────────────────────────────
BREAKOUT_LIKELY      →  CALL
BOUNCE_EXPECTED      →  CALL
BREAKDOWN_RISK       →  PUT
REJECTION_POSSIBLE   →  PUT
NO_CLEAR_EDGE        →  NEUTRAL
```

The `reasoning` string is also derived from `outlook`:

```ts
BREAKOUT_LIKELY    → "Upward momentum near resistance — CALL side has the cleaner edge."
BOUNCE_EXPECTED    → "Buyers defending support — CALL side favorable while the level holds."
BREAKDOWN_RISK     → "Sellers pressing support — PUT side has the cleaner edge."
REJECTION_POSSIBLE → "Sellers stepping in at resistance — PUT side favorable while the level holds."
NO_CLEAR_EDGE      → "No clear directional edge right now — avoid directional bets."
```

### Strikes

Three strikes around the current price are computed mathematically — we do **not** fetch any chain data:

```ts
const atm = Math.round(price / spacing) * spacing;
strikes = [
  { price: atm - spacing, side: "PE", isAtm: false },  // OTM put convention
  { price: atm,           side: atm >= price ? "CE" : "PE", isAtm: true },
  { price: atm + spacing, side: "CE", isAtm: false },  // OTM call convention
];
```

Strike "side" labels follow convention only: lower strike → PE, higher strike → CE. They are display-only labels and do **not** imply an entry recommendation. Chips matching the active bias are highlighted (CE chips when bias = CALL; PE chips when bias = PUT).

### Dashboard toggle

A pill toggle `[Stocks | Options]` sits below the market context banner. The toggle:

- Default mode is `stocks` — existing stocks grid renders unchanged
- `options` mode hides the stocks grid and renders 3 OptionCards (NIFTY / BANKNIFTY / SENSEX) in a 3-column grid
- The **Market Indices row stays visible in both modes** (it's the live pulse for both)

### Option card layout

```
┌──────────────────────────────────────────────┐
│  📈 NIFTY                  22,012.50  ▲ 0.42% │  ← header (icon + name + price)
│     Index Options                              │
├──────────────────────────────────────────────┤
│  ┌─ Index outlook ─────────────────────────┐ │  ← secondary outlook context
│  │ 🔥 Breakout Likely                       │ │
│  └──────────────────────────────────────────┘ │
├──────────────────────────────────────────────┤
│  ┌─ Option Insight ─────────────────────────┐ │  ← PRIMARY hero
│  │ 📞 CALL side stronger                     │ │
│  │    Upward momentum near resistance —      │ │
│  │    CALL side has the cleaner edge.        │ │
│  └──────────────────────────────────────────┘ │
├──────────────────────────────────────────────┤
│  Strikes near the money                       │
│  [21950 PE]  [22000 CE ATM]  [22050 CE]      │  ← matching-side chips highlighted
├──────────────────────────────────────────────┤
│  Confidence  ████████░░  HIGH · 78%          │
└──────────────────────────────────────────────┘
```

Bias icons:
- CALL → `PhoneCall` icon, soft emerald gradient
- PUT → `PhoneOff` icon, soft rose gradient
- NEUTRAL → `Pause` icon, zinc

### Language rules (options)

| Avoid | Use |
|---|---|
| Buy CE | CALL side stronger |
| Buy PE | PUT side stronger |
| Sell CE / PE | (never) |
| Trade now / Entry / Exit | (never) |
| Strike X is best | (never) |

The card never says what to buy. It only says which side has the cleaner edge and why, then shows the nearest strikes for reference.

### Watch zone integration

If a user bookmarks an option:

- POST `/api/watch-zone` body: `{ symbol: "NIFTY 50", addedPrice, signalAction: "OPTION", signalType: "OPTION" }`
- Stored in the existing `watch_zone` table with `signalType = "OPTION"` (no schema migration — we reuse the inert column)
- The watch-zone panel detects `signalType === "OPTION"` and renders the item with:
  - A `PhoneCall` icon + `OPT` badge instead of zone label
  - The CALL/PUT bias pill instead of the outlook pill
  - Routes to `/` (the dashboard) on click instead of `/stock/[symbol]` (since options don't have a stock detail page)

### What is NOT included (deliberate)

- Greeks (Delta / Gamma / Theta / Vega)
- Implied Volatility (IV)
- Open Interest (OI)
- Full option chain (only ATM ± 1 strike)
- Multi-leg strategies (straddles, spreads, etc.)
- Premium / LTP for individual contracts
- Expiry selection

These are intentionally out of scope. The module is a directional **insight** layer, not a trading terminal.

### Data flow

```
1. User clicks [Options] toggle
2. Dashboard reads stockMap.get("NIFTY 50"), .get("NIFTY BANK"), .get("SENSEX")
3. For each index, OptionCard calls toOptionInsight(intel) → { bias, reasoning }
4. OptionCard calls getATMStrikes(intel.price, spacing) → 3 strikes
5. Card renders — no API call, no backend interaction
6. WS continues streaming updates → cards re-render automatically
```

Identical refresh cadence as the stocks view. No new endpoints, no new state.

---

## File map

### Backend (`apps/server/src/`)

| File | Purpose |
|---|---|
| `lib/intelligence-transformer.ts` | **NEW** — `toIntelligence()` + `buildMarketContext()` pure functions |
| `lib/intelligence-transformer.test.ts` | **NEW** — 40 unit tests covering zone, momentum, pressure, volatility, direction-aware confidence (aligned, wrong-direction, minimum alignment cap, MID_RANGE), outlook truth table, bias, market context |
| `lib/pressure-from-candles.ts` | **NEW** — `pressureFromCandles()` pure function. Approximates pressure from recent minute candles using the same scoring formula as the live engine. Used by the on-demand snapshot endpoint for untracked stocks. |
| `lib/pressure-from-candles.test.ts` | **NEW** — 9 unit tests covering guard clauses, strong BUY/SELL, dead zone, mixed direction, consistency boost, recent-candle weighting |
| `lib/types.ts` | Added intelligence types alongside the existing internal types |
| `services/broadcast.service.ts` | Calls `toIntelligence()` inline per dirty symbol; emits `IntelligenceWsMessage` |
| `ws/ws-server.ts` | `buildSnapshot()` returns `IntelligenceSnapshot[]`; initial connection payload uses the new shape |
| `routes/stocks.route.ts` | `/api/stocks` and `/api/stocks/:symbol/snapshot` return intelligence shape. On-demand snapshot now fetches daily + 5-min candles in parallel and uses `pressureFromCandles` to approximate pressure for untracked stocks. |
| `routes/watch-zone.route.ts` | Validation relaxed (no longer requires `BUY`/`SELL`) — schema unchanged |

**Untouched (still running internally):**

- `lib/signal-engine.ts`, `lib/score-engine.ts`, `services/signal-worker.service.ts`
- `services/pressure.service.ts`, `lib/momentum-engine.ts`, `lib/pattern-engine.ts`
- `services/levels.service.ts`, `services/intraday-levels.service.ts`
- `services/signal-accuracy.service.ts`, `db/schema/signal-accuracy.ts`
- `routes/admin.route.ts` (admin dashboard still shows 1–10 score)

### Frontend (`apps/web/src/`)

| File | Purpose |
|---|---|
| `lib/types.ts` | Replaced all `Signal*` types with intelligence types |
| `lib/option-insight.ts` | **NEW** — pure functions: `toOptionInsight()`, `getATMStrikes()`, `STRIKE_SPACING`, `SUPPORTED_OPTION_INDICES` |
| `context/market-data-context.tsx` | `stockMap<IntelligenceSnapshot>` + `marketContext` state |
| `components/intelligence-card.tsx` | **NEW** — simplified 4-element card (header + zone label + outlook hero + confidence bar). Has `highlight?` prop for Top Opportunities ring. LOW-confidence cards dim to opacity-70. |
| `components/index-card.tsx` | **NEW** — gradient hero card per index (NIFTY 50 / NIFTY BANK / SENSEX), with icon, big price, change chip. Wrapped in `<Link>` to `/stock/[symbol]`. |
| `components/market-context-banner.tsx` | **NEW** — top banner with market condition + index pills (icons added) |
| `components/option-card.tsx` | **NEW** — index option card: header, secondary outlook, **Option Insight hero**, strike chips, confidence bar |
| `components/dashboard.tsx` | Rewritten — banner + indices row + `[Stocks \| Options]` toggle + **Top Opportunities lane** (top 5 by confidence, floor 0.6, excludes `NO_CLEAR_EDGE`) + main "Opportunities" grid (default filter excludes `NO_CLEAR_EDGE`, excludes top symbols) |
| `components/ui/select.tsx` | **NEW** — styled Select component built on `@base-ui/react/select` (Trigger / Content / Item) with light + dark variants. Drop-in replacement for the native `<select>` used by the Opportunities filter dropdown. |
| `components/stock-detail.tsx` | Rewritten — hero header + **What this means** (plain language) + **Suggested Approach** (non-directive) + 4-section grid + 320px chart |
| `components/watch-zone.tsx` | Rewritten — reads live intelligence from `stockMap`; renders `signalType === "OPTION"` items as option cards (OPT badge + CALL/PUT bias) |
| `components/candlestick-chart.tsx` | Minor — exported `ChartTick` type so chart no longer depends on `StockData.volume` |

**Deleted (orphaned by the rewrite):**

`scanner-table.tsx`, `scanner-row.tsx`, `sr-cards.tsx`, `top-signals.tsx`, `top-opportunities.tsx`, `watchlist-cards.tsx`, `stock-table.tsx`, `stock-row.tsx`, `filter-bar.tsx`, `market-overview.tsx`, `scanner-dashboard.tsx`.

**Untouched:**

`global-nav.tsx` (market phase badge + search), `app-shell.tsx`, `header.tsx`, `admin-dashboard.tsx`, `docs-viewer.tsx`, `ui/*`.

---

## Watch zone behaviour

- The `watch_zone` table still has `signalAction` / `signalType` columns — **mostly inert**, kept so we don't need a migration. The columns are now used as a tag for option bookmarks (see below).
- POST `/api/watch-zone` accepts any `signalAction` value (default `"WATCH"` for stocks, `"OPTION"` for option bookmarks).
- The watch-zone panel reads the live `IntelligenceSnapshot` from the `stockMap` keyed by symbol. It renders the current `zone`, `outlook`, `confidence`, and `bias` — never the stored snapshot.
- The "added at" price stays visible in a small footer so users remember their entry.

### Option bookmarks

- POST body for an option bookmark: `{ symbol: "NIFTY 50", addedPrice, signalAction: "OPTION", signalType: "OPTION" }`
- The frontend detects `item.signalType === "OPTION"` and renders an **option variant card**:
  - Lead icon: `PhoneCall` (instead of nothing)
  - `OPT` badge in the header
  - CALL / PUT / NEUTRAL bias pill (from `toOptionInsight()`) instead of the stock outlook pill
  - Outlook label still shown as a one-liner
  - Click navigates to `/` (dashboard) instead of `/stock/[symbol]` since options don't have a detail page
- Stocks and options share the same panel and the same 10-item cap.

---

## Language rules

| Avoid | Use |
|---|---|
| BUY NOW | Bullish setup forming |
| SELL NOW | Reversal risk |
| STRONG BUY SIGNAL | Breakout potential |
| Score 9/10 — TRADE | Confidence: HIGH |
| AVOID | No clear edge |
| Enter a long here | Look for upward continuation setups |
| Take profits | (never) |
| Stop loss at X | (never) |

The user should feel *"I understand what is happening in the market"*, not *"I am following a signal"*.

The "Suggested Approach" section on the detail page is the strictest instance of this rule — it always frames things as *what to look for*, never *what to do*.

---

## What the admin dashboard still shows

The internal `/admin` route stays on the old data:

- 1–10 score per signal (from `score-engine.ts`)
- Win rate by signal type (BREAKOUT, BREAKDOWN, BOUNCE, REJECTION, CONTINUATION)
- Recent signals with entry / target / SL / hit time / result
- Signals are still recorded only when `score >= 9 + type exists + CONFIRMED + NORMAL phase + price ≥ ₹50`

This is the regression check: if any of the underlying engines drift, the admin dashboard's accuracy numbers will tell us. Users never see this page (admin role only).

---

## Verification

| Check | Result |
|---|---|
| `apps/server` — `tsc --noEmit` | exit 0 |
| `apps/web` — `tsc --noEmit` | exit 0 |
| `apps/web` — `next build` | 9/9 routes generate |
| Intelligence transformer unit tests | 37/37 passing |
| Pressure-from-candles unit tests | 9/9 passing |
| Grep `signal\.action\|signal\.type\|signal\.score\|scoreBreakdown` in `apps/web/src` | 0 matches |
| Grep `BUY NOW\|SELL NOW\|STRONG BUY SIGNAL\|Buy CE\|Buy PE` in `apps/web/src` | 0 matches |
| `signal-engine.ts`, `score-engine.ts`, `signal-worker.service.ts` | unchanged (verified via `git status`) |

Run tests locally:

```bash
cd apps/server
npx tsx --test src/lib/intelligence-transformer.test.ts
npx tsx --test src/lib/pressure-from-candles.test.ts
```

Manual sanity check for the options module:

1. Open `localhost:3000` in the browser
2. Click the `[Options]` toggle below the market banner
3. Confirm 3 OptionCards render: NIFTY / BANKNIFTY / SENSEX
4. Each card should show: index price, secondary outlook badge, **Option Insight hero** with PhoneCall/PhoneOff/Pause icon, 3 strike chips, confidence bar
5. The strike chips matching the active bias should be highlighted (CE chips when CALL, PE when PUT)
6. Bookmark NIFTY in options mode → reopen Watch Zone → it should render with an OPT badge and the CALL/PUT bias pill (not the stock zone label)

Manual sanity check for the decision-focused UX:

1. Reload `localhost:3000` in stocks mode
2. Confirm a "Top Opportunities" lane renders above the main "Opportunities" grid (only when at least one stock has confidence ≥ 0.6 AND a directional outlook — the section hides entirely otherwise)
3. Top Opportunity cards have a colored ring (emerald for bullish outlooks, rose for bearish)
4. Cards are simplified: header + outlook hero + confidence bar only — **no metric tiles, no bias footer**
5. LOW-confidence cards in the main grid are visibly dimmed (~70% opacity)
6. The 5 Top Opportunity stocks do **not** appear again in the main grid below
7. **The default "Actionable setups" filter shows ZERO `NO_CLEAR_EDGE` cards.** Switch the dropdown to "All stocks" to see them reappear.
8. Click into any stock detail page — confirm 2 new full-width sections appear above the 4-section grid: "What this means" (amber) + "Suggested Approach" (cyan)
9. Confirm the chart is shorter (320px) and reads as supportive, not dominant

Manual sanity check for on-demand stocks:

1. Use the navbar search to look up any NSE symbol **not** in the 514 tracked list (e.g. a small-cap that isn't in NIFTY 500)
2. Click the result → stock detail page opens
3. Confirm the 4-section grid shows real values for **all three**:
   - **Momentum** — label + score reflects actual 5-min movement (no longer saturated at 1.00)
   - **Pressure** — label + score reflects actual direction (no longer NEUTRAL 0.00)
   - **Volatility** — already worked, should still work
4. Confirm "Confidence" can reach HIGH / ~0.8+ for trending on-demand stocks (was capped at ~0.5 before)
5. Server logs: check for 2 parallel Kite API calls (`day` + `5minute`) in the network tab / server console
6. Recovery: if Kite returns an error for the 5-min fetch, the daily fetch should still succeed and S/R + volatility should still render (degraded but not broken)

---

## Future work

### Intelligence layer

- **Watch zone column rename** — `signalAction` / `signalType` are now overloaded for option tagging. A `kind` column would be cleaner. Defer until the schema is touched for another reason.
- **Per-symbol levels endpoint** — currently the stock-detail page uses a chart-helper `levels` field on the snapshot response. A cleaner path is `GET /api/stocks/:symbol/levels`.
- **Outlook tuning** — the confidence threshold for `BREAKOUT_LIKELY` (HIGH) and `BREAKDOWN_RISK` (HIGH) is fixed. If real-world hit rate suggests it's too strict, lower to MEDIUM.
- ~~**Search-on-demand intelligence**~~ — ✅ **Done.** Untracked stocks now get real momentum (from 5-min intraday candles) and approximate pressure (from `pressureFromCandles` — see "On-demand stocks" section above). Volatility was already working.

### Options module (Phase 2 — explicitly deferred)

- **Greeks** (Delta / Gamma / Theta / Vega) — would require an option pricing model + IV input
- **Implied Volatility (IV)** — needs option chain LTPs from Kite
- **Open Interest (OI)** — needs option chain depth
- **Full option chain** — multi-strike view with premiums, OI, IV
- **Multi-leg strategies** — straddles, strangles, spreads, iron condors
- **Stock options** — individual stock F&O (currently only 3 indices)
- **Expiry selection** — weekly vs monthly contracts
- **Premium / LTP** — actual contract prices

These require new market data subscriptions (option chain, not just spot ticks), a new pricing model, and a more complex UI. Out of scope for the directional-insight philosophy of Phase 1.
