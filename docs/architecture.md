# Trading Scanner — Architecture & Data Flow

## Overview

A real-time intraday trading scanner that processes NSE equity stocks through a multi-stage filtering and analysis pipeline, delivering actionable BUY/SELL signals to a web dashboard.

```
NSE Instruments (~9400 stocks)
        ↓
  Phase 0: Instrument Filter (zero API calls, instant)
        ↓
  Eligible Stocks (~500)
        ↓
  EOD Job: S/R Precomputation (66 seconds)
        ↓
  Kite WebSocket (live ticks, O(1) per tick)
        ↓
  Engines: Pressure → Momentum → Pattern → Signal
        ↓
  Market Phase Control (score penalty + decision override)
        ↓
  Stock Filter (top 150 active, every 5s)
        ↓
  WebSocket Broadcast (max 150/tick)
        ↓
  Frontend (~150 stocks, real-time)
```

---

## Stage 1: Phase 0 — Instrument Filter

**File:** `apps/server/src/services/instrument.service.ts`
**When:** Server startup (once)
**Cost:** Zero API calls, O(N) scan, instant

Kite's `getInstruments()` returns ~9400 NSE equity instruments. Phase 0 reduces this to ~500 high-quality stocks before anything else runs.

**Filters applied:**

| Filter | Rule | Purpose |
|--------|------|---------|
| Priority stocks | NIFTY_50 + NIFTY_NEXT_50 + EXTRA_STOCKS (~150) | Always included, never filtered |
| Price range | ₹50 ≤ price ≤ ₹5000 | Remove penny stocks + ultra-expensive |
| Cap | Max 500 total | Keep processing manageable |

**Data source:** `last_price` from Kite instrument list — no API calls needed.

**Result:**
```
9381 instruments → 514 eligible stocks
  Priority (always included): 150
  Price filter removed: varies
  Eligible others: capped to 350
```

**These 514 stocks are used by EVERYTHING downstream:**
- Kite ticker subscription
- All engines (pressure, momentum, pattern, signal)
- EOD job
- Stock filter
- Broadcast
- Frontend

---

## Stage 2: EOD Job — S/R Precomputation

**File:** `apps/server/src/services/eod-job.service.ts`
**When:** Auto-triggered 5 seconds after server start (every deployment)
**Cost:** ~66 seconds for 514 stocks

Computes Support/Resistance levels and 20-day average volume for all eligible stocks.

**Process:**
```
For each eligible stock (batches of 10):
  → Fetch 25-day daily candles from Kite API
  → Compute S/R via clustering algorithm (levels.service.ts)
  → Compute 20-day average volume
  → Update in-memory cachedLevels (per symbol, incremental)
  → Update Redis cache (per symbol, incremental — never destroys existing data)
```

**S/R Algorithm** (`apps/server/src/services/levels.service.ts`):
1. Extract weighted price candidates (high, low, close) with **exponential recency decay** (`exp(-daysAgo/5)`)
2. Filter within ±5% of current price
3. ATR-based cluster threshold
4. Weighted clustering — group nearby price levels
5. Filter clusters with ≥2 touches
6. Post-cluster ±5% filter (cluster averages can drift)
7. Score: `weightSum / distance`
8. Select best support (below) and resistance (above)
9. Final ±5% safety check on selected levels
10. Build zones with proximity, reaction context, direction hints

**Window:** Last 10 daily candles with exponential recency decay (day 0 = 100%, day 5 = 37%, day 10 = 14%)

**Intraday S/R** (see [`docs/intraday-sr.md`](./intraday-sr.md)):
- Computed from 5-min session candles (up to 50) during market hours
- Activates after 15+ candles (~75 min), merges with daily via `selectBestSR()`
- Safety: distance ≤1.5%, touches ≥3, closer than daily — else falls back to daily

**Output:** `SupportResistanceResult { support, resistance, supportZone, resistanceZone, summary }`

