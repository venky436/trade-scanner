# Signal Tracking System

> Validates whether the intelligence layer's confidence actually correlates with real price outcomes. Uses a **single tracking pool** (confidence ≥ 0.7, Bounce + Rejection only) and a **direction snapshot at minute 10 with a ±0.2% NEUTRAL dead-zone**. Each signal is classified at metric time:
>
> - `|change| ≥ 0.2%` in the expected direction → **SUCCESS**
> - `|change| ≥ 0.2%` in the opposite direction → **FAILED**
> - `|change| <  0.2%` (either side) → **NEUTRAL** (excluded from accuracy)
>
> Accuracy is `wins / (wins + losses)` — NEUTRAL rows are never in the denominator. The DB still stores raw `SUCCESS` / `FAILED` from the direction snapshot; the dead-zone is applied at metric-compute time. Admin-only — not user-facing.

## Why this exists

The intelligence layer produces a confidence score (0–1) for every stock. But confidence is only useful if higher confidence actually leads to better outcomes. This system answers:

- Are high-confidence signals actually working?
- How much do they move in 10 minutes?
- Is the system profitable in terms of expectancy?
- Are the **reactive** outlooks (Bounce at support, Rejection at resistance) holding their edge over time?

## 2026-05-07 model change — single pool, reactive plays only

After 8 days of production data, the 3-bucket × 4-outlook model collapsed into a single tracking pool:

