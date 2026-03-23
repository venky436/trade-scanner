# Signal Accuracy Engine

## Overview

The Signal Accuracy Engine tracks the real-world performance of high-confidence trading signals. When a signal reaches score >= 9 during NORMAL market phase, it's recorded with entry price, target, and stoploss. The system evaluates **in real-time** (every 1 second) — if target or stoploss is hit, the signal is closed immediately. If neither is hit within 20 minutes, it's marked NEUTRAL.

Results are stored permanently in PostgreSQL and displayed on the admin dashboard (`/admin`).

---

## Complete Flow

```
MARKET OPENS (9:15 AM IST)
        │
        ▼
   OPENING PHASE (9:15 - 9:20)
   ❌ All signals blocked — no accuracy tracking
        │
        ▼
   STABILIZING PHASE (9:20 - 9:25)
   ❌ Still blocked — signals unreliable
        │
        ▼
   NORMAL PHASE (9:25+)
   ✅ Accuracy tracking ENABLED
        │
        ▼
┌─────────────────────────────────────────────────┐
│            SIGNAL WORKER (every 500ms-1s)        │
│                                                  │
│  Computes signal for each stock:                 │
│    pressure + momentum + S/R + pattern           │
│         ↓                                        │
│    Score computed (1-10)                          │
│         ↓                                        │
│    Score >= 9?  ──NO──→ skip (not tracked)       │
│         │                                        │
│        YES                                       │
│         │                                        │
│    Action != WAIT?  ──NO──→ skip                 │
│         │                                        │
│        YES                                       │
│         │                                        │
│    Phase == NORMAL?  ──NO──→ skip                │
│         │                                        │
│        YES                                       │
│         ▼                                        │
│    FIRES: onHighConfidenceSignal(symbol,         │
│           signal, price)                         │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────┐
│         ACCURACY SERVICE: recordSignal()         │
│                                                  │
│  Gate 1: Phase == NORMAL?  ──NO──→ reject        │
│         │                                        │
│        YES                                       │
│         │                                        │
│  Gate 2: Signal has type?  ──NO──→ reject        │
│          (BREAKOUT/BOUNCE/etc)                   │
│         │                                        │
│        YES                                       │
│         │                                        │
│  Gate 3: Already tracking this stock?            │
│         ──YES──→ reject (no duplicates)          │
│         │                                        │
│        NO                                        │
│         │                                        │
│  Gate 4: Queue full (100)?                       │
│         ──YES──→ reject (wait for slots)         │
│         │                                        │
│        NO                                        │
│         │                                        │
│  Gate 5: Risk/Reward >= 1.0?  ──NO──→ reject     │
│         │                                        │
│        YES                                       │
│         ▼                                        │
│    ADD signal (no replacement ever)              │
│                                                  │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────┐
│              RECORD TO DATABASE                   │
│                                                  │
│  INSERT signal_accuracy_log:                     │
│    symbol     = "TATASTEEL"                      │
│    type       = "BOUNCE"                         │
│    action     = "BUY"                            │
│    score      = 9                                │
│    entry      = ₹145.50                          │
│    target     = ₹147.83  (+1.6%)                 │
│    stoploss   = ₹143.90  (-1.1%)                 │
│    eval_time  = now + 20 minutes                 │
│    result     = NULL (pending)                   │
│                                                  │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────┐
│     REAL-TIME EVALUATION (every 1 second)        │
│                                                  │
│  For each active signal:                         │
│    Get live price from marketDataService         │
│         │                                        │
│    BUY signal:                                   │
│      price >= target?  → ✅ SUCCESS (close now)  │
│      price <= SL?      → ❌ FAILED (close now)   │
│                                                  │
│    SELL signal:                                  │
│      price <= target?  → ✅ SUCCESS (close now)  │
│      price >= SL?      → ❌ FAILED (close now)   │
│                                                  │
│    Neither hit?  → continue watching             │
│                                                  │
│  On close:                                       │
│    UPDATE DB: result, final_price, hit_time      │
│    Remove from active map (frees slot)           │
│                                                  │
└──────────────────────┬──────────────────────────┘
                       │
                       │  ... if 20 min passes without hit ...
                       │
                       ▼
┌─────────────────────────────────────────────────┐
│     TIMEOUT CHECK (every 5 minutes)              │
│                                                  │
│  For each active signal:                         │
│    recordedAt + 20 min < now?                    │
│         │                                        │
│        YES → ⚪ NEUTRAL                          │
│         │    (neither target nor SL hit)          │
│         │    UPDATE DB: result = NEUTRAL          │
│         │    Remove from active map               │
│         │                                        │
│        NO → continue watching                    │
│                                                  │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────┐
│           ADMIN DASHBOARD (/admin)               │
│                                                  │
│  ┌──────────┐ ┌──────────┐ ┌────────┐ ┌───────┐│
│  │Total: 26 │ │Accuracy: │ │Avg Gain│ │AvgLoss││
│  │          │ │  68%     │ │+0.8%   │ │-0.5%  ││
│  └──────────┘ └──────────┘ └────────┘ └───────┘│
│                                                  │
│  Win Rate by Type:                               │
│    BOUNCE:    72%  (best)                        │
│    BREAKOUT:  45%                                │
│    BREAKDOWN: 0/0                                │
│    REJECTION: 0/0                                │
│                                                  │
│  Recent Signals:                                 │
│    TATASTEEL BOUNCE BUY 9 → SUCCESS (+1.2%)     │
│    RELIANCE  BREAKOUT BUY 9 → FAILED (-0.8%)    │
│    ...                                           │
└─────────────────────────────────────────────────┘
```