**Logs:**
```
════════════════════════════════════════════════════════
[EOD JOB] STARTED at 21/3/2026, 6:10:47 pm
[EOD JOB] Symbols to process: 514 (already pre-filtered)
════════════════════════════════════════════════════════
[EOD] Progress: 100/514 (19%)
[EOD] Progress: 200/514 (39%)
...
════════════════════════════════════════════════════════
[EOD JOB] COMPLETED at 21/3/2026, 6:11:53 pm
[EOD JOB] Duration: 66 seconds
[EOD JOB] Levels computed: 247/514
════════════════════════════════════════════════════════
```

---

## Stage 3: Redis Cache (Optional)

**File:** `apps/server/src/services/redis.service.ts`
**Dependency:** Redis 7 (via Docker or brew)

Persists precomputed data across server restarts for instant load.

**Storage (Redis hashes — incremental, never bulk-replaced):**
- `market:levels` — per-symbol S/R data (`HSET market:levels TATASTEEL '{...}'`)
- `market:avgvolumes` — per-symbol 20-day avg volume
- `market:meta` — last EOD run timestamp + stats

**On server startup:**
```
1. Try loading from Redis (HGETALL market:levels)
2. If found → populate cachedLevels instantly (< 100ms)
3. If not → cachedLevels empty, EOD job fills it in ~66s
```

**Graceful fallback:** If Redis is not running, system works fully in-memory. Logs once: `[Redis] Not available — running without cache persistence`

---

## Stage 4: Live Tick Processing

**Files:**
- `apps/server/src/services/kite-ticker.service.ts` — Kite WebSocket connection
- `apps/server/src/services/market-data.service.ts` — in-memory quote store
- `apps/server/src/services/pressure.service.ts` — buy/sell pressure
- `apps/server/src/services/candle-tracker.service.ts` — 5-min candle aggregation

**On each tick (O(1) — no heavy computation):**
```
Kite tick → { symbol, lastPrice, volume, timestamp }
  ├─ marketDataService.updateQuote() → stores price, marks DIRTY
  ├─ pressureEngine.processTick() → classifies volume as buyer/seller
  └─ candleTracker.processTick() → aggregates into 5-min OHLCV
```

### Pressure Engine

Analyzes buy/sell volume pressure using 1-minute candles.

```
Every tick: classify volume delta by price direction
Every 1-min candle close:
  → Compute score: deltaStrength(0.5) + momentum(0.3) + volumeStrength(0.2)
  → Ring buffer (last 3 scores)
  → Increment version counter

After 3 candles: weighted average → signal
  > 0.6  → STRONG_BUY
  > 0.3  → BUY
  < -0.3 → SELL
  < -0.6 → STRONG_SELL
  else   → NEUTRAL
```

**Cold start:** 3 minutes (3 × 1-min candles)

### Candle Tracker

Aggregates ticks into 5-minute OHLCV candles.

```
Every tick: bucket = floor(timestamp / 300_000)
If bucket changed:
  → Close candle → ring buffer (last 3)
  → Fire callback: onCandleClose(symbol, candles)
    ├─ getMomentum(candles) → momentumMap + version++
    └─ detectPattern(candles, sr, pressure) → patternMap + version++
```

---

## Stage 5: Analysis Engines

### Momentum Engine

**File:** `apps/server/src/lib/momentum-engine.js`
**Trigger:** 5-min candle close

```
Weighted return of last 3 candles: r3(0.2) + r2(0.3) + r1(0.5)
Normalized to -1..+1

Signal: STRONG_UP (>0.6) | UP (>0.3) | FLAT | DOWN (<-0.3) | STRONG_DOWN (<-0.6)
Acceleration: r1 - r2 → INCREASING | STABLE | DECREASING
```

### Pattern Engine

**File:** `apps/server/src/lib/pattern-engine.js`
**Trigger:** 5-min candle close
**Gate:** Price must be within 0.5% of S/R level

| At Support (Bullish) | At Resistance (Bearish) | Either Side |
|---|---|---|
| Morning Star | Evening Star | Doji |
| Bullish Engulfing | Bearish Engulfing | |
| Hammer | Shooting Star | |

Requires confirming pressure (BUY pressure for bullish patterns, SELL for bearish).

### Signal Engine

