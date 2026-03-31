# Index Continuation Signals & Options Flow

## What It Does

The Continuation system extends the scanner to generate **momentum-driven signals for indices** (NIFTY 50, BANK NIFTY, SENSEX) when price is **between** support and resistance levels. This fills a gap where indices spend most of their time — far from S/R levels in strong directional trends.

Additionally, it provides **options strike suggestions** (ITM/ATM/OTM) for each continuation signal, enabling options traders to act on directional calls.

---

## Why We Built It

The existing system is designed around S/R-based trading:

```
IF price is near S/R (≤ 1%) → evaluate → signal
ELSE → WAIT
```

This works well for **stocks** (frequent S/R reactions, range-based behavior). But **indices behave differently**:

- S/R levels are far apart (2–5% distance common)
- Price spends most time BETWEEN levels
- Strong directional trends are common
- Options traders care about momentum direction, not just levels

Result: The system produced very few signals for indices — missing the biggest trading opportunities.

---

## Two Signal Modes

### Mode 1: S/R Signal (Existing)

```
Price near S/R → BREAKOUT / BOUNCE / REJECTION / BREAKDOWN
```

- Works for all symbols (stocks + indices)
- High accuracy, structure-based
- Clear invalidation levels (S/R defines stoploss)

### Mode 2: Continuation Signal (NEW — Indices Only)

```
Price NOT near S/R + Strong Trend → CONTINUATION BUY/SELL
```

- Only for NIFTY 50, NIFTY BANK, SENSEX
- Momentum-driven, trend-based
- No structural invalidation (capped at 9.5, never 10/10)

**Stocks never receive CONTINUATION signals.**

---

## Decision Flow

```
Market Data (tick)
       │
       ▼
┌──────────────────────────┐
│ Pressure + Momentum      │
│ + S/R + Pattern          │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│   Signal Engine          │
│   (S/R-based logic)      │
└───────┬──────────┬───────┘
        │ BUY/SELL │ WAIT
        │          │
        ▼          ▼
┌─────────────┐   ┌──────────────────────┐
│ S/R SIGNAL  │   │ Is NIFTY 50 /        │
│ (done)      │   │ BANK NIFTY / SENSEX? │
└─────────────┘   └───────┬──────┬───────┘
                          │ YES  │ NO
                          │      │
                          │      ▼
                          │   ┌────────┐
                          │   │ WAIT   │ ← stocks stay here
                          │   └────────┘
                          ▼
                 ┌──────────────────────────┐
                 │ 9-Gate Continuation      │
                 │ Check (all must pass)    │
                 └───────┬──────────┬───────┘
                         │ PASS     │ FAIL
                         │          │
                         ▼          ▼
                ┌─────────────┐  ┌────────┐
                │CONTINUATION │  │ WAIT   │
                │ + Boost     │  └────────┘
                └─────────────┘
```

---

## 9-Gate Confirmation

ALL gates must pass for a CONTINUATION signal to fire:

### Gate 1: Index Check
- Symbol must be `NIFTY 50`, `NIFTY BANK`, or `SENSEX`
- All other symbols → skip (stocks unaffected)

### Gate 2: Distance Safety
- Price must be > 0.5% away from BOTH support AND resistance
- Prevents: buying near resistance, selling near support
- If < 0.5% from either → BLOCK

### Gate 3: Trend Mode Filter
- At least 3 of last 5 candles aligned with signal direction
- AND last 2 candles MUST be in same direction (confirms active trend)
- BUY: 3/5 bullish + last 2 bullish
- SELL: 3/5 bearish + last 2 bearish
- Prevents: triggering in choppy/sideways markets

### Gate 4: Momentum Direction
- BUY: momentum.signal = `UP` or `STRONG_UP`
- SELL: momentum.signal = `DOWN` or `STRONG_DOWN`

### Gate 5: Acceleration Confirming
- BUY: acceleration = `INCREASING` (momentum building)
- SELL: acceleration = `DECREASING` (selling strengthening)

### Gate 6: Pressure Aligned
- BUY: pressure.signal = `BUY` or `STRONG_BUY`
- SELL: pressure.signal = `SELL` or `STRONG_SELL`

### Gate 7: Pressure Confidence
- `pressure.confidence >= 0.5`
- Ensures enough volume participation

### Gate 8: Momentum Quality
- BUY: `quality > 0.6`
- SELL: `|quality| > 0.6`

### Gate 9: Room to Move
- BUY: distance to resistance > 0.8% (enough upside for profit)
- SELL: distance to support > 0.8% (enough downside for profit)
- Prevents: entering BUY with resistance 0.5% away (no room), entering SELL with support 0.5% away

---

## Dynamic Score Boost

CONTINUATION signals get a raw score that's typically 6-8 (S/R contributes 0). A context-aware boost compensates:

### VERY STRONG
All of:
- Momentum = `STRONG_UP` or `STRONG_DOWN`
- Pressure = `STRONG_BUY` or `STRONG_SELL`
- Quality > 0.8

→ **boost = +1.5, capped at 9.5**

### STRONG
All gates pass with quality > 0.6

→ **boost = +1.0, capped at 8.5**

### Otherwise
→ **no boost** (raw score)

