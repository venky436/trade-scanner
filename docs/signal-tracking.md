# Signal Tracking System

> Validates whether the intelligence layer's confidence actually correlates with real price outcomes. Uses a fixed 15-minute evaluation window with movement analytics and confidence buckets. Admin-only — not user-facing.

## Why this exists

The intelligence layer produces a confidence score (0–1) for every stock. But confidence is only useful if higher confidence actually leads to better outcomes. This system answers:

- Are high-confidence signals actually working?
- How much do they move in 15 minutes?
- Is the system profitable in terms of expectancy?
- Which outlook types (Breakout / Bounce / Rejection / Breakdown) perform best?
- Does ULTRA_HIGH confidence outperform HIGH, which outperforms MEDIUM?

## Relationship to the existing accuracy tracker

Two parallel systems run independently:

| | Old: `signal_accuracy_log` | New: `signal_tracking` |
|---|---|---|
| **Trigger** | `score >= 9` (internal 1–10 scale) | `confidence >= 0.5` (intelligence layer 0–1 scale) |
| **Evaluation** | Target / stop-loss hit (variable time, can run all day) | Fixed 15-minute window |
| **Metrics** | SUCCESS / FAILED / NEUTRAL | Same + change %, points, max profit, max drawdown, expectancy |
| **Grouping** | By signal type (BREAKOUT / BOUNCE / etc.) | By confidence bucket (ULTRA_HIGH / HIGH / MEDIUM) × outlook type |
| **Check cadence** | Every 1 second | Every 1 minute |
| **Daily cap** | 100 | 200 |
| **Admin page** | `/admin` | `/admin/tracking` |

Both coexist. The old one validates the internal engines; this one validates the public intelligence layer.

---

## Confidence buckets

Every tracked signal is assigned a bucket based on its confidence at the time of recording:

| Bucket | Range | Expected volume | Min samples before trusting |
|---|---|---|---|
| **ULTRA_HIGH** | confidence ≥ 0.9 | 0–5/day | 20 |
| **HIGH** | 0.7 – 0.9 | 10–20/day | 50 |
| **MEDIUM** | 0.5 – 0.7 | 20–40/day | 100 |

The minimum sample rule prevents random luck from fooling us. Until a bucket has enough decided signals (SUCCESS + FAILED ≥ min), results are flagged as insufficient.

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
  ✗ confidence < 0.5      → skip
  ✗ outlook = NO_CLEAR_EDGE → skip (no directional bet)
  ✗ phase ≠ NORMAL         → skip (OPENING/STABILIZING)
  ✗ after 3:15 PM IST      → skip (need 15 min before close)
  ✗ price < ₹50            → skip
  ✗ already pending eval     → skip (activeMap has symbol)
  ✗ already tracked today at same or higher bucket → skip (trackedToday dedup)
  ✗ daily cap (200) hit     → skip
    ↓
INSERT into signal_tracking table
  status = PENDING
  bucket = ULTRA_HIGH / HIGH / MEDIUM
    ↓
... 15 minutes pass ...
    ↓
Evaluation timer (every 60 seconds)
  Find rows where status=PENDING AND now >= signal_time + 15 min
    ↓
For each:
  price_after = marketDataService.getQuote(symbol).lastPrice
  max_price = quote.high (intraday)
  min_price = quote.low (intraday)
  change_percent = ((price_after - price_at_signal) / price_at_signal) * 100
  max_profit_percent = ((max_price - price_at_signal) / price_at_signal) * 100
  max_drawdown_percent = ((min_price - price_at_signal) / price_at_signal) * 100
    ↓
Classification (±0.3% threshold):
  BUY-side (BREAKOUT_LIKELY, BOUNCE_EXPECTED):
    change ≥ +0.3%  → SUCCESS
    change ≤ -0.3%  → FAILED
    else             → NEUTRAL

  SELL-side (REJECTION_POSSIBLE, BREAKDOWN_RISK):
    change ≤ -0.3%  → SUCCESS
    change ≥ +0.3%  → FAILED
    else             → NEUTRAL
    ↓
UPDATE row with all fields + evaluatedAt
Remove from activeMap (evaluation lifecycle only — trackedToday retains the symbol)
```

### Market close cleanup

After 3:30 PM IST, any remaining PENDING signals are evaluated using the last known price and classified normally. They don't expire as NEUTRAL by default — they still get the full ±0.3% classification.

---

## Database schema

Table: `signal_tracking`

```sql
id                  SERIAL PRIMARY KEY
symbol              VARCHAR(50)    NOT NULL
signal_time         TIMESTAMP      NOT NULL
price_at_signal     NUMERIC(12,2)  NOT NULL