**File:** `apps/server/src/lib/signal-engine.ts`
**Type:** Pure function (no state)

**Gates:**
1. Pressure must exist
2. Price within 1% of S/R level

**Rules (in order):**

| Rule | Condition | Signal |
|---|---|---|
| BREAKOUT | Near resistance + STRONG_BUY + STRONG_UP + INCREASING | BUY |
| BREAKDOWN | Near support + STRONG_SELL + STRONG_DOWN + DECREASING | SELL |
| BOUNCE | Near support + BUY pressure + UP momentum | BUY |
| REJECTION | Near resistance + SELL pressure + DOWN momentum | SELL |
| Default | None matched | WAIT |

**Confidence:** HIGH (confirming pattern) / MEDIUM (no pattern) / LOW (contradicting)

---

### Score Engine

**File:** `apps/server/src/lib/score-engine.ts`
**Type:** Pure function, called by signal worker after each signal computation

Converts all engine outputs into a single **Signal Score (1-10)** using weighted scoring.

**Weights:**

| Engine | Weight | Score Range | Mapping |
|--------|--------|-------------|---------|
| Pressure | 25% | 0-1 | STRONG_BUY=1, BUY=0.75, NEUTRAL=0.5, SELL=0.25, STRONG_SELL=0 |
| Momentum | 20% | 0-1 | STRONG_UP=1, UP=0.75, FLAT=0.5, DOWN=0.25, STRONG_DOWN=0 (+0.1 acceleration bonus) |
| S/R Proximity | 20% | 0-1 | <0.5%=1, <1%=0.8, <2%=0.6, <5%=0.3, else=0.1 (+0.1 touches bonus) |
| Pattern | 15% | 0-1 | Engulfing/Star=1, Hammer/ShootingStar=0.7, Doji=0.5, none=0 |
| Volatility | 10% | 0-1 | Range ≥3%=1, ≥2%=0.8, ≥1%=0.6, ≥0.5%=0.4, else=0.2 |
| Signal Boost | 10% | 0-1 | BUY/SELL HIGH=1, MEDIUM=0.7, LOW=0.5, WAIT=0 |

**Formula:**
```
finalScore = (pressure×0.25 + momentum×0.20 + sr×0.20 + pattern×0.15 + volatility×0.10 + signal×0.10) × 10
Clamped to 1-10, rounded
```

**Score interpretation:**

| Score | Meaning |
|-------|---------|
| 9-10 | Strong trade setup |
| 7-8 | Good setup |
| 5-6 | Watch |
| <5 | Ignore |

**Output:** `{ score: number, breakdown: ScoreBreakdown }` — stored in `SignalSnapshot`, sent to frontend via `signal.score`

---

## Stage 5.5: Market Phase Control

**File:** `apps/server/src/lib/market-phase.ts`
**Full docs:** [`docs/market-phase.md`](./market-phase.md)

Protects traders from unreliable signals during the first 10 minutes after market open (9:15 AM IST).

```
  9:15         9:20           9:25                    15:30
   │  OPENING   │ STABILIZING  │       NORMAL           │
   │  (5 min)   │  (5 min)     │      (full speed)      │
   │            │              │                         │
   │ ALL → WAIT │ Confirmed    │ No restrictions         │
   │ Score ×0.6 │ types only   │ Score ×1.0              │
   │            │ Score ×0.8   │                         │
```

**Applied in:** `setCacheEntry()` of signal-worker — after score computed, before cache write.

| Phase | Score | Decision | Accuracy Tracking |
|-------|-------|----------|-------------------|
| OPENING (0-5 min) | ×0.6 | Force WAIT, LOW confidence | Disabled |
| STABILIZING (5-10 min) | ×0.8 | Only confirmed types (BREAKOUT, BOUNCE, etc.) pass | Disabled |
| NORMAL (10+ min) | ×1.0 | No change | Enabled |
| CLOSED | ×1.0 | No change | N/A |

**Frontend:** Nav badge shows phase with countdown ("Opening (3m)"). Trade Decision Box shows phase warning banner. Score displays use `finalScore` (phase-adjusted).

---