**10/10 is reserved for S/R-confirmed signals only.** Continuation signals lack structural confirmation (no nearby S/R for invalidation), so they cap at 9.5.

---

## Strength Mapping (UI)

For CONTINUATION signals, the UI shows "Strength" instead of raw score:

| Effective Score | Strength | Meaning |
|----------------|----------|---------|
| 8.5 – 9.5 | **HIGH** | Strong trend — actionable |
| 7.0 – 8.4 | **MEDIUM** | Moderate trend — watch closely |
| < 7.0 | **LOW** | Weak — not actionable |

---

## Accuracy Tracking

CONTINUATION signals are tracked **separately** in the accuracy database:

- Stored with `signalType = "CONTINUATION"`
- Admin dashboard shows CONTINUATION as its own row in "Win Rate by Type"
- Does NOT pollute BREAKOUT/BOUNCE/REJECTION/BREAKDOWN accuracy
- Subject to same gates: score ≥ 9, NORMAL phase, 10:00 AM – 2:45 PM IST, price ≥ ₹50

---

## Options Strike Display (Phase 2)

When a CONTINUATION signal fires, the UI will suggest options contracts:

### For BUY Signal → Show CE Options

```
NIFTY — BUY (Strong Uptrend ↗)
Strength: HIGH

Recommended: ATM CE ⭐

Options (Expiry: 03 Apr 2026):
┌──────────────────────────────────────────┐
│ ITM CE  22400  ₹245.30   Safer          │
│ ATM CE  22500  ₹185.50   Balanced ⭐    │
│ OTM CE  22600  ₹142.30   Aggressive     │
└──────────────────────────────────────────┘

S/R Context:
Support: 22,000 (2.2% away)
Resistance: 23,000 (2.2% away)

Best for: Intraday momentum continuation
```

### For SELL Signal → Show PE Options

```
NIFTY — SELL (Strong Downtrend ↘)
Strength: HIGH

Recommended: ATM PE ⭐

Options (Expiry: 03 Apr 2026):
┌──────────────────────────────────────────┐
│ ITM PE  22600  ₹230.10   Safer          │
│ ATM PE  22500  ₹175.40   Balanced ⭐    │
│ OTM PE  22400  ₹135.60   Aggressive     │
└──────────────────────────────────────────┘
```

### Strike Selection

| Strike | Description | When to Use |
|--------|-------------|-------------|
| **ITM** | 1 strike in-the-money | Safer, lower risk, higher premium |
| **ATM** | Nearest to spot price | Balanced risk/reward (default ⭐) |
| **OTM** | 1 strike out-of-money | Aggressive, lower premium, higher risk |

### Recommendation Logic

| Trend Strength | Recommended Strike |
|---------------|-------------------|
| VERY STRONG | ATM or OTM |
| STRONG | ATM |
| MEDIUM | ATM or ITM |

### Strike Step Sizes

| Index | Strike Step |
|-------|-----------|
| NIFTY 50 | 50 |
| BANK NIFTY | 100 |
| SENSEX | 100 |

### Implementation (Phase 2)

1. `findOptionStrikes()` in instrument service — finds nearest weekly expiry, calculates ITM/ATM/OTM
2. `GET /api/stocks/:symbol/options` — returns strikes with live premium prices
3. Subscribe to option contract tokens via Kite ticker for live data
4. Frontend component on index detail page

---

## What Does NOT Change

| Component | Changes? |
|-----------|----------|
| signal-engine.ts (getSignal) | **NO** — still returns WAIT for non-S/R |
| score-engine.ts | **NO** — weights unchanged |
| momentum-engine.ts | **NO** |
| pressure.service.ts | **NO** |
| pattern-engine.ts | **NO** |
| Stock signal flow | **NO** — zero changes |
| S/R signals for indices | **NO** — still work when near S/R |
| Existing accuracy tracking | **NO** — S/R signals tracked same as before |

---

## Files Modified

| File | Change |
|------|--------|
| `apps/server/src/lib/types.ts` | Added `CONTINUATION` to SignalType |
| `apps/server/src/services/signal-worker.service.ts` | 8-gate CONTINUATION logic + dynamic boost |
| `apps/server/src/services/signal-accuracy.service.ts` | CONTINUATION in win rate types |
| `apps/web/src/lib/types.ts` | Mirrored `CONTINUATION` type |
| `apps/web/src/components/sr-cards.tsx` | CONTINUATION label in signal badges |
| `apps/web/src/components/stock-detail.tsx` | "Trend Continuation" label |

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Indices only (3 symbols) | Stocks work well with S/R — continuation would add noise |
| 8 gates required | Strict filtering prevents false signals in choppy markets |
| Trend mode filter (3/5 + last 2) | Ensures current active trend, not historical alignment |
| Distance safety (> 0.5%) | Prevents dangerous continuation near S/R levels |
| Dynamic boost (not fixed) | VERY STRONG trends get higher boost than moderate trends |
| Capped at 9.5 (never 10) | 10/10 reserved for S/R-confirmed signals with clear invalidation |
| Separate accuracy tracking | Data to improve continuation without polluting S/R accuracy |
| S/R signals take priority | If near S/R, always use S/R logic — CONTINUATION is fallback only |
| Options as Phase 2 | Verify continuation signals work first, then add options display |
