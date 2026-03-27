# Score Engine

## Overview

The Score Engine converts all engine outputs into a single **Signal Score (1-10)** that tells traders how strong a setup is. It combines Pressure, Momentum, S/R Proximity, Volatility, and Signal Confidence into one weighted score.

**File:** `apps/server/src/lib/score-engine.ts`
**Type:** Pure function — no state, no async

---

## Flow

```
Signal Worker computes signal for a stock
  │
  ▼
computeSignalScore({
  pressure,    ← from Pressure Engine
  momentum,    ← from Momentum Engine
  sr,          ← from S/R Engine (daily + intraday)
  signal,      ← from Signal Engine (BUY/SELL/WAIT)
  price,       ← current price
  open, high, low  ← today's OHLC
})
  │
  ▼
┌─────────────────────────────────────────────┐
│ STEP 1: Score each component (0 to 1)       │
│                                             │
│  pressureScore   = map pressure signal      │
│  momentumScore   = map momentum signal      │
│  srScore         = distance to nearest S/R  │
│  volatilityScore = today's price range      │
│  signalScore     = signal action+confidence │
│                                             │
│ STEP 2: Weighted average                    │
│                                             │
│  raw = pressure  × 0.30                     │
│      + momentum  × 0.25                     │
│      + sr        × 0.25                     │
│      + volatility × 0.10                    │
│      + signal    × 0.10                     │
│                                             │
│ STEP 3: Scale to 1-10                       │
│                                             │
│  score = round(raw × 10)                    │
│  clamp between 1 and 10                     │
│                                             │
└─────────────────────────────────────────────┘
  │
  ▼
Output: { score: 8, breakdown: { pressure: 0.75, momentum: 1.0, sr: 1.0, ... } }
```

---

## Component Scoring

### 1. Pressure Score (30% weight) — Direction-Aware

Scoring is **inverted for SELL signals** — selling strength scores high, not low.

```
For BUY signals:                For SELL signals:
  STRONG_BUY  → 1.00             STRONG_SELL → 1.00
  BUY         → 0.75             SELL        → 0.75
  NEUTRAL     → 0.50             NEUTRAL     → 0.50
  SELL        → 0.25             BUY         → 0.25
  STRONG_SELL → 0.00             STRONG_BUY  → 0.00

No pressure data → 0.00
```

Example (BUY signal):
```
Pressure = STRONG_BUY → 1.00 × 0.30 = 0.30
```

Example (SELL signal):
```
Pressure = STRONG_SELL → 1.00 × 0.30 = 0.30  (was 0.00 before fix!)
Pressure = SELL        → 0.75 × 0.30 = 0.225
```

---

### 2. Momentum Score (25% weight) — Direction-Aware

Same inversion — downward momentum scores high for SELL signals.

```
For BUY signals:                For SELL signals:
  STRONG_UP   → 1.00             STRONG_DOWN → 1.00
  UP          → 0.75             DOWN        → 0.75
  FLAT        → 0.50             FLAT        → 0.50
  DOWN        → 0.25             UP          → 0.25
  STRONG_DOWN → 0.00             STRONG_UP   → 0.00

Acceleration bonus:
  BUY signals:  INCREASING → +0.10
  SELL signals: DECREASING → +0.10

No momentum data → 0.00
```

Example (BUY signal):
```
Momentum = UP, acceleration = INCREASING
momentumScore = 0.75 + 0.10 = 0.85
Contribution: 0.85 × 0.25 = 0.2125
```

Example (SELL signal):
```
Momentum = DOWN, acceleration = DECREASING
momentumScore = 0.75 + 0.10 = 0.85  (was 0.25 before fix!)
Contribution: 0.85 × 0.25 = 0.2125
```

---

### 3. S/R Proximity Score (25% weight)

How close is the current price to the nearest support or resistance level:

```
Distance from level:
  ≤ 0.5%  → 1.00  (very close — strong setup)
  ≤ 1.0%  → 0.80
  ≤ 2.0%  → 0.60
  ≤ 5.0%  → 0.30
  > 5.0%  → 0.10  (too far — weak setup)

Bonus: if touches >= 5 → +0.10 (level tested many times = stronger)

No S/R data → 0.00
```

**Important:** Distance is computed FRESH from the current price, not from cached data:
```
distance = |currentPrice - level| / currentPrice × 100
```