outlook             VARCHAR(30)    NOT NULL   -- BREAKOUT_LIKELY / BOUNCE_EXPECTED / etc.
confidence          NUMERIC(5,4)   NOT NULL   -- 0.5000 – 1.0000
confidence_bucket   VARCHAR(15)    NOT NULL   -- ULTRA_HIGH / HIGH / MEDIUM
zone                VARCHAR(20)    NOT NULL   -- NEAR_RESISTANCE / NEAR_SUPPORT
bias                VARCHAR(10)    NOT NULL   -- BULLISH / BEARISH / NEUTRAL

status              VARCHAR(10)    NOT NULL DEFAULT 'PENDING'

-- Filled after 15 minutes
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
  success: number;
  failed: number;
  neutral: number;
  accuracy: number;        // success / (success + failed) * 100
  avgGain: number;         // avg change_percent for SUCCESS signals
  avgLoss: number;         // avg |change_percent| for FAILED signals
  avgMaxProfit: number;    // avg max_profit_percent across all evaluated
  avgMaxDrawdown: number;  // avg max_drawdown_percent across all evaluated
  expectancy: number;      // (winRate * avgGain) - (lossRate * avgLoss)
  riskReward: number;      // |avgGain / avgLoss|
  sampleSufficient: boolean;
  minSampleRequired: number;
  byOutlook: Record<string, { total: number; wins: number; rate: number }>;
}
```

### Expectancy (the key metric)

```
Expectancy = (WinRate × AvgGain) − (LossRate × AvgLoss)
```

Example:
```
ULTRA_HIGH:
  WinRate = 72% (0.72)
  AvgGain = +0.8%
  AvgLoss = -0.3%

  Expectancy = (0.72 × 0.8) − (0.28 × 0.3)
             = 0.576 − 0.084
             = +0.492%
```

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
│ 15-minute time-based evaluation                               │
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
│ │ 15W 8L 5N    │ │ 38W 29L 12N  │ │ 18W 27L 21N │          │
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
- **Signals table**: color-coded STATUS column — green SUCCESS, red FAILED, zinc NEUTRAL, amber PENDING. Shows max profit ↑ and max drawdown ↓ columns.
- **Auto-refresh**: polls every 30 seconds
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
| `apps/server/src/services/signal-tracking.service.ts` | **NEW** — `createSignalTrackingService()` factory: recordSignal, evaluate (60s timer), evaluateMarketClose, getMetrics, getRecentSignals |
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
| `IST time >= 15:15` | Need 15 min before market close at 15:30 |
| `price < ₹50` | Penny stocks are unreliable |
| `activeMap.has(symbol)` | Signal still pending 15-min evaluation |
| `trackedToday` same or lower bucket | Prevents duplicate entries at same confidence level. Allows re-tracking only when stock upgrades to a higher bucket (MEDIUM → HIGH → ULTRA_HIGH). Max 3 entries per symbol per day. |
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
| `EVAL_INTERVAL_MS` | 60,000 (1 min) | Check timer cadence |
| `EVAL_WINDOW_MS` | 900,000 (15 min) | Fixed evaluation window |
| `SUCCESS_THRESHOLD` | 0.3% | Minimum move to classify as directional |
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
6. **Is avg max profit > avg gain?** → there's money left on the table (signals move more than the 15-min final price shows)
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
- After 15 min: `[Tracking] SUCCESS/FAILED: SYMBOL change=+X%`
- Admin page: `localhost:3000/admin/tracking`

---

## Future work

- **Multi-day aggregation** — currently the dashboard shows one day at a time. Add a date range picker to compute cumulative bucket accuracy.
- **Statistical significance** — add a p-value or chi-squared test to determine if the accuracy difference between buckets is statistically significant (not just random).
- **Confidence formula tuning** — if the data shows that pressure matters more than momentum (or vice versa), adjust the 50/50 weights in the confidence formula.
- **Dynamic thresholds** — if 0.3% is too tight or too loose for certain price ranges, consider price-relative thresholds (e.g. ₹50 stocks need a wider % than ₹3000 stocks).
- **Alerting** — if daily expectancy drops below zero for 3 consecutive days, log a warning.