## Stage 6: Signal Worker — Progressive Pipeline

**File:** `apps/server/src/services/signal-worker.service.ts`

Produces signals **progressively** — shows early direction immediately, upgrades as engines warm up. Same stocks upgrade in place, never downgrade.

### Four Stages

```
┌─────────────────────────────────────────────────────────────────┐
│ STAGE 1: ACTIVITY (< 1 second)                                  │
│ Input: price change only                                        │
│ Signal: BUY/SELL from price direction (lastPrice > close)       │
│ Confidence: LOW                                                 │
│ Reason: "Active: 2.3% move"                                     │
├─────────────────────────────────────────────────────────────────┤
│ STAGE 2: MOMENTUM (1-3 seconds)                                 │
│ Input: 5-min candle momentum                                    │
│ Signal: BUY/SELL refined by momentum direction                  │
│ Confidence: LOW                                                 │
│ Reason: "STRONG_UP momentum (INCREASING)"                       │
├─────────────────────────────────────────────────────────────────┤
│ STAGE 3: PRESSURE (~3 minutes)                                  │
│ Input: pressure engine (3 × 1-min candles)                      │
│ Signal: BUY/SELL confirmed by volume pressure                   │
│ Confidence: MEDIUM (normal) / HIGH (STRONG_*)                   │
│ Reason: "STRONG_BUY pressure (rising)"                          │
├─────────────────────────────────────────────────────────────────┤
│ STAGE 4: CONFIRMED (~5+ minutes)                                │
│ Input: full signal engine (S/R + pressure + momentum + pattern) │
│ Signal: BUY/SELL with type (BOUNCE/REJECTION/BREAKOUT/BREAKDOWN)│
│ Confidence: HIGH                                                │
│ Reason: "Near support at 143.25 (0.3%)"                         │
└─────────────────────────────────────────────────────────────────┘
```

### Example Progression
```
TATASTEEL:
  0s  → ACTIVITY   BUY  LOW     "Active: 2.3% move"
  2s  → MOMENTUM   BUY  LOW     "STRONG_UP momentum (INCREASING)"
  3m  → PRESSURE   BUY  HIGH    "STRONG_BUY pressure (rising)"
  5m  → CONFIRMED  BUY  HIGH    "Near support at 143.25, Support Bounce"
```

### Processing Tiers

| Tier | Interval | Symbols | Purpose |
|---|---|---|---|
| Fast Lane | 500ms | Top 100 (from stock filter) | Signals in < 2 seconds |
| Batch Worker | 1s | 200/batch, round-robin all | Full cycle ~5s for 514 stocks |
| Priority Rebuild | 30s | Re-rank by activity | Dynamic top stocks |

### Safety Mechanisms
- **No downgrades:** CONFIRMED never goes back to MOMENTUM
- **Staleness protection:** If `computedAt > 30s`, confidence auto-downgrades one level
- **Version-based skip:** Skip recomputation when pressure/momentum/pattern versions unchanged
- **Phase-aware skip:** Force recomputation when market phase changes (OPENING → STABILIZING → NORMAL)
- **Market phase control:** Penalizes scores and restricts decisions during first 10 minutes (see [market-phase.md](./market-phase.md))
- **Dedup:** Skip symbols computed within last 500ms

---

## Stage 7: Stock Filter (Frontend Eligibility)

**File:** `apps/server/src/services/stock-filter.service.ts`
**When:** Every 5 seconds
**Cost:** O(N) scan, ~2-5ms

Selects top 150 most active stocks from the 514 eligible to send to frontend.

**Filters (must pass at least one activity filter):**
1. Price change ≥ 0.5%
2. Relative volume ≥ 1.2x median
3. Price ≥ ₹50 (hard filter)

**Scoring:** `score = changePercent × 0.6 + relativeVolume × 0.4`

**Output:** Top 150 sorted by score. Index symbols always included.

---

## Stage 8: Broadcast Engine

**File:** `apps/server/src/services/broadcast.service.ts`
**When:** Every 500ms
**Cost:** Zero computation — all Map.get() reads