Example:
```
Price = ₹145.50, Support = ₹145.00
distance = |145.50 - 145.00| / 145.50 × 100 = 0.34%

0.34% ≤ 0.5% → srScore = 1.00
Support has 7 touches (≥ 5) → +0.10 → capped at 1.00

Contribution to final: 1.00 × 0.25 = 0.25
```

Both support and resistance are checked — the CLOSER one wins:
```
Support distance = 0.34% → score 1.00
Resistance distance = 3.2% → score 0.30
Best = max(1.00, 0.30) = 1.00
```

**Confirmed signal minimum:** When a signal has a type (BREAKOUT/BOUNCE/REJECTION/BREAKDOWN), the S/R score is at least 0.8. This prevents confirmed signals from being penalized for crossing the level — crossing IS the confirmation.

```
Approaching resistance (no type): distance 0.3% → score 1.0
After breakout (type=BREAKOUT):   distance 0.5% → score max(0.8, 1.0) = 1.0
After breakout moved further:     distance 2.0% → score max(0.8, 0.6) = 0.8 (minimum)
```

---

### 4. Volatility Score (10% weight)

How much is the stock moving today (intraday range):

```
range = (high - low) / price

range ≥ 3%  → 1.00  (very volatile — big moves)
range ≥ 2%  → 0.80
range ≥ 1%  → 0.60
range ≥ 0.5% → 0.40
range < 0.5% → 0.20  (barely moving)
```

Example:
```
Price = ₹145.50, High = ₹148.00, Low = ₹143.00
range = (148.00 - 143.00) / 145.50 = 3.44%

3.44% ≥ 3% → volatilityScore = 1.00
Contribution to final: 1.00 × 0.10 = 0.10
```

---

### 5. Signal Boost Score (10% weight)

Rewards confirmed signals with high confidence:

```
BUY or SELL + HIGH confidence   → 1.00
BUY or SELL + MEDIUM confidence → 0.70
BUY or SELL + LOW confidence    → 0.50
WAIT (any confidence)           → 0.00
```

Example:
```
Signal = BUY, Confidence = HIGH (pattern confirmed)
signalScore = 1.00
Contribution to final: 1.00 × 0.10 = 0.10
```

---

### Pattern (NOT in score)

Pattern is computed but excluded from the formula:
```
Pattern detection still runs → result stored in breakdown
But NOT multiplied by any weight → does not affect score
Shown as visual badge on UI only
```

---

## Full Calculation Examples

### Example 1: Strong Setup (Score 10)

```
TATASTEEL near support, strong buying

Pressure  = STRONG_BUY → 1.00 × 0.30 = 0.300
Momentum  = STRONG_UP  → 1.00 × 0.25 = 0.250
S/R       = 0.3% away  → 1.00 × 0.25 = 0.250
Volatility = 3.5% range → 1.00 × 0.10 = 0.100
Signal    = BUY HIGH   → 1.00 × 0.10 = 0.100
                                         ─────
                              raw = 1.000

score = round(1.000 × 10) = 10
→ 10/10 TRADE ✅
```

### Example 2: Moderate Setup (Score 7)

```
RELIANCE near resistance, mixed signals

Pressure  = BUY        → 0.75 × 0.30 = 0.225
Momentum  = UP         → 0.75 × 0.25 = 0.188
S/R       = 0.8% away  → 0.80 × 0.25 = 0.200
Volatility = 1.5% range → 0.60 × 0.10 = 0.060
Signal    = WAIT       → 0.00 × 0.10 = 0.000
                                         ─────
                              raw = 0.673

score = round(0.673 × 10) = 7
→ 7/10 WATCH ⚠️
```

### Example 3: Weak Setup (Score 3)

```
INFY barely moving, no direction

Pressure  = NEUTRAL    → 0.50 × 0.30 = 0.150
Momentum  = FLAT       → 0.50 × 0.25 = 0.125
S/R       = 4% away    → 0.30 × 0.25 = 0.075
Volatility = 0.4% range → 0.20 × 0.10 = 0.020
Signal    = WAIT       → 0.00 × 0.10 = 0.000
                                         ─────
                              raw = 0.370

score = round(0.370 × 10) = 4
→ 4/10 AVOID ❌
```

### Example 4: SELL Rejection Setup (Score 9)