- **Predictive plays retired**: BREAKOUT_LIKELY (45.8% on 201 decided) and BREAKDOWN_RISK (51.9% on 106 decided, R:R 0.80 → negative expectancy) no longer emit. The intelligence transformer returns `NO_CLEAR_EDGE` for those zone+momentum combinations.
- **Reactive plays retained**: BOUNCE_EXPECTED (54.3% on 70, R:R 1.57) and REJECTION_POSSIBLE (60.8% on 51) are the only outlooks that publish.
- **Single confidence floor**: emission requires `confidence ≥ 0.7` (i.e. the legacy `HIGH` label). Below that, `NO_CLEAR_EDGE`.
- **Single bucket label**: new rows are written with `confidence_bucket = "TRACKED"`. Historical `HIGH` and `ULTRA_HIGH` rows are folded into the same single-pool view at metric time (they're also conf ≥ 0.7); historical `MEDIUM` rows (conf 0.5–0.7) fall below the new floor and are excluded.

## Relationship to the existing accuracy tracker

Two parallel systems run independently:

| | Old: `signal_accuracy_log` | New: `signal_tracking` |
|---|---|---|
| **Trigger** | `score >= 9` (internal 1–10 scale) | `confidence >= 0.5` (intelligence layer 0–1 scale) |
| **Evaluation** | Target / stop-loss hit (variable time, can run all day) | Direction snapshot at minute 10 — pure WIN or LOSS |
| **Metrics** | SUCCESS / FAILED / NEUTRAL | SUCCESS / FAILED + change %, points, max profit, max drawdown, expectancy |
| **Grouping** | By signal type (BREAKOUT / BOUNCE / etc.) | By confidence bucket (ULTRA_HIGH / HIGH / MEDIUM) × outlook type |
| **Check cadence** | Every 1 second | Every 30 seconds |
| **Daily cap** | 100 | 200 |
| **Admin page** | `/admin` (retired — placeholder only) | `/admin/tracking` |

Both coexist. The old one validates the internal engines; this one validates the public intelligence layer.

---

## Single tracking pool

Every emitted signal lands in the same pool. The 3-bucket model (Ultra/High/Medium) was retired 2026-05-07.

| Pool | Range | Outlooks | Min samples before trusting |
|---|---|---|---|
| **TRACKED** | confidence ≥ 0.7 | BOUNCE_EXPECTED, REJECTION_POSSIBLE | 250 |

Below 0.7 → no signal. Above 0.7 with a non-reactive outlook (Breakout / Breakdown) → no signal. The minimum sample rule prevents random luck from fooling us; until 250 decided signals (SUCCESS + FAILED) exist, results are flagged insufficient.

---

## Tracking flow

```
Kite tick arrives
    ↓
broadcast.service.ts tick loop
    ↓
toIntelligence(snapshot) → IntelligenceSnapshot
    ↓
onIntelligenceComputed(symbol, intel, price)
    ↓
signal-tracking.service.ts recordSignal()
    ↓
Guards:
  ✗ confidence < 0.7      → skip (single floor)
  ✗ outlook = NO_CLEAR_EDGE → skip (no directional bet — covers retired Breakout/Breakdown)
  ✗ phase ≠ NORMAL         → skip (OPENING/STABILIZING)
  ✗ before 9:30 AM IST     → skip (NORMAL phase begins at 9:30)
  ✗ after 3:10 PM IST      → skip (stop before close)
  ✗ price < ₹50            → skip
  ✗ already pending eval     → skip (activeMap has symbol)
  ✗ already tracked today    → skip (trackedToday dedup — one signal per symbol per day,
                                   freed back to eligible if a prior lock landed NEUTRAL
                                   inside the ±0.2% dead-zone)
  ✗ daily cap (200) hit      → skip
    ↓
INSERT into signal_tracking table
  status = PENDING
  bucket = TRACKED
    ↓
Evaluation timer (every 30 seconds, direction snapshot)
  For each PENDING row in activeMap:
    if now < signal_time + 10 min  → leave PENDING (still inside the window)

    Once 10 min elapsed:
      quote = marketDataService.getQuote(symbol)   // in-memory, cheap
      change_percent = ((quote.lastPrice - price_at_signal) / price_at_signal) * 100

      Classification at WRITE time (direction snapshot):
        BUY-side (BREAKOUT_LIKELY, BOUNCE_EXPECTED):
          change ≥ 0%   → SUCCESS
          change <  0%   → FAILED

        SELL-side (REJECTION_POSSIBLE, BREAKDOWN_RISK):
          change ≤ 0%   → SUCCESS
          change >  0%   → FAILED

      The ±0.2% NEUTRAL dead-zone is applied later, at metric-compute time
      (see "NEUTRAL dead-zone" below). The DB row stores the raw
      direction-snapshot SUCCESS / FAILED.
    ↓
On lock:
  price_after = quote.lastPrice (snapshot at minute 10)
  max_price = quote.high (intraday)
  min_price = quote.low (intraday)
  change_points = price_after - price_at_signal
  max_profit_percent = ((max_price - price_at_signal) / price_at_signal) * 100
  max_drawdown_percent = ((min_price - price_at_signal) / price_at_signal) * 100

  UPDATE row (status, evaluatedAt=now, all price fields)
  Remove from activeMap (evaluation lifecycle done)
```

### Why pure direction (no TP/SL thresholds)

Earlier iterations used a first-touch race against ±0.5% TP/SL bands. Prod data on 2026-05-05 showed that only ~25% of signals actually moved ±0.5% within 10 min — the other 70-80% fell back to NEUTRAL, which crushed the dashboard's signal-to-noise ratio. Switching to a pure direction snapshot eliminates the no-show category entirely: every signal becomes a forced WIN or LOSS, so the dashboard reads as a clean realized-trade win-rate.

### Why 30-second polling

The eval doesn't act on the signal until minute 10, so polling cadence only affects how quickly we lock in *after* the 10-min mark passes. 30 seconds is fast enough (lock-in lag ≤ 30s) without burning cycles on signals that aren't due yet.

### Market close cleanup

After 3:30 PM IST, any remaining PENDING signals (including ones that haven't reached minute 10) are force-evaluated against the close price using the same direction logic. Never NEUTRAL.

---

## Database schema

Table: `signal_tracking`

```sql
id                  SERIAL PRIMARY KEY
symbol              VARCHAR(50)    NOT NULL
signal_time         TIMESTAMP      NOT NULL
price_at_signal     NUMERIC(12,2)  NOT NULL

outlook             VARCHAR(30)    NOT NULL   -- BOUNCE_EXPECTED / REJECTION_POSSIBLE
                                              -- (legacy rows: BREAKOUT_LIKELY / BREAKDOWN_RISK)
confidence          NUMERIC(5,4)   NOT NULL   -- 0.7000 – 1.0000 (new floor)
confidence_bucket   VARCHAR(15)    NOT NULL   -- TRACKED (new); HIGH/ULTRA_HIGH/MEDIUM on legacy rows
zone                VARCHAR(20)    NOT NULL   -- NEAR_RESISTANCE / NEAR_SUPPORT
bias                VARCHAR(10)    NOT NULL   -- BULLISH / BEARISH / NEUTRAL

status              VARCHAR(10)    NOT NULL DEFAULT 'PENDING'

-- Filled at lock-in moment (direction snapshot at minute 10)
price_after            NUMERIC(12,2)
change_percent         NUMERIC(8,4)
change_points          NUMERIC(12,2)
max_price              NUMERIC(12,2)
min_price              NUMERIC(12,2)
max_profit_percent     NUMERIC(8,4)
max_drawdown_percent   NUMERIC(8,4)
evaluated_at           TIMESTAMP

created_at          TIMESTAMP DEFAULT NOW()
```

File: `apps/server/src/db/schema/signal-tracking.ts`

To create the table: `npx drizzle-kit push`

---

## Metrics computed per bucket

```ts
interface BucketMetrics {
  bucket: "ULTRA_HIGH" | "HIGH" | "MEDIUM";
  total: number;           // all signals in the bucket today
  pending: number;         // not yet evaluated
  success: number;         // post-dead-zone wins
  failed: number;          // post-dead-zone losses
  neutral: number;         // |change| < 0.2% — excluded from accuracy
  accuracy: number;        // wins / (wins + losses) * 100  — NEUTRAL excluded
  avgGain: number;         // avg |change_percent| for SUCCESS signals
  avgLoss: number;         // avg |change_percent| for FAILED signals
  avgMaxProfit: number;    // avg max_profit_percent across all evaluated
  avgMaxDrawdown: number;  // avg max_drawdown_percent across all evaluated
  expectancy: number;      // (winRate * avgGain) - (lossRate * avgLoss)
  riskReward: number;      // |avgGain / avgLoss|
  sampleSufficient: boolean;
  minSampleRequired: number;
  byOutlook: Record<string, { total: number; wins: number; neutral: number; rate: number }>;
}
```

### NEUTRAL dead-zone (±0.2%)

`reclassifyForMetrics()` in `signal-tracking.service.ts` applies a **±0.2% dead-zone** at metric-compute time:

- `|change_percent| < 0.2%` → metric-class **NEUTRAL** (excluded from wins+losses)
- `|change_percent| ≥ 0.2%` AND direction matches outlook → **SUCCESS**
- `|change_percent| ≥ 0.2%` AND direction opposite → **FAILED**
- `status = PENDING` → **PENDING**

The DB row's stored `status` is **overridden** by this rule — `change_percent` is the source of truth at metric time. So a row stored as `SUCCESS` with `change_percent = 0.05%` becomes a metric-NEUTRAL and is excluded from accuracy. This filters intraday wiggles that aren't a meaningful directional outcome.

The constant is `NEUTRAL_METRIC_THRESHOLD_PERCENT = 0.2` in `apps/server/src/services/signal-tracking.service.ts`. The frontend mirrors this in:

- `apps/web/src/components/tracking-dashboard.tsx` — the Recent Signals table's `displayStatus()` helper (so table pills match the bucket-card accuracy)
- `apps/web/src/components/social/template-shared.tsx` — `NEUTRAL_THRESHOLD_PERCENT` exported constant used by the public Social templates

**These three constants must stay in sync.** If you tune the threshold, change all three.

### Historical NEUTRAL rows

Pre-direction-snapshot DB rows had `status = NEUTRAL` written directly. The dead-zone reclassifier handles them transparently: their `change_percent` is checked against the same ±0.2% rule, so they end up in NEUTRAL / SUCCESS / FAILED based on actual movement, not the legacy stored label. No DB writes; past-date dashboards stay consistent with the new model.

### Expectancy (the key metric)

```
Expectancy = (WinRate × AvgGain) − (LossRate × AvgLoss)
```

`AvgGain` and `AvgLoss` are both **magnitudes** (always ≥ 0). They're computed as `|change_percent|` so BUY-side and SELL-side outcomes contribute equally — a SELL success where price dropped 0.5% counts the same as a BUY success where price rose 0.5%.

Example (with direction snapshot — AvgGain and AvgLoss are observed, not capped):
```
ULTRA_HIGH:
  WinRate = 60% (0.60)
  AvgGain = 0.40%  (magnitude — observed at minute 10 across SUCCESS rows)
  AvgLoss = 0.35%  (magnitude — observed at minute 10 across FAILED rows)

  Expectancy = (0.60 × 0.40) − (0.40 × 0.35)
             = 0.240 − 0.140
             = +0.100%
```

With pure direction (no capping), AvgGain/AvgLoss reflect actual observed price movements at minute 10. Breakeven sits where `WinRate × AvgGain = LossRate × AvgLoss` — typically around 50% if AvgGain ≈ AvgLoss, lower if winning moves are larger than losing moves.

A positive expectancy means the system is profitable. A negative expectancy means it's losing money even with a decent win rate (because losses are larger than gains).

If ULTRA_HIGH has higher expectancy than HIGH, which has higher than MEDIUM — the confidence formula is validated.

---

## API endpoints

| Endpoint | Returns | Auth |
|---|---|---|
| `GET /api/admin/tracking` | Today's metrics (3 bucket cards) | Admin only |
| `GET /api/admin/tracking/:date` | Metrics for a specific date | Admin only |
| `GET /api/admin/tracking/signals` | Recent signal records (filterable by `?date=`) | Admin only |

All endpoints require `authMiddleware + adminGuard`.

---

## Admin dashboard — `/admin/tracking`

### Layout

```
┌─ Header ──────────────────────────────────────────────────────┐
│ Signal Tracking Analytics              X active signals       │
│ 10-minute direction snapshot · confidence buckets             │
└───────────────────────────────────────────────────────────────┘

┌─ 3 Bucket Cards (clickable — filters the table below) ──────┐
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐          │
│ │ 👑 ULTRA HIGH │ │ 🔥 HIGH       │ │ 🎯 MEDIUM    │          │
│ │ conf ≥ 0.9   │ │ 0.7 – 0.9   │ │ 0.5 – 0.7   │          │
│ │              │ │              │ │              │          │
│ │  72%         │ │  58%         │ │  41%         │ ← accuracy│
│ │ +0.492%      │ │ +0.220%      │ │ -0.080%      │ ← expect │
│ │              │ │              │ │              │          │
│ │ 23/20 ✓      │ │ 67/50 ✓      │ │ 45/100 ⚠    │ ← samples│
│ │ 15W 8L       │ │ 38W 29L      │ │ 18W 27L     │          │
│ └──────────────┘ └──────────────┘ └──────────────┘          │
└───────────────────────────────────────────────────────────────┘

┌─ Movement Stats ────────────┐  ┌─ By Outlook ───────────────┐
│ Avg Gain:      +0.82%       │  │ Breakout    12 sig  75%    │
│ Avg Loss:      -0.31%       │  │ Bounce       8 sig  63%    │
│ Risk:Reward:    2.6x        │  │ Rejection    7 sig  71%    │
│ Avg Max Profit: +1.2%       │  │ Breakdown    5 sig  60%    │
│ Avg Max Drawdown: -0.4%     │  │                            │
└─────────────────────────────┘  └────────────────────────────┘

┌─ Recent Signals Table ───────────────────────────────────────┐
│ Time  Symbol Outlook    Conf  Bucket Entry    After  Chg  St │
│ 10:05 BHEL   Bounce     0.82  HIGH   ₹287.7  ₹289.1 +0.49 ✅│
│ 10:12 TCS    Rejection  0.74  HIGH   ₹3425   ₹3418  -0.20 ⚪│
│ 10:18 INFY   Breakout   0.91  ULTRA  ₹1632   ₹1641  +0.52 ✅│
└───────────────────────────────────────────────────────────────┘
```

### Visual design

- **Bucket cards**: clickable — clicking filters the stats section + table below to that bucket. Gold gradient for ULTRA_HIGH, blue for HIGH, zinc for MEDIUM.
- **Accuracy**: big text-4xl number, colored green (≥60%), amber (40–60%), red (<40%)
- **Expectancy**: +/- number with color
- **Sample progress bar**: current/required ratio. Green check if sufficient, amber warning if not.
- **Signals table**: color-coded STATUS column — green SUCCESS, red FAILED, amber PENDING. (NEUTRAL kept defensively for any historical row that bypasses the server reclassifier; new rows are never NEUTRAL.) Shows max profit ↑ and max drawdown ↓ columns.
- **Auto-refresh**: polls every 30 seconds (matches the backend snapshot cadence — outcomes lock at minute 10 and surface within ~one cycle)
- **Light + dark mode**: follows the same pattern as all other components

### Nav access

Admin users see a TrendingUp icon in the navbar (next to the existing Shield admin icon) that links to `/admin/tracking`.

---

## File map

### Backend

| File | Action |
|---|---|
| `apps/server/src/db/schema/signal-tracking.ts` | **NEW** — Drizzle schema for `signal_tracking` table |
| `apps/server/src/db/schema/index.ts` | **UPDATE** — export `signalTracking` |
| `apps/server/src/services/signal-tracking.service.ts` | **NEW** — `createSignalTrackingService()` factory: recordSignal, evaluate (30s direction snapshot at minute 10), evaluateMarketClose, getMetrics, getRecentSignals |
| `apps/server/src/services/broadcast.service.ts` | **UPDATE** — added `onIntelligenceComputed` callback to `BroadcastConfig`, called per dirty symbol after `toIntelligence()` |
| `apps/server/src/routes/admin.route.ts` | **UPDATE** — 3 new `/api/admin/tracking/*` endpoints, `getTrackingService` in opts |
| `apps/server/src/server.ts` | **UPDATE** — `getTrackingService` in `ServerDeps`, passed to `adminRoute` |
| `apps/server/src/index.ts` | **UPDATE** — create + start + stop `trackingServiceInstance`, wired via broadcast config callback, passed to `buildServer` |

### Frontend

| File | Action |
|---|---|
| `apps/web/src/app/admin/tracking/page.tsx` | **NEW** — Next.js route |
| `apps/web/src/components/tracking-dashboard.tsx` | **NEW** — 3 bucket cards + movement stats + by-outlook breakdown + signals table |
| `apps/web/src/components/global-nav.tsx` | **UPDATE** — TrendingUp icon link to `/admin/tracking` for admin users |

### Untouched

- `signal-accuracy.service.ts` — the old system keeps running independently
- All engines (signal, score, momentum, pressure, pattern, levels)
- All user-facing UI (dashboard, stock cards, detail page, options, watch zone)
- Intelligence transformer, types

---

## Guards (what gets filtered out)

| Guard | Reason |
|---|---|
| `confidence < 0.5` | Below the MEDIUM bucket floor — no tracking |
| `outlook === "NO_CLEAR_EDGE"` | No directional bet to validate |
| `phase !== "NORMAL"` | Opening/stabilizing noise would pollute data |
| `IST time < 9:30 AM` | NORMAL phase begins at 9:30; OPENING + STABILIZING already filtered by phase guard |
| `IST time >= 3:10 PM` | Stop recording before market close |
| `price < ₹50` | Penny stocks are unreliable |
| `activeMap.has(symbol)` | Signal still pending 10-min evaluation |
| `trackedToday` same or lower bucket | Prevents duplicate entries at same confidence level. Allows re-tracking when stock upgrades to a higher bucket (MEDIUM → HIGH → ULTRA_HIGH). Once a stock has been tracked at a given bucket on a given IST day, no new signal at the same or lower bucket is recorded — every signal now produces a forced WIN or LOSS, so there's no NEUTRAL slot-release path. |
| Daily cap (200) hit | Prevent runaway DB writes |

---

## Signal grouping (groupId)

Signals from the same stock on the same day are linked by a computed `groupId`:

```
groupId = `${symbol}-${YYYY-MM-DD from signalTime}`
```

Example: RELIANCE tracked at MEDIUM (10:15), then upgrades to HIGH (11:30):
```
{ symbol: "RELIANCE", bucket: "MEDIUM", groupId: "RELIANCE-2026-04-16" }
{ symbol: "RELIANCE", bucket: "HIGH",   groupId: "RELIANCE-2026-04-16" }
```

`groupId` is **not stored in the database** — it's computed in the API layer (`getRecentSignals`) from existing `symbol` + `signalTime` columns. This enables:
- De-duplicated analytics (count one result per group)
- Signal evolution tracking (MEDIUM → HIGH → ULTRA progression)
- Per-stock analysis without schema changes

---

## Constants

| Constant | Value | Why |
|---|---|---|
| `MAX_DAILY_SIGNALS` | 200 | Higher than old system's 100 because we track 3 buckets |
| `EVAL_INTERVAL_MS` | 30,000 (30 sec) | Poll cadence — once a signal passes minute 10, lock-in lag is at most 30 seconds |
| `EVAL_WINDOW_MS` | 600,000 (10 min) | Snapshot window. Direction is checked exactly when this elapses |
| `MIN_SAMPLES.ULTRA_HIGH` | 20 | Minimum decided signals before trusting results |
| `MIN_SAMPLES.HIGH` | 50 | |
| `MIN_SAMPLES.MEDIUM` | 100 | |

---

## What to look for by end of day

After a full trading session with this system running:

1. **Do the 3 bucket cards show data?** → signals are being recorded
2. **Is ULTRA_HIGH accuracy > HIGH > MEDIUM?** → confidence formula is validated
3. **Is ULTRA_HIGH expectancy positive?** → the system is profitable at the top tier
4. **Is MEDIUM expectancy near zero or negative?** → confirms that low confidence shouldn't be acted on
5. **Which outlook type has the highest accuracy?** → tells you which setups are most reliable
6. **Is avg max profit > avg gain?** → there's money left on the table (signals move further during the window than the minute-10 snapshot captures)
7. **Are samples sufficient?** → if not, keep running for more days

---

## Verification

| Check | Result |
|---|---|
| `apps/server` — `tsc --noEmit` | exit 0 |
| `apps/web` — `tsc --noEmit` | exit 0 |
| `apps/web` — `next build` | 10/10 routes (new `/admin/tracking`) |
| Unit tests (intelligence + pressure) | 46/46 pass |
| Existing `/admin` accuracy page | Untouched, still works |

Run the DB migration after deploying:
```bash
cd apps/server && npx drizzle-kit push
```

Then during market hours, check:
- Server logs: `[Tracking] Recorded: SYMBOL outlook conf=X bucket=Y`
- On lock-in (at minute 10): `[Tracking] SUCCESS/FAILED: SYMBOL change=+X% lock=Ns`
- Admin page: `localhost:3000/admin/tracking`

---

## Future work

- **Multi-day aggregation** — currently the dashboard shows one day at a time. Add a date range picker to compute cumulative bucket accuracy.
- **Statistical significance** — add a p-value or chi-squared test to determine if the accuracy difference between buckets is statistically significant (not just random).
- **Confidence formula tuning** — if the data shows that pressure matters more than momentum (or vice versa), adjust the 50/50 weights in the confidence formula.
- **Dynamic window length** — currently fixed at 10 min. Could explore per-bucket or per-outlook windows once we have enough direction-snapshot data to compare.
- **Alerting** — if daily expectancy drops below zero for 3 consecutive days, log a warning.
