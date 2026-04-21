# Signal Accuracy Engine

## Overview

The Signal Accuracy Engine tracks the real-world performance of high-confidence trading signals. When a signal reaches score >= 9 during NORMAL market phase, it's recorded with entry price, type-specific target, and stoploss. The system evaluates **in real-time** (every 1 second) — if target or stoploss is hit, the signal is closed immediately. If neither is hit by market close (3:30 PM IST), it's marked NEUTRAL.

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
   STABILIZING PHASE (9:20 - 9:30)
   ❌ Still blocked — signals unreliable (15 min warmup)
        │
        ▼
   NORMAL PHASE (9:30 - 15:30)
   ✅ Accuracy tracking ENABLED until market close
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
│    target     = ₹146.66  (+0.8%, BOUNCE BUY)    │
│    stoploss   = ₹144.77  (-0.5%, BOUNCE BUY)    │
│    eval_time  = now + 24h (far future fallback)  │
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
                       │  ... if market closes without hit ...
                       │
                       ▼
┌─────────────────────────────────────────────────┐
│     MARKET CLOSE CLEANUP (every 5 minutes)       │
│                                                  │
│  If market phase == CLOSED (after 3:30 PM IST):  │
│    For each remaining active signal:             │
│         │                                        │
│        → ⚪ NEUTRAL                              │
│         │    (neither target nor SL hit)          │
│         │    UPDATE DB: result = NEUTRAL          │
│         │    Remove from active map               │
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
BREAKOUT BUY signal recorded at 10:00 AM
  entry = ₹100, target = ₹101.20 (+1.2%), SL = ₹99.40 (-0.6%)

REAL-TIME CHECK (every 1 second):

  10:00:01 — price = ₹100.20 → neither hit → continue
  10:00:02 — price = ₹100.50 → neither hit → continue
  ...
  10:03:15 — price = ₹101.25 → TARGET HIT → ✅ SUCCESS
             Close immediately, update DB, free slot

OR:

  10:00:01 — price = ₹100.20 → continue
  10:01:30 — price = ₹99.35 → SL HIT → ❌ FAILED
             Close immediately, update DB, free slot

OR:

  ... market closes without hitting target or SL ...
  15:30:00 — MARKET CLOSE → ⚪ NEUTRAL
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
| Market close cleanup | Every 5 minutes | Close remaining signals as NEUTRAL after 3:30 PM IST |

Signals have **no time limit** — they stay active until target or SL is hit, or market closes. The real-time timer is the primary evaluation method — most signals close within seconds or minutes of recording. Market close cleanup is a safety net for signals that never hit target or SL during the day.

---

## Restart Recovery

On startup, the accuracy engine loads all **pending signals** (result = NULL) from the database into the in-memory `activeMap`. This ensures:

- Server restarts don't lose tracking of active signals
- Orphaned signals from previous sessions resume evaluation
- No manual intervention needed

```
Server starts
  ↓
loadPending() queries DB: WHERE result IS NULL
  ↓
Loads into activeMap (symbol → entry/target/SL)
  ↓
Real-time eval (1s) resumes checking these signals
  ↓
Log: "[Accuracy] Loaded 12 pending signals from DB [12 active]"
```

---

## Safety Rules

| Rule | Value | Purpose |
|------|-------|---------|
| Max daily signals | 100 per day total | Hard daily cap — stops after 100 regardless |
| No duplicates | 1 signal per stock | True accuracy, no bias |
| No replacement | Never evict | Unbiased measurement |
| No time limit | Until target or SL hit | Let the trade play out fully |
| Market close cleanup | 3:30 PM IST | Remaining active signals → NEUTRAL |
| Min risk-reward | 1.0 | Reward must be >= risk |
| Min score | 9 | Only highest-confidence signals |
| Market phase | NORMAL only (9:30 AM+) | Skip OPENING/STABILIZING |
| Early session cutoff | After 9:45 AM IST | Skip early unreliable signals |
| Late session cutoff | Before 3:10 PM IST | Stop recording before market close |
| Min price | ₹50 | Skip low-price stocks — unreliable signals |
| Targets/SL | Type-specific (see table below) | Different signal types have different risk profiles |