```
Every 500ms:
  1. Get dirty symbols (changed since last broadcast)
  2. Filter to eligible stocks only (from stock filter)
  3. Always include BUY/SELL signal stocks regardless of eligibility
  4. Sort by stage (CONFIRMED → PRESSURE → MOMENTUM → ACTIVITY) then confidence
  5. Cap at 150 symbols
  6. Build StockSnapshot for each — ALL reads from caches
  7. Send to all WebSocket clients
  8. Clear dirty set
```

---

## Stage 9: Levels Worker (Background S/R Refresh)

**File:** `apps/server/src/services/levels-worker.service.ts`
**When:** Every 2 seconds, 10 symbols/batch
**Purpose:** Continuously refreshes S/R levels during market hours

```
Every 2 seconds:
  → Process 10 symbols from priority queue
  → Fetch 15-day daily candles from Kite API
  → Compute S/R via getSupportResistance()
  → Update cachedLevels[symbol] incrementally
```

Full cycle: ~2 minutes for 514 stocks.

---

## Stage 10: WebSocket Server

**File:** `apps/server/src/ws/ws-server.ts`

**On client connect:**
- Build snapshot of eligible stocks only (~150)
- Signal from signalCache, fallback `{ action: "WAIT", reasons: ["Loading..."] }`
- Send as `{ type: "snapshot", data: StockSnapshot[] }`

**During runtime:**
- Receives broadcast every 500ms
- Sends `{ type: "market_update", data: StockSnapshot[] }` to all clients

---

## Stage 11: Frontend

**File:** `apps/web/src/context/market-data-context.tsx`

```
On "snapshot": Replace entire stockMap (~150 stocks)
On "market_update": Merge into existing stockMap (incremental)
```

**UI Layout:**
```
NAVBAR (search, theme, connection status)
↓
MARKET PULSE (3 indices: NIFTY 50, BANK NIFTY, FIN NIFTY)
↓
TOP OPPORTUNITIES (top 6 BUY/SELL, score ≥ 3, sorted by server score)
↓
WATCHLISTS (Breakout / Breakdown / Bounce / Rejection — clickable → shows top 5 stocks)
↓
KEY LEVELS (Near Support + Near Resistance, top 7 each)
```

### Signal Score in UI

**Top Opportunities** (`top-opportunities.tsx`):
- Uses `stock.signal?.finalScore ?? stock.signal?.score` (phase-adjusted, with raw fallback)
- Filters: score ≥ 3 (hides weak/empty signals)
- Sorts by score descending
- Score circle shows 1-10 with color: ≥8 green, ≥5 yellow, <5 gray
- During OPENING/STABILIZING: shows phase warning on each card

**Stock Detail** (`stock-detail.tsx`):
- Uses `finalScore` if available, then `score`, then frontend calculation
- Shows score breakdown (pressure, momentum, S/R, pattern, volatility)
- Trade Decision Box: phase overrides take highest priority (OPENING → WAIT, STABILIZING → WAIT)
- Phase warning banner shown below summary during OPENING/STABILIZING

### Watchlist Click-to-Expand

**Watchlists** (`watchlist-cards.tsx`):
- Click any category card → expands below to show top 5 stocks
- Each stock shows: symbol, change%, price, score badge
- Click stock → navigates to detail page
- Click X or same card → collapses
- Sorted by score descending within each category

---

## Complete Data Flow

