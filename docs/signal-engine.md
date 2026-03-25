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
  │    ├─ Price crosses ABOVE resistance + 0.2% → CONFIRMED BUY BREAKOUT
  │    ├─ Price falls + SELL pressure + weakening momentum → CONFIRMED SELL REJECTION
  │    └─ Neither → WAIT ("waiting for breakout or rejection")
  │
  └─ At Support:
       ├─ Price drops BELOW support - 0.2% → CONFIRMED SELL BREAKDOWN
       ├─ Price rises + BUY pressure + UP momentum → CONFIRMED BUY BOUNCE
       └─ Neither → WAIT ("waiting for bounce or breakdown")
```

#### Rule 1: BREAKOUT (BUY) — Confirmed

All conditions must be true:
- Price is **above** resistance + 0.2% buffer (confirmed break)
- Pressure is `STRONG_BUY`
- Momentum is `STRONG_UP`

The 0.2% buffer prevents false triggers from minor wick touches. Price must decisively cross resistance.

#### Rule 2: REJECTION (SELL) — Confirmed

All conditions must be true:
- Price is **below** resistance (falling back)
- Pressure is `SELL` or `STRONG_SELL`
- Momentum is `DOWN`/`STRONG_DOWN` **OR** momentum is `UP`/`STRONG_UP` with `DECREASING` acceleration (weakening)

Catches both classic rejections (momentum already down) and early rejections (momentum fading at resistance).

#### Rule 3: BOUNCE (BUY) — Confirmed

All conditions must be true:
- Price is **above** support + 0.2% buffer (confirmed hold)
- Pressure is `BUY` or `STRONG_BUY`
- Momentum is `UP` or `STRONG_UP`

Price must have risen away from support — not just sitting on it.

#### Rule 4: BREAKDOWN (SELL) — Confirmed

All conditions must be true:
- Price is **below** support - 0.2% buffer (confirmed break)
- Pressure is `STRONG_SELL`
- Momentum is `STRONG_DOWN`

#### Default: WAIT

At any S/R level without confirmation → WAIT with the reason "waiting for breakout or rejection" / "waiting for bounce or breakdown".

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
| **BOUNCE** | Stock is near support with buy-side pressure and upward momentum. Classic support hold. | HIGH = confirming pattern (e.g., HAMMER), MEDIUM = no pattern, LOW = conflicting pattern |
| **BREAKOUT** | Stock is near resistance with STRONG_BUY pressure, STRONG_UP momentum, and accelerating. All engines aligned for a resistance break. | HIGH = pattern confirms, MEDIUM = no pattern but all other conditions max-strength |

### SELL Signals

| Type | What's Happening | Confidence Meaning |
|------|-----------------|-------------------|
| **REJECTION** | Stock is near resistance with sell-side pressure and downward momentum. Classic resistance rejection. | HIGH = confirming pattern (e.g., SHOOTING_STAR), MEDIUM = no pattern, LOW = conflicting pattern |
| **BREAKDOWN** | Stock is near support with STRONG_SELL pressure, STRONG_DOWN momentum, and accelerating downward. All engines aligned for a support break. | HIGH = pattern confirms, MEDIUM = no pattern but all other conditions max-strength |

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
| DECREASING for BREAKDOWN | `acc = r1 - r2`; strengthening downtrend produces negative acc = DECREASING |
| WAIT signals filtered from payload | Most stocks are WAIT; sending them wastes bandwidth |
| Pattern-based confidence | Candlestick patterns are independent confirmation; their presence/absence modulates conviction |
| Reasons array | Makes the engine's logic transparent; useful for UI display and debugging |
| SignalBadge rendered first | It's the highest-level synthesis — the "answer" that other badges explain |
