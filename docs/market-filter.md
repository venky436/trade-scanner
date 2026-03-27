# Market Filter Layer

## Overview

The Market Filter prevents signal generation during low-opportunity conditions. It runs before the signal engine and blocks/limits signals based on market activity — both globally (NIFTY 50 range) and per-stock (5-min candle range).

```
Before:  MARKET DATA → SIGNAL ENGINE → ACCURACY TRACKING
After:   MARKET DATA → MARKET FILTER → SIGNAL ENGINE → ACCURACY TRACKING
```

---

## Why We Built It

Day 2 production data showed:
- **942 signals** in one day (too many)
- **852 NEUTRAL** (90%) — stocks didn't move enough to hit target or stoploss
- **3% accuracy** — most signals generated when stocks were flat

The filter stops signal generation when the market or individual stock is too quiet, dramatically reducing noise.

---

## Flow

```
computeForSymbol(symbol)
  │
  ▼
┌──────────────────────────────────────┐
│ GLOBAL FILTER (NIFTY 50 range)       │
│                                      │
│ NIFTY 5-min range < 0.10%?          │
│   → DEAD → skip ALL stocks           │
│                                      │
│ NIFTY 5-min range < 0.30%?          │
│   → SLOW → raise per-stock threshold │
│                                      │
│ else → ACTIVE (normal)               │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│ PER-STOCK FILTER (5-min candle)      │
│                                      │
│ stockRange = (high - low) / price    │
│                                      │
│ stockRange < 0.2%?                   │
│   → DEAD stock → skip                │
│                                      │
│ GLOBAL_SLOW + stockRange < 0.4%?    │
│   → Not active enough → skip         │
│                                      │
│ stockRange < 0.5%?                   │
│   → SIDEWAYS → mark flag             │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│ SIGNAL ENGINE (existing)             │
│                                      │
│ Compute signal normally...           │
│                                      │
│ If SIDEWAYS + BREAKOUT/BREAKDOWN?    │
│   → Suppress → set WAIT             │
│   → "Sideways market — breakout      │
│      signals suppressed"             │
└──────────┬───────────────────────────┘
           │
           ▼
  Signal cached + broadcast to frontend
```

---

## Thresholds

### Global State (NIFTY 50)

| NIFTY 5-min Range | State | Action |
|-------------------|-------|--------|
| < 0.10% | DEAD | Block ALL signal generation |
| < 0.30% | SLOW | Raise per-stock threshold to 0.4% |
| >= 0.30% | ACTIVE | Normal — no restrictions |

Updated every 5-min candle close for "NIFTY 50" symbol.

### Per-Stock (Individual)

| Stock 5-min Range | Market State | Action |
|-------------------|--------------|--------|
| < 0.2% | Any | Skip — stock too quiet |
| < 0.4% | SLOW | Skip — not enough activity for slow market |
| < 0.5% | Any | SIDEWAYS — block BREAKOUT/BREAKDOWN, allow BOUNCE/REJECTION |
| >= 0.8% | Any | ACTIVE — allow all signal types |

---

## Debug Logging

Every batch cycle logs filter rejection counts:

```
[SignalWorker] Cycle: 341 cached, 173 computed, 341 skipped |
  ACTIVITY: 0, MOMENTUM: 50, PRESSURE: 30, CONFIRMED: 261 |
  BUY: 15, SELL: 3 | score≥8: 8, score≥6: 25 |
  FILTERED: 180 (dead:0 low:120 slow:35 sideways:25)
```

| Counter | Meaning |
|---------|---------|
| `dead` | Skipped due to GLOBAL_DEAD (entire market flat) |
| `low` | Skipped due to stock 5-min range < 0.2% |
| `slow` | Skipped due to GLOBAL_SLOW + stock range < 0.4% |
| `sideways` | BREAKOUT/BREAKDOWN suppressed in sideways stock |

Global state changes are also logged:
```
[MarketFilter] Global state: ACTIVE → SLOW (NIFTY range: 0.45%)
[MarketFilter] Global state: SLOW → DEAD (NIFTY range: 0.18%)
```

---

## Early Market Guard

Before 9:30 AM IST (first 15 minutes after market open), the filter forces daily S/R only — intraday S/R from early candles is unreliable.

```
if (hour === 9 && minute < 30) → use daily S/R only
```

This complements the existing market phase guard (OPENING 9:15-9:20, STABILIZING 9:20-9:25) which blocks accuracy tracking.

---

## Expected Impact

| Metric | Before Filter | After Filter |
|--------|--------------|-------------|
| Signals/day | ~900+ | ~80-150 |
| Neutral rate | ~90% | ~20-30% |
| Accuracy | ~3% | ~20-40% (expected) |
| Noise | High | Low |

---

---

## Bounce Quality Filter

BOUNCE signals go through an overextension check before being accepted. This prevents late entries on stocks that have already rallied significantly.

```
BOUNCE signal generated
  │
  ├─ Overextension check: stock moved >2.5% in last 30 min?
  │   → YES → reject "Overextended"
  │
  └─ Pass → allow BOUNCE signal
```

| Check | Threshold | Purpose |
|-------|-----------|---------|
| Overextension | > 2.5% move in 30 min | Prevents late entry after rally |

> **Note:** The bounce signal engine itself now uses candle-based rejection + hold logic (see [Signal Engine](./signal-engine.md)), which inherently prevents falling knife entries, shallow pullbacks, and support-sitting. Previous quality filters (pullback depth, support distance, strong uptrend) were removed as the new detection logic makes them redundant.

Bounce rejections are logged in the `bounce` counter in the batch cycle stats.

---

## What Stays Unchanged

- Signal engine logic (BREAKOUT/BOUNCE/REJECTION/BREAKDOWN rules)
- Score computation (Pressure 30%, Momentum 25%, S/R 25%, Volatility 10%, Signal 10%)
- Market phase control (OPENING/STABILIZING/NORMAL)
- Accuracy tracking (daily cap 100, target +1.0%, SL -0.7%)
- Broadcast/WebSocket pipeline
- Frontend display

---

## Files

| File | Change |
|------|--------|
| `apps/server/src/services/signal-worker.service.ts` | Market filter in `computeForSymbol()`, rejection counters |
| `apps/server/src/services/candle-tracker.service.ts` | Added `getLastCandle()` |
| `apps/server/src/index.ts` | Global market state from NIFTY 50, wired to signal worker |