```
┌──────────────────────────────────────────────────────────────┐
│ STARTUP                                                       │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  Kite getInstruments() → 9400 stocks                         │
│       ↓                                                       │
│  Phase 0 Filter (price + priority) → 514 stocks              │
│       ↓                                                       │
│  Load Redis cache (if available) → instant cachedLevels      │
│       ↓                                                       │
│  Start all workers + ticker                                   │
│       ↓                                                       │
│  Auto-trigger EOD job (5s delay) → S/R for 514 in ~66s       │
│                                                               │
├──────────────────────────────────────────────────────────────┤
│ RUNTIME (market hours)                                        │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  Kite Ticks (514 stocks, continuous)                         │
│       ↓                                                       │
│  O(1) per tick:                                               │
│    ├─ Quote update + dirty mark                               │
│    ├─ Pressure engine (1-min candles)                         │
│    └─ Candle tracker (5-min candles)                          │
│              ↓ (on candle close)                              │
│       Momentum + Pattern engines                              │
│              ↓                                                │
│  Signal Worker (progressive pipeline)                         │
│    ├─ Fast lane: 100 stocks / 500ms                           │
│    └─ Batch: 200 stocks / 1s                                  │
│    Stages: ACTIVITY → MOMENTUM → PRESSURE → CONFIRMED        │
│              ↓                                                │
│  Market Phase Control (in setCacheEntry)                       │
│    ├─ OPENING (0-5 min): WAIT forced, score ×0.6              │
│    ├─ STABILIZING (5-10 min): confirmed only, score ×0.8      │
│    └─ NORMAL (10+ min): pass through                          │
│              ↓                                                │
│  Stock Filter (every 5s) → top 150 active                    │
│              ↓                                                │
│  Broadcast (every 500ms)                                      │
│    → eligible + signal stocks                                 │
│    → sorted by stage + confidence                             │
│    → capped at 150                                            │
│    → zero computation (Map.get only)                          │
│              ↓                                                │
│  WebSocket → Frontend                                         │
│    → stockMap merge                                           │
│    → React re-renders changed rows                            │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## Timeline: What Happens When

```
Server starts:
  0ms    → Phase 0 filter: 9400 → 514 stocks (instant)
  100ms  → Redis load (if available): cachedLevels populated
  1s     → Workers started, ticker connecting
  5s     → EOD job auto-triggers

First tick arrives:
  0s     → Prices available in frontend
  <1s    → ACTIVITY signals (BUY/SELL from price direction, LOW confidence)
  1-3s   → MOMENTUM signals (from 5-min candles if available)
  3 min  → PRESSURE signals (3 × 1-min candles warm up, MEDIUM/HIGH confidence)
  ~66s   → EOD complete: 247 S/R levels ready
  5 min  → CONFIRMED signals (full engine: S/R + pressure + momentum + pattern)

During market:
  0-5 min      → OPENING phase: all signals forced WAIT, score ×0.6
  5-10 min     → STABILIZING phase: only confirmed types, score ×0.8
  10+ min      → NORMAL phase: full speed, no restrictions
  Every 500ms  → Broadcast to clients
  Every 5s     → Stock filter re-evaluates active stocks
  Every 30s    → Priority symbols rebuilt
  Continuous   → Signals progressively upgrade in place
```

---

## Performance Numbers

| Metric | Value |
|---|---|
| Instruments loaded | ~9400 |
| After Phase 0 filter | ~514 |
| EOD job duration | ~66 seconds |
| S/R levels computed | ~247 |
| Tick processing | O(1) per tick |
| Signal fast lane | 100 stocks / 500ms |
| Signal batch | 200 stocks / 1s |
| Broadcast payload | ~150 stocks × 200 bytes = ~30KB |
| Signal score computation | O(1) per symbol (6 weighted lookups) |
| Frontend stocks | ~150 (top active) |
| Memory usage | ~10MB for all caches |

---

## Key Design Principles

1. **Filter first, compute later** — 9400 → 514 → 150 → 10. Each stage reduces work.
2. **Zero API calls for filtering** — Phase 0 uses only local instrument data
3. **O(1) tick path** — No heavy computation on market ticks
4. **Show fast, improve later** — ACTIVITY signals in <1s, CONFIRMED in ~5min
5. **Never downgrade** — Once CONFIRMED, stays CONFIRMED
6. **Cache everything** — All broadcast reads are Map.get(), zero computation
7. **Incremental Redis** — Per-symbol HSET, never bulk-replace
8. **Staleness protection** — Signals >30s auto-downgrade confidence
9. **Stage-sorted broadcast** — CONFIRMED signals sent first
10. **Never empty UI** — Fallback "Loading..." signal prevents blank columns
11. **Market phase control** — First 10 minutes penalized: score ×0.6/×0.8, WAIT forced, accuracy tracking disabled
