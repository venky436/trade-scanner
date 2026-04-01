# Signal Engine

## What It Does

The Signal Engine synthesizes outputs from all four independent engines — S/R levels, pressure, momentum, and pattern — into a **single actionable decision**: BUY, SELL, or WAIT. It answers the question every trader asks: "Should I act on this stock right now?"

Each signal comes with a **type** (BOUNCE, REJECTION, BREAKOUT, BREAKDOWN), a **confidence** level (LOW, MEDIUM, HIGH), and a list of **reasons** explaining why the signal fired. The engine is a pure function (`getSignal(input)`) with no state, no async, and no external dependencies.

---

## Why We Built It

The system already has four engines running in parallel:

| Engine | Question It Answers |
|--------|-------------------|
| S/R Levels | Where are the key price levels? |
| Pressure | Are buyers or sellers in control? |
| Momentum | Which direction is price moving, and is it accelerating? |
| Pattern | Are there candlestick reversal patterns? |

Each engine is valuable on its own, but a trader looking at four independent badges on a stock card still has to mentally combine them: "It's near support, pressure is BUY, momentum is UP, and there's a HAMMER pattern — so... buy?" The Signal Engine does that synthesis automatically.

### Why It's a Pure Function

The signal depends only on the current state of the other engines. There's nothing to accumulate over time — no history, no rolling windows. A pure function is simpler, testable, and avoids another stateful service. It follows the same pattern as `momentum-engine.ts`.

### Why It Sits in the Broadcast Loop

The signal must reflect the **current** price distance to S/R levels, not the distance from the last HTTP fetch. Placing it in the broadcast `tick()` loop means every WebSocket update recomputes the signal with the latest price, ensuring traders see real-time decisions.

---

## Architecture

```
Broadcast tick() loop
    │
    │  For each dirty symbol:
    │
    ├──► getPressure(symbol)    → pressure
    ├──► getMomentum(symbol)    → momentum
    ├──► getPattern(symbol)     → pattern
    ├──► Compute fresh distancePercent from current price + cached S/R levels
    │
    └──► getSignal({ price, sr, pressure, momentum, pattern })
              │
              ▼
         SignalResult { action, type, confidence, reasons }
              │
              ▼ (WAIT signals filtered out — not sent over WS)
         StockSnapshot.signal
              │
              ▼
         WebSocket → Frontend → SignalBadge on SR Cards
```

No new endpoints. No new services. No new config. The signal engine consumes data already available in the broadcast loop.

### Files

| File | Role |
|------|------|
| `apps/server/src/lib/signal-engine.ts` | Core engine — pure `getSignal()` function |
| `apps/server/src/lib/types.ts` | `SignalResult`, `SignalAction`, `SignalType`, `SignalConfidence` types |
| `apps/server/src/services/broadcast.service.ts` | Calls `getSignal()` in `tick()`, filters WAIT, attaches to snapshot |
| `apps/web/src/lib/types.ts` | Frontend mirror of signal types |
| `apps/web/src/components/sr-cards.tsx` | `SignalBadge` component displayed first in the badge row |

---

## How It Works — Step by Step

### 1. Input Assembly

The broadcast loop assembles the input from existing data:

```typescript
interface SignalInput {
  price: number;
  sr: {
    supportZone: { level: number; distancePercent: number } | null;
    resistanceZone: { level: number; distancePercent: number } | null;
  };
  pressure: PressureResult | null;
  momentum: MomentumResult | null;
  pattern: PatternSignal | null;
  recentCandles?: Candle[];  // last 3 session candles (for bounce detection)
}
```

The `distancePercent` is computed **fresh** from the current tick price, not reused from the cached S/R result. This ensures the signal reacts to price movement between S/R HTTP refreshes:

```
distancePercent = |currentPrice - level| / currentPrice * 100
```

### 2. Gate: Pressure Required