---

## Key Design: True Accuracy (No Bias)

```
OLD SYSTEM (biased):
  25 slots, priority queue
  Score 7 signal recorded → later score 9 arrives → EVICTS score 7
  Result: only high scores tracked → inflated accuracy

NEW SYSTEM (unbiased):
  100 slots, first-come first-served
  Score 9 signal recorded → same stock later score 10 → SKIPPED (already tracking)
  Score 9 fills slot → queue full → new score 9 → REJECTED (wait for slots)
  Result: true accuracy of ALL signals that pass threshold
```

| Rule | Value | Purpose |
|------|-------|---------|
| No replacement | Never evict a signal for a better one | True unbiased accuracy |
| No duplicates | One signal per stock at a time | Avoid tracking same stock twice |
| First-come | First 100 signals accepted, rest wait | Measure real system performance |
| Slots freed on close | SUCCESS/FAILED/NEUTRAL frees slot | New signals can enter after evaluation |

---

## Evaluation Results Explained

```
Signal recorded at 10:00 AM
  entry = ₹100, target = ₹101.60, SL = ₹98.90

REAL-TIME CHECK (every 1 second):

  10:00:01 — price = ₹100.20 → neither hit → continue
  10:00:02 — price = ₹100.50 → neither hit → continue
  ...
  10:03:15 — price = ₹101.65 → TARGET HIT → ✅ SUCCESS
             Close immediately, update DB, free slot

OR:

  10:00:01 — price = ₹100.20 → continue
  10:01:30 — price = ₹98.85 → SL HIT → ❌ FAILED
             Close immediately, update DB, free slot

OR:

  ... 20 minutes pass, price stays between SL and target ...
  10:20:00 — TIMEOUT → ⚪ NEUTRAL
             Close, update DB, free slot
```

---

## Signal Selection Flow (No Priority Queue)

```
Time 9:30 — Active: 15/100
  BOUNCE TATASTEEL score=9 → NEW stock → ADDED [16/100]

Time 9:31 — Active: 16/100
  BOUNCE TATASTEEL score=10 → ALREADY tracking → SKIPPED

Time 9:35 — Active: 100/100 (FULL)
  BOUNCE RELIANCE score=10 → FULL → REJECTED (wait for slots)

Time 9:36 — TATASTEEL hits target
  → SUCCESS, removed from active [99/100]

Time 9:37 — Active: 99/100
  BOUNCE RELIANCE score=10 → has room → ADDED [100/100]
```

---

## Evaluation Timers

| Timer | Interval | Purpose |
|-------|----------|---------|
| Real-time eval | Every 1 second | Check live price vs target/SL for all active signals |
| Timeout eval | Every 5 minutes | Close signals that exceeded 20 min without hit → NEUTRAL |

The real-time timer is the primary evaluation method — most signals close within seconds or minutes of recording. The timeout timer is a safety net for slow-moving stocks.

---

## Safety Rules