```
RELIANCE rejected at resistance, strong selling

Pressure  = SELL (→ 0.75 for SELL) × 0.30 = 0.225
Momentum  = DOWN (→ 0.75 for SELL) × 0.25 = 0.188
S/R confirmed                      × 0.25 = 0.200 (min 0.80)
Volatility = 2.5% range → 0.80    × 0.10 = 0.080
Signal    = SELL MEDIUM → 0.70    × 0.10 = 0.070
                                            ─────
                              raw = 0.763

score = round(0.763 × 10) = 8
→ 8/10 TRADE ✅

With STRONG_SELL + STRONG_DOWN + HIGH confidence:
  0.30 + 0.25 + 0.20 + 0.10 + 0.10 = 0.95 → 10/10 ✅
```

### Example 5: Strong Momentum but No Pressure (Score 5)

```
Stock moving up fast but no volume confirmation

Pressure  = no data    → 0.00 × 0.30 = 0.000
Momentum  = STRONG_UP  → 1.00 × 0.25 = 0.250
S/R       = 0.2% away  → 1.00 × 0.25 = 0.250
Volatility = 2.5% range → 0.80 × 0.10 = 0.080
Signal    = WAIT       → 0.00 × 0.10 = 0.000
                                         ─────
                              raw = 0.580

score = round(0.580 × 10) = 6
→ 6/10 WATCH ⚠️

Note: Without pressure data, score can never reach 8+
because 30% of the weight is always 0.
This is intentional — pressure is the most important indicator.
```

---

## Score Interpretation

```
Score:  1   2   3   4   5   6   7   8   9   10
        ├───────────┼───────────┼───────────┤
         AVOID       WATCH       TRADE
         (skip)    (monitor)   (actionable)
```

| Score | Label | Meaning | UI Section |
|-------|-------|---------|------------|
| 9-10 | TRADE | Strong setup — act now | Best Setups |
| 7-8 | WATCH | Setup developing — monitor | Watchlist |
| 5-6 | WATCH | Weak setup — low confidence | Not shown |
| 1-4 | AVOID | No setup — skip | Not shown |

---

## Score Breakdown on UI

The stock detail page shows each component as a bar:

```
┌─────────────────────────────────┐
│ Score Breakdown                  │
│                                  │
│ 8/10  TRADE ✅                   │
│ ████████████████████░░░░░        │
│                                  │
│ Pressure    ████████░░  8/10 ✅  │
│ Momentum    ██████████  10/10 ✅ │
│ S/R         ██████████  10/10 ✅ │
│ Volatility  ██████░░░░  6/10    │
│                                  │
│ Pattern: Hammer (Bullish)        │
│                                  │
│ 👉 Weak Volatility reduces      │
│    confidence                    │
└─────────────────────────────────┘
```

Each bar shows 0-10 (the component score × 10 for display).

---

## Why These Weights?

```
Pressure (30%):  MOST important
  → Without knowing who's buying/selling, everything else is speculation.
  → A stock near support means nothing if sellers are still dominating.

Momentum (25%): Direction confirmation
  → Price must be moving in the signal direction.
  → Strong momentum = higher probability of continuation.

S/R (25%): Location context
  → Signals only matter at key levels.
  → Closer to S/R = higher score (better entry point).

Volatility (10%): Opportunity sizing
  → Stock must be moving enough for the target to be reachable.
  → Low volatility = target unlikely to be hit.

Signal (10%): Confidence boost
  → Confirmed signals (BUY/SELL with pattern) get a small bonus.
  → WAIT signals get zero — no boost for unconfirmed setups.
```

---

## What Happens After Score

```
Score computed
  │
  ▼
Market Phase adjusts score:
  OPENING (0-5 min):     score × 0.6
  STABILIZING (5-10 min): score × 0.8
  NORMAL (10+ min):       no change
  │
  ▼
finalScore stored on signal → sent to frontend
  │
  ▼
Frontend displays:
  Best Setups: finalScore >= 9
  Watchlist: finalScore 7-8
  Trade Setups: finalScore >= 8 + has signal type
  │
  ▼
Accuracy tracking:
  finalScore >= 9 + CONFIRMED stage + has type → tracked
```

---

## Files

| File | Role |
|------|------|
| `apps/server/src/lib/score-engine.ts` | Core scoring: `computeSignalScore()` |
| `apps/server/src/services/signal-worker.service.ts` | Calls score engine in `setCacheEntry()` |
| `apps/web/src/components/stock-detail.tsx` | Displays score breakdown bars |
| `apps/web/src/components/top-opportunities.tsx` | Filters by `finalScore` |
| `apps/web/src/components/watchlist-cards.tsx` | Filters by `finalScore` |