If pressure data is `null` (engine hasn't warmed up yet), return WAIT immediately. Pressure is the mandatory foundation — without knowing buyer/seller balance, no directional signal is reliable.

### 3. Gate: Must Be Near a Level

If the stock is more than **1%** away from both support and resistance, return WAIT. Signals only matter near decision points. This 1% threshold matches the `NEAR_THRESHOLD` used by the reaction computation in the broadcast service.

### 4. Rule Evaluation (Priority Order)

Rules are checked in strict priority order. The **first** matching rule wins:

### Core Principle: Wait at S/R, Act on Confirmation

The signal engine **never decides at the level**. When price is near support or resistance, the default is always WAIT. A signal only fires after the price **confirms** a breakout, rejection, bounce, or breakdown.

```
Price approaching S/R → WAIT (always)
  │
  ├─ At Resistance:
  │    ├─ Price crosses ABOVE resistance + 0.2% + BUY pressure + UP momentum
  │    │    + INCREASING acceleration + quality > 0.5 → CONFIRMED BUY BREAKOUT
  │    ├─ 6-gate confirmation: candle closed below resistance + rejection structure
  │    │    + bearish candle flip + DECREASING accel + SELL pressure (conf≥50%)
  │    │    + NOT sustained uptrend → CONFIRMED SELL REJECTION
  │    └─ Neither → WAIT ("waiting for breakout or rejection")
  │
  └─ At Support:
       ├─ Price drops BELOW support - 0.2% + STRONG_SELL pressure + STRONG_DOWN momentum
       │    + DECREASING acceleration + |quality| > 0.5 → CONFIRMED SELL BREAKDOWN
       ├─ 6-gate confirmation: candle closed above support + bounce structure
       │    + bullish candle flip + INCREASING accel + BUY pressure (conf≥50%)
       │    + NOT sustained downtrend → CONFIRMED BUY BOUNCE
       └─ Neither → WAIT ("waiting for bounce or breakdown")
```

#### Rule 1: BREAKOUT (BUY) — Confirmed

All conditions must be true:
- Price is **above** resistance + 0.2% buffer (confirmed break)
- Pressure is `BUY` or `STRONG_BUY`
- Momentum is `UP` or `STRONG_UP`
- Momentum acceleration is `INCREASING` (move must be strengthening, not fading)
- Momentum quality > 0.5 (filters out weak/uncertain moves)

The 0.2% buffer prevents false triggers from minor wick touches. Price must decisively cross resistance. The acceleration and quality filters (added in the hybrid momentum upgrade) further reduce fake breakouts by ensuring the move has genuine strength behind it — a price crossing resistance while momentum is fading (DECREASING) or quality is low is likely a false break.

#### Rule 2: REJECTION (SELL) — Confirmed

Requires **6 confirmation gates** (all must pass). This is a candle-confirmed reversal — not just "price near resistance with sell pressure."

**Gate 1 — Candle closes below resistance:**
- Last completed candle's close < resistance level

**Gate 2 — Rejection candle structure:**
- Upper wick > 70% of candle body (price probed resistance but was pushed down; slightly relaxed from 100% to capture more valid setups)
- Close in lower 40% of candle range (sellers dominated)

**Gate 3 — Momentum reversal (strict):**
- Previous candle MUST be bullish (close > open)
- Current candle MUST be bearish (close < open)
- This requires an actual candle color flip — "slowing but still bullish" is NOT enough

**Gate 4 — Acceleration filter:**
- `accelerationRaw < -0.001` (momentum genuinely decelerating, not flat)

**Gate 5 — Participation filter:**
- Pressure is `SELL` or `STRONG_SELL`
- `pressure.confidence >= 0.5` (enough volume participation to trust the signal)

**Gate 6 — Micro trend filter:**
- If last 3 candles are ALL bullish (sustained uptrend) → BLOCK the signal
- Prevents selling into a strong uptrend that briefly touches resistance

This replaced the old logic (price < resistance + sell pressure + down/weakening momentum) which had ~5% accuracy due to triggering on any brief weakness near resistance.

#### Rule 3: BOUNCE (BUY) — Confirmed

Requires **6 confirmation gates** (all must pass). This is a candle-confirmed reversal — not just "price near support with buy pressure."

**Gate 1 — Candle closes above support:**
- Last completed candle's close > support level

**Gate 2 — Bounce candle structure:**
- Lower wick > 70% of candle body (price probed support but was pushed up; slightly relaxed from 100% to capture more valid setups)
- Close in upper 40% of candle range (buyers dominated)

**Gate 3 — Momentum shift (strict):**
- Previous candle MUST be bearish (close < open)
- Current candle MUST be bullish (close > open)
- This requires an actual candle color flip — "slowing but still bearish" is NOT enough

**Gate 4 — Acceleration filter:**
- `accelerationRaw > 0.001` (momentum genuinely accelerating upward)

**Gate 5 — Participation filter:**
- Pressure is `BUY` or `STRONG_BUY`
- `pressure.confidence >= 0.5` (enough volume participation to trust the signal)

**Gate 6 — Micro trend filter:**
- If last 3 candles are ALL bearish (sustained downtrend) → BLOCK the signal
- Prevents buying into a falling knife that briefly touches support

This replaced the old bounce logic (rejection candle + hold + UP momentum) which triggered too early without enough confirmation.

#### Rule 4: BREAKDOWN (SELL) — Confirmed

All conditions must be true:
- Price is **below** support - 0.2% buffer (confirmed break)
- Pressure is `STRONG_SELL`
- Momentum is `STRONG_DOWN`
- Momentum acceleration is `DECREASING` (selling must be strengthening — for downward moves, DECREASING acceleration means the negative velocity is growing)
- Momentum quality magnitude > 0.5 (filters out weak/uncertain moves; uses `Math.abs(quality)` since quality is negative for sell signals)

Like BREAKOUT, the acceleration and quality filters reduce false breakdowns by ensuring genuine selling strength behind the move.

#### Rule 5: CONTINUATION (BUY/SELL) — Indices Only

Applies ONLY to NIFTY 50, NIFTY BANK, SENSEX. Fires when S/R signal returns WAIT (price not near levels) but strong trend is detected.

**9 gates must ALL pass:**

1. **Index check** — symbol is NIFTY 50, NIFTY BANK, or SENSEX
2. **Distance safety** — price > 0.5% from both support AND resistance (blocks continuation near S/R)
3. **Trend mode** — at least 3 of last 5 candles aligned with direction AND last 2 candles in same direction
4. **Momentum direction** — UP/STRONG_UP (buy) or DOWN/STRONG_DOWN (sell)
5. **Acceleration confirming** — INCREASING (buy) or DECREASING (sell)
6. **Pressure aligned** — BUY/STRONG_BUY (buy) or SELL/STRONG_SELL (sell)
7. **Pressure confidence** — ≥ 0.5
8. **Momentum quality** — > 0.6 (buy) or |quality| > 0.6 (sell)
9. **Room to move** — BUY: distance to resistance > 0.8%; SELL: distance to support > 0.8% (ensures enough profit potential in signal direction)

**Dynamic score boost:**
- VERY STRONG (STRONG_UP/DOWN + STRONG_BUY/SELL + quality > 0.8) → raw + 1.5, capped at 9.5
- STRONG (all gates pass, quality > 0.6) → raw + 1.0, capped at 8.5
- Otherwise → no boost

**Accuracy:** Tracked separately — shows as its own row in admin dashboard (does not pollute S/R signal accuracy).

**Stocks:** Never receive CONTINUATION signals. Zero changes to stock flow.

#### Default: WAIT

At any S/R level without confirmation → WAIT with the reason "waiting for breakout or rejection" / "waiting for bounce or breakdown".

#### Post-Signal: Market Awareness Filter (Sector-Based)

After the signal engine returns a confirmed signal, a **market awareness layer** checks whether the signal aligns with the broader market trend. This uses sector-specific indices for better accuracy.

**Sector → Index Mapping:**
- Banking stocks (HDFCBANK, ICICIBANK, SBIN, etc.) → **NIFTY BANK**
- IT stocks (INFY, TCS, WIPRO, etc.) → **NIFTY IT**
- All others → **NIFTY 50** (fallback)

**Market Mode Detection (using sector index):**

| Mode | Conditions |
|------|-----------|
| **TREND_UP** | Index momentum STRONG_UP (or UP + STRONG_BUY pressure) + 2/3 candles bullish |
| **TREND_DOWN** | Index momentum STRONG_DOWN (or DOWN + STRONG_SELL pressure) + 2/3 candles bearish |
| **RANGE** | Everything else (FLAT/NEUTRAL/mixed candles) |

**Signal Filtering by Mode:**

| Signal | TREND_UP | TREND_DOWN | RANGE |
|--------|----------|------------|-------|
| BREAKOUT (BUY) | ALLOW | BLOCK | BLOCK |
| BREAKDOWN (SELL) | BLOCK | ALLOW | BLOCK |
| BOUNCE (BUY) | ALLOW | Quality > 0.7 | ALLOW |
| REJECTION (SELL) | Quality > 0.7 | ALLOW | ALLOW |

**Safety rules:**
- If sector index data is missing → skip filter entirely (don't assume RANGE)
- Market mode logged in signal reasons for debugging: `"Market: TREND_UP (NIFTY BANK)"`
- Does NOT modify existing signal engine — only controls output

### 5. Confidence Assignment

Confidence is determined by whether a candlestick pattern **confirms** the signal direction:

| Pattern State | Confidence |
|--------------|------------|
| Confirming pattern (BULLISH + BUY, or BEARISH + SELL) | **HIGH** |
| No pattern detected | **MEDIUM** |
| Conflicting pattern (BULLISH + SELL, or BEARISH + BUY) | **LOW** |

For BREAKOUT/BREAKDOWN signals, confidence follows the same logic. A confirming pattern adds conviction; a conflicting pattern is a warning flag.

### 6. Reasons Array

Each signal includes a human-readable list of reasons explaining what matched:

```json
[
  "Near support at 85200.00 (0.45%)",
  "STRONG_BUY pressure",
  "STRONG_UP momentum",
  "HAMMER pattern detected"
]
```

These are displayed in the UI or logged for debugging. They make the engine's decision transparent.

### 7. Output

```typescript
interface SignalResult {
  action: SignalAction;         // "BUY" | "SELL" | "WAIT"
  type?: SignalType;            // "BOUNCE" | "REJECTION" | "BREAKOUT" | "BREAKDOWN"
  confidence: SignalConfidence; // "LOW" | "MEDIUM" | "HIGH"
  reasons: string[];            // human-readable explanation
  score?: number;               // 1-10 raw signal strength
  finalScore?: number;          // phase-adjusted score (may differ during OPENING/STABILIZING)
  marketPhase?: MarketPhase;    // "OPENING" | "STABILIZING" | "NORMAL" | "CLOSED"
  warningMessage?: string;      // phase warning (e.g., "Market opening volatility — signals restricted")
  stage?: SignalStage;          // progressive pipeline stage
  scoreBreakdown?: { ... };     // per-engine scores (0-10)
}
```

> **Note:** `finalScore`, `marketPhase`, and `warningMessage` are set by the [Market Phase Control](./market-phase.md) system in `setCacheEntry()`, not by the signal engine itself. During the first 10 minutes of trading, `finalScore` may be lower than `score` and `action` may be overridden to WAIT.

> **Accuracy tracking:** Only signals from the CONFIRMED stage with a `type` (BREAKOUT/BOUNCE/REJECTION/BREAKDOWN) are tracked for accuracy. MOMENTUM and PRESSURE stage signals bypass the signal engine's S/R confirmation and are excluded from accuracy measurement. This ensures only confirmed breakouts/bounces/rejections/breakdowns — where price has actually crossed or bounced from S/R — are evaluated.

---

## Data Flow

### Broadcast Integration

The signal is computed inline in the broadcast `tick()` loop, after all other engines have provided their outputs:

1. Pressure, momentum, and pattern values are read from their respective engines (already happening).
2. Fresh `distancePercent` is computed from current price and cached S/R levels.
3. `getSignal()` is called with all inputs.
4. **WAIT signals are filtered out** — only BUY/SELL signals are included in the WebSocket payload. This reduces bandwidth since most stocks at any given moment won't have aligned conditions.

### WebSocket Payload

```json
{
  "type": "market_update",
  "data": [
    {
      "symbol": "MCX:GOLD25APRFUT",
      "price": 87250.00,
      "change": 0.35,
      "pressure": { "value": 0.72, "signal": "STRONG_BUY", "trend": "rising", "confidence": 0.72 },
      "momentum": { "value": 0.85, "signal": "STRONG_UP", "acceleration": "INCREASING" },
      "pattern": { "pattern": "HAMMER", "direction": "BULLISH", "strength": 1, "reason": "..." },
      "signal": {
        "action": "BUY",
        "type": "BOUNCE",
        "confidence": "HIGH",
        "reasons": [
          "Near support at 87100.00 (0.17%)",
          "STRONG_BUY pressure",
          "STRONG_UP momentum",
          "HAMMER pattern detected"
        ]
      }
    }
  ]
}
```

When a stock is WAIT (most of the time), the `signal` field is simply absent from the payload.

### Frontend Display

The `SignalBadge` renders as the **first** badge in the SR Card row, before reaction, pressure, pattern, and momentum badges. It's the highest-level synthesis, so it goes first.

| Signal Type | Badge Label | Color |
|-------------|------------|-------|
| BOUNCE | BOUNCE | green |
| BREAKOUT | BREAKOUT | green |
| REJECTION | REJECTION | red |
| BREAKDOWN | BREAKDOWN | red |
| WAIT | (hidden) | — |

Confidence affects the badge appearance:

| Confidence | Style |
|------------|-------|
| HIGH | Brighter color + subtle ring border |
| MEDIUM | Standard badge |
| LOW | Dimmed / muted |

---

## Signal Interpretation Guide

### BUY Signals

| Type | What's Happening | Confidence Meaning |
|------|-----------------|-------------------|
| **BOUNCE** | 6-gate confirmed reversal at support: candle closed above support with bounce structure (lower wick > 70% body, close in upper 40%), previous candle bearish → current candle bullish (strict flip), acceleration increasing, BUY pressure with ≥50% confidence, NOT in sustained downtrend. | HIGH = confirming pattern (e.g., HAMMER), MEDIUM = no pattern, LOW = conflicting pattern |
| **BREAKOUT** | Stock has crossed above resistance + 0.2% buffer with BUY/STRONG_BUY pressure, UP/STRONG_UP momentum, INCREASING acceleration, and quality > 0.5. All engines aligned for a strong resistance break. | HIGH = pattern confirms, MEDIUM = no pattern |

### SELL Signals

| Type | What's Happening | Confidence Meaning |
|------|-----------------|-------------------|
| **REJECTION** | 6-gate confirmed reversal at resistance: candle closed below resistance with rejection structure (upper wick > 70% body, close in lower 40%), previous candle bullish → current candle bearish (strict flip), acceleration decreasing, SELL pressure with ≥50% confidence, NOT in sustained uptrend. | HIGH = confirming pattern (e.g., SHOOTING_STAR), MEDIUM = no pattern, LOW = conflicting pattern |
| **BREAKDOWN** | Stock has crossed below support - 0.2% buffer with STRONG_SELL pressure, STRONG_DOWN momentum, DECREASING acceleration (selling strengthening), and |quality| > 0.5. All engines aligned for a strong support break. | HIGH = pattern confirms, MEDIUM = no pattern but all other conditions max-strength |

### WAIT (Not Displayed)

Most stocks will be WAIT most of the time. This means one or more conditions aren't met:
- Not near any S/R level
- Pressure and momentum disagree (e.g., BUY pressure but DOWN momentum)
- Pressure is NEUTRAL
- Engines haven't warmed up yet

WAIT is not a problem — it means "conditions aren't clear enough for a directional call."

---

## Warm-Up Period

The Signal Engine itself has no warm-up, but it depends on engines that do:

| Dependency | Warm-Up |
|-----------|---------|
| S/R Levels | Available after first HTTP fetch (~startup) |
| Pressure | ~3 minutes (needs 3 candle closes) |
| Momentum | ~15 minutes (needs 3 × 5-min candle closes) |
| Pattern | ~15 minutes (needs 3 × 5-min candle closes) |

In practice, the earliest a signal can fire is after the pressure engine warms up (~3 minutes), since pressure is a mandatory gate. BREAKOUT and BREAKDOWN signals require momentum, so they won't fire until ~15 minutes in.

---

## Design Decisions Summary

| Decision | Rationale |
|----------|-----------|
| Pure function, not a service | No state needed — combines current outputs of other engines |
| Placed in broadcast loop | Must use fresh price for distancePercent; all inputs already available there |
| Pressure as mandatory gate | Without buyer/seller balance, directional signals are unreliable |
| 1% near threshold | Matches existing reaction threshold; signals only matter near decision points |
| Strict priority order | BREAKOUT/BREAKDOWN checked first because they require the strongest alignment |
| Breakout requires INCREASING acceleration + quality > 0.5 | Reduces fake breakouts — price crossing resistance while momentum fades is likely a false break |
| Breakdown requires DECREASING acceleration + |quality| > 0.5 | Mirrors breakout filter for sell-side — strengthening downtrend produces DECREASING acceleration; filters weak breakdowns |
| REJECTION/BOUNCE use 6-gate candle confirmation | Replaced weak conditions (price + pressure + momentum direction) with strict candle-confirmed reversal: structure + color flip + acceleration + participation + trend filter. Reduced rejection signals from ~44 (5% accuracy) to only confirmed reversals |
| Strict candle flip required for reversal signals | "Slowing but still bullish" is NOT a reversal — require actual bearish candle for REJECTION, actual bullish candle for BOUNCE. Prevents premature signals |
| Wick threshold at 70% of body (not 100%) | Slightly relaxed to capture valid setups where wick is prominent but not extreme |
| Micro trend filter blocks reversal into strong trends | 3 consecutive same-direction candles = sustained trend → block the reversal signal. Prevents selling into uptrends / buying into downtrends |
| Pressure confidence ≥ 50% for reversals | Volume participation proxy — ensures enough market activity to trust the reversal signal |
| WAIT signals filtered from payload | Most stocks are WAIT; sending them wastes bandwidth |
| Pattern-based confidence | Candlestick patterns are independent confirmation; their presence/absence modulates conviction |
| Reasons array | Makes the engine's logic transparent; useful for UI display and debugging |
| SignalBadge rendered first | It's the highest-level synthesis — the "answer" that other badges explain |