| Rule | Value | Purpose |
|------|-------|---------|
| Max active signals | 100 | Prevent overload |
| No duplicates | 1 signal per stock | True accuracy, no bias |
| No replacement | Never evict | Unbiased measurement |
| Min risk-reward | 1.0 | Reward must be >= risk |
| Min score | 9 | Only highest-confidence signals |
| Market phase | NORMAL only | Skip OPENING/STABILIZING |
| Target (BUY) | entry × 1.016 (+1.6%) | Profit target |
| Stoploss (BUY) | entry × 0.989 (-1.1%) | Risk limit |
| RR ratio | 1.6 / 1.1 = 1.45x | Risk always less than profit |

---

## Database Schema

```sql
CREATE TABLE signal_accuracy_log (
  id            SERIAL PRIMARY KEY,
  symbol        VARCHAR(50) NOT NULL,
  signal_type   VARCHAR(20) NOT NULL,     -- BREAKOUT/BREAKDOWN/BOUNCE/REJECTION
  action        VARCHAR(10) NOT NULL,     -- BUY/SELL
  signal_score  INTEGER NOT NULL,
  entry_price   NUMERIC(12,2) NOT NULL,
  entry_time    TIMESTAMP NOT NULL,
  target_price  NUMERIC(12,2) NOT NULL,
  stop_loss     NUMERIC(12,2) NOT NULL,
  evaluation_time TIMESTAMP NOT NULL,
  max_price     NUMERIC(12,2),            -- filled on evaluation
  min_price     NUMERIC(12,2),            -- filled on evaluation
  final_price   NUMERIC(12,2),            -- filled on evaluation
  target_hit_time TIMESTAMP,
  stop_hit_time   TIMESTAMP,
  result        VARCHAR(10),              -- SUCCESS/FAILED/NEUTRAL (null = pending)
  created_at    TIMESTAMP DEFAULT NOW() NOT NULL
);
```

---

## Admin Dashboard

**URL:** `/admin` (requires ADMIN role)

**API Endpoints:**
- `GET /api/admin/accuracy` — today's metrics (total, accuracy %, win rate by type, avg gain/loss, RR ratio)
- `GET /api/admin/accuracy/signals` — recent signal records

**Metrics displayed:**

| Metric | Description |
|--------|-------------|
| Total Signals | Number of signals tracked today |
| Accuracy | Success / (Success + Failed) × 100% |
| Avg Gain | Average P&L % of successful signals |
| Avg Loss | Average P&L % of failed signals |
| Risk/Reward | Avg Gain / Avg Loss |
| Win Rate by Type | BREAKOUT, BREAKDOWN, BOUNCE, REJECTION success rates |
| Pending | Signals awaiting evaluation |

---

## Double Protection for Market Phase

The accuracy engine has two independent phase guards:

1. **Signal-worker callback**: Only fires `onHighConfidenceSignal` when `phaseResult.marketPhase === "NORMAL"` and `effectiveScore >= 9`
2. **Accuracy service** (recordSignal): Independently calls `getMarketPhase()` and skips OPENING/STABILIZING

Both must pass for a signal to be recorded.

---

## Files

| File | Role |
|------|------|
| `apps/server/src/services/signal-accuracy.service.ts` | Core engine: recording, real-time eval, timeout eval, metrics |
| `apps/server/src/db/schema/signal-accuracy.ts` | Drizzle schema for `signal_accuracy_log` table |
| `apps/server/src/routes/admin.route.ts` | Admin API endpoints (accuracy + signals) |
| `apps/web/src/components/admin-dashboard.tsx` | Admin dashboard UI |
| `apps/web/src/app/admin/page.tsx` | Admin page route |

---

## Example Log Output

```
[Accuracy] Started — real-time eval (1s) + timeout eval (5 min)
[Accuracy] Recorded: TATASTEEL BUY BOUNCE score=9 entry=₹145.50 target=₹147.83 SL=₹143.90 [1/100]
[Accuracy] Recorded: RELIANCE BUY BREAKOUT score=9 entry=₹2850.00 target=₹2895.60 SL=₹2818.65 [2/100]
[Accuracy] SUCCESS: TATASTEEL BUY at ₹147.90 (+1.65%) [1/100]
[Accuracy] FAILED: RELIANCE BUY at ₹2818.00 (-1.12%) [0/100]
[Accuracy] NEUTRAL (timeout): INFY BUY at ₹1520.00 (+0.30%) [5/100]
```

---

## Frontend Score Thresholds

| Section | Score Range | Description |
|---------|-------------|-------------|
| Best Setups | >= 9 | Actionable — highest confidence |
| Watchlist | 7 - 8 | Monitor only — not yet actionable |
| Trade Setups | >= 8 | Active patterns near key levels |