**Type-Specific Targets and Stop Losses:**

| Signal Type | BUY Target | BUY SL | BUY R:R | SELL Target | SELL SL | SELL R:R | Rationale |
|-------------|-----------|--------|---------|------------|--------|---------|-----------|
| **BREAKOUT** | +1.2% | -0.6% | 2.0x | -0.8% | +0.5% | 1.6x | Momentum plays run further; tight SL below breakout level |
| **BREAKDOWN** | +0.8% | -0.5% | 1.6x | -1.2% | +0.6% | 2.0x | Mirror of breakout for sell side |
| **BOUNCE** | +0.8% | -0.5% | 1.6x | -0.5% | +0.4% | 1.25x | Reversal plays need smaller targets; tight SL because failure = breakdown |
| **REJECTION** | +0.5% | -0.4% | 1.25x | -0.8% | +0.5% | 1.6x | Mirror of bounce for sell side |
| **Default** | +1.0% | -0.7% | 1.43x | -0.5% | +0.5% | 1.0x | Fallback (original values) |

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

## Five-Gate Protection

The accuracy engine has seven independent guards that ALL must pass:

```
Signal arrives at setCacheEntry()
  │
  Gate 1: score >= 9?                    → skip if low score
  Gate 2: action != WAIT?                → skip if unconfirmed at S/R
  Gate 3: signal.type exists?            → skip if no BREAKOUT/BOUNCE/REJECTION/BREAKDOWN
  Gate 4: stage == CONFIRMED?            → skip if MOMENTUM/PRESSURE stage
  Gate 5: marketPhase == NORMAL?         → skip if OPENING/STABILIZING (before 9:30 AM)
  Gate 6: time >= 9:45 AM IST?          → skip if before 9:45 AM
  Gate 7: time < 3:10 PM IST?           → skip if near market close
  Gate 7: price >= ₹50?                 → skip if low-price stock
  │
  ALL PASS → record for accuracy
```

| Gate | What it checks | What it blocks |
|------|---------------|----------------|
| score >= 9 | Signal quality | Low-confidence signals |
| action != WAIT | Confirmed direction | Stocks sitting at S/R without confirmation |
| signal.type exists | Has BREAKOUT/BOUNCE/REJECTION/BREAKDOWN | MOMENTUM/PRESSURE stage signals (no S/R validation) |
| stage == CONFIRMED | Passed through signal engine with S/R checks | Early-stage signals that bypass S/R confirmation |
| phase == NORMAL | Market is past opening volatility | OPENING/STABILIZING phase (until 9:30 AM) |
| time >= 9:45 AM | Past early session noise | First 30 minutes of trading unreliable for accuracy |
| time < 3:10 PM | Before market close window | Stop recording near market close |
| price >= ₹50 | Minimum stock price | Low-price penny stocks with unreliable signals |

Plus the accuracy service adds:
- **Market filter**: blocks quiet stocks before signal generation
- **Daily cap**: max 100 per day
- **No duplicates**: one per stock
- **RR filter**: reward must be >= risk

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
[Accuracy] Started — real-time eval (1s), no time limit, market close cleanup
[Accuracy] Recorded: TATASTEEL BUY BOUNCE score=9 entry=₹145.50 target=₹146.66 SL=₹144.77 [1/100 today, 1 active]
[Accuracy] Recorded: RELIANCE BUY BREAKOUT score=9 entry=₹2850.00 target=₹2884.20 SL=₹2832.90 [2/100 today, 2 active]
[Accuracy] SUCCESS: TATASTEEL BUY at ₹146.70 (+0.82%) [1 active]
[Accuracy] FAILED: RELIANCE BUY at ₹2832.50 (-0.61%) [0 active]
[Accuracy] NEUTRAL (market close): INFY BUY at ₹1520.00 (+0.30%)
```

---

## Frontend Score Thresholds

| Section | Score Range | Description |
|---------|-------------|-------------|
| Best Setups | >= 9 | Actionable — highest confidence |
| Watchlist | 7 - 8 | Monitor only — not yet actionable |
| Trade Setups | >= 8 | Active patterns near key levels |
