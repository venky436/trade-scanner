# Signal Accuracy Engine

## Overview

The Signal Accuracy Engine tracks the real-world performance of high-confidence trading signals. When a signal reaches score >= 8 during NORMAL market phase, it's recorded with entry price, target, and stoploss. After 20 minutes, the system evaluates whether the target or stoploss was hit first.

Results are stored permanently in PostgreSQL and displayed on the admin dashboard (`/admin`).

---

## Priority-Based Signal Selection

The engine maintains a **priority queue of the top 25 highest-quality signals**, not the first 25. When the queue is full and a better signal arrives, the lowest-scoring signal is evicted.

### Why Priority Queue?

**Problem (old system):**
```
25 signals with score 6-7 → accepted (queue full)
New signal with score 9 → rejected (no room)
```

**Solution (current system):**
```
25 signals active, lowest score = 6
New signal with score 9 arrives
  → Evict score 6
  → Insert score 9
Result: always tracking the best 25 signals
```

### Selection Flow

```
New signal arrives (score >= 8)
  │
  ├─ Phase check: OPENING/STABILIZING? → reject
  │
  ├─ Signal type exists? (BREAKOUT/BOUNCE/etc) → required
  │
  ├─ Risk-reward >= 1.0? → required
  │
  ├─ Max 2 per stock? → check diversity
  │
  ├─ Queue has room (< 25)?
  │    └─ YES → add signal
  │
  └─ Queue full (25)?
       │
       ├─ New score > lowest score in queue?
       │    └─ YES → evict lowest, add new
       │
       └─ NO → discard (not good enough)
```

### Safety Rules

| Rule | Value | Purpose |
|------|-------|---------|
| Max active signals | 25 | Prevent overload |
| Max per stock | 2 | Diversity — avoid tracking same stock repeatedly |
| Min risk-reward | 1.0 | Reject trades where risk > reward |
| Min score | 8 | Only high-confidence signals (enforced by signal-worker callback) |
| Market phase | NORMAL only | Skip OPENING/STABILIZING (unreliable signals) |

### Risk-Reward Filter

Before accepting a signal, the engine checks:

```
BUY signal:
  target = entry × 1.016 (+1.6%)
  stoploss = entry × 0.989 (-1.1%)
  reward = target - entry
  risk = entry - stoploss
  RR = reward / risk = 1.6 / 1.1 = 1.45 ✓ (passes RR >= 1.0)

SELL signal:
  target = entry × 0.984 (-1.6%)
  stoploss = entry × 1.011 (+1.1%)
  reward = entry - target
  risk = stoploss - entry
  RR = reward / risk = 1.45 ✓
```

With the current target/stoploss percentages, all signals pass the RR filter. The filter becomes meaningful if target/stoploss percentages are tuned in the future.

---

## Signal Lifecycle

```
Signal Worker
  │
  │  score >= 8, action != WAIT, phase == NORMAL
  │
  ▼
onHighConfidenceSignal callback
  │
  ▼
recordSignal(symbol, signal, price)
  │
  ├─ Validation (phase, type, RR, diversity)
  │
  ├─ Priority check (evict lowest if needed)
  │
  ├─ Insert into DB (signal_accuracy_log)
  │
  └─ Add to active queue

  ... 20 minutes pass ...

evaluatePending() (every 5 min cron)
  │
  ├─ Query DB: unevaluated + past evaluation time
  │
  ├─ For each signal:
  │    ├─ Get current price + day high/low
  │    ├─ Check: target hit? stoploss hit?
  │    ├─ Determine result: SUCCESS / FAILED / NEUTRAL
  │    └─ Update DB record
  │
  └─ Remove from active queue (frees slot)
```

---

## Evaluation Logic

After 20 minutes, each signal is evaluated using the **first-hit** method:

```
BUY signal:
  Target hit = day's high >= target price
  Stop hit   = day's low <= stoploss

SELL signal:
  Target hit = day's low <= target price
  Stop hit   = day's high >= stoploss
```

| Condition | Result |
|-----------|--------|
| Target hit, stop NOT hit | SUCCESS |
| Stop hit, target NOT hit | FAILED |
| Both hit | Use final price to decide (P&L positive = SUCCESS) |
| Neither hit | NEUTRAL |

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

## Configuration

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_ACTIVE_SIGNALS` | 25 | Max concurrent tracked signals |
| `MAX_PER_STOCK` | 2 | Max signals per stock (diversity) |
| `MIN_RISK_REWARD` | 1.0 | Minimum RR ratio to accept |
| `EVALUATION_WINDOW_MS` | 20 min | Time before evaluation |
| `EVAL_CRON_INTERVAL_MS` | 5 min | Evaluation check frequency |
| Target (BUY) | entry × 1.016 | +1.6% target |
| Stoploss (BUY) | entry × 0.989 | -1.1% stoploss |
| Target (SELL) | entry × 0.984 | -1.6% target |
| Stoploss (SELL) | entry × 1.011 | +1.1% stoploss |

---

## Double Protection for Market Phase

The accuracy engine has two independent phase guards:

1. **Signal-worker callback** (line 133 in signal-worker.service.ts): Only fires `onHighConfidenceSignal` when `phaseResult.marketPhase === "NORMAL"`
2. **Accuracy service** (recordSignal): Independently calls `getMarketPhase()` and skips OPENING/STABILIZING

Both must pass for a signal to be recorded. This prevents opening volatility from polluting accuracy data.

---

## Files

| File | Role |
|------|------|
| `apps/server/src/services/signal-accuracy.service.ts` | Core engine: priority queue, recording, evaluation, metrics |
| `apps/server/src/db/schema/signal-accuracy.ts` | Drizzle schema for `signal_accuracy_log` table |
| `apps/server/src/routes/admin.route.ts` | Admin API endpoints (accuracy + signals) |
| `apps/web/src/components/admin-dashboard.tsx` | Admin dashboard UI |
| `apps/web/src/app/admin/page.tsx` | Admin page route |

---

## Example Log Output

```
[Accuracy] Recorded: PERSISTENT BUY BOUNCE score=8 entry=₹4721.00 target=₹4796.54 SL=₹4669.07 [1/25 active]
[Accuracy] Recorded: TATASTEEL BUY BREAKOUT score=9 entry=₹145.50 target=₹147.83 SL=₹143.90 [2/25 active]
...
[Accuracy] Evicted: CHEMCON (score 8) → replaced by RELIANCE (score 9) [25/25 active]
...
[Accuracy] Evaluating 5 pending signals...
[Accuracy] Evaluated: PERSISTENT BUY → SUCCESS (+1.2%) [24/25 active]
[Accuracy] Evaluated: TATASTEEL BUY → FAILED (-0.8%) [23/25 active]
```
