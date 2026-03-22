# Intraday Support/Resistance Engine

## Overview

The intraday S/R engine computes support and resistance levels from **5-minute candles** accumulated during the current trading session. It runs alongside the existing daily S/R engine (10-day candles) and automatically switches to intraday levels when they are closer to the current price and meet strict validation criteria.

```
Daily S/R  = context (where were key levels historically?)
Intraday S/R = execution (where are key levels RIGHT NOW?)
```

---

## Why We Built It

Daily S/R levels are computed from 10 days of daily candles. During an active trading session, prices can move 2-5% from their daily levels, making them stale. A stock that opened at support may now be trading in the middle of nowhere — the daily support is far below, and daily resistance is far above. But intraday, price has been bouncing off a specific 5-minute level 4 times. That's the real execution level.

**Example:**
```
TATASTEEL daily S/R:    Support ₹143, Resistance ₹148 (from 10-day candles)
Current price:          ₹145.50
Intraday reality:       Price bounced off ₹145.20 four times in the last hour
                        → ₹145.20 is the real intraday support
```

Without intraday S/R, the system would say "price is far from both levels" (WAIT). With intraday S/R, it detects the ₹145.20 bounce zone and can signal a BOUNCE setup.

---

## Architecture

```
Market Open (9:15 AM)
  │
  │  First 75 minutes: Daily S/R only (not enough 5-min candles)
  │
  │  After 15+ candles (~75 min):
  │    ↓
  │  5-min candle closes
  │    ↓
  │  Compute intraday S/R from session candles
  │    ↓
  │  Store in intradayLevels[symbol]
  │    ↓
  │  Signal worker: merge daily + intraday
  │    ├─ Intraday closer + valid? → use intraday
  │    └─ Else → use daily (fallback)
  │    ↓
  │  Signal includes srType: "INTRADAY" | "DAILY"
  │    ↓
  │  Frontend: shows which type is active
  │
  │  Every 5 min: intraday levels recomputed with latest candles
  │
Market Close (3:30 PM)
  │
  │  Next day: session candles reset (IST date check)
```

---

## Data Flow

```
Kite Tick
  ↓
Candle Tracker
  ├─ completed[] (ring buffer, last 3) → Momentum + Pattern engines
  └─ sessionCandles[] (up to 75 today) → Intraday S/R engine
                                            ↓
                                      getIntradaySR(candles, price)
                                            ↓
                                      intradayLevels[symbol]
                                            ↓
                                      Signal Worker
                                        selectBestSR(daily, intraday, price, candleCount)
                                            ↓
                                      ┌─────────────────────────┐
                                      │ Safety checks:          │
                                      │ • candleCount >= 15     │
                                      │ • distance <= 1.5%      │
                                      │ • touches >= 3          │
                                      │ • closer than daily     │
                                      └─────────┬───────────────┘
                                                │
                                      ┌─────────┴───────────┐
                                      │ Pass         │ Fail  │
                                      ▼              ▼       │
                                 Use intraday   Use daily    │
                                 srType: "INTRADAY"  srType: "DAILY"
```

---

## Session Candle Storage

The candle tracker maintains two separate candle stores per symbol:

| Store | Purpose | Size | Reset |
|-------|---------|------|-------|
| `completed[]` | Momentum + Pattern engines | Last 3 candles (ring buffer) | Never (rolling) |
| `sessionCandles[]` | Intraday S/R computation | Up to 75 candles (~6.25 hours) | New trading day (IST) |

**Session reset logic:**
```ts
const today = getISTDate(); // "3/23/2026" in IST
if (state.sessionDate !== today) {
  state.sessionCandles = [];  // clear previous day's candles
  state.sessionDate = today;
}
```

This prevents previous day's candle data from leaking into today's intraday S/R computation.

---

## Intraday S/R Computation

**File:** `apps/server/src/services/intraday-levels.service.ts`

Reuses the existing `getSupportResistance()` function with intraday-tuned parameters:

| Parameter | Daily S/R | Intraday S/R |
|-----------|-----------|--------------|
| Candle source | 10 daily candles (25-day fetch) | Up to 50 five-minute session candles |
| Window size | 10 | 50 |
| Distance filter | +/- 5% | +/- 5% (same, but exponential decay naturally tightens) |
| Cluster threshold | ATR * 0.5 | ATR * 0.5 (same, but ATR is smaller on 5-min candles) |
| Min touches | 2 | 2 (but merge logic requires 3) |
| Recency decay | exp(-daysAgo/5) | exp(-daysAgo/5) (daysAgo = candle index, recent candles dominate) |

**Why reuse the same function?**
The `getSupportResistance()` function is timeframe-agnostic — it works on any OHLC candle data. The exponential decay naturally adapts: with 50 five-minute candles, only the last ~15 have significant weight, which means the most recent 1-2 hours of price action dominate. This is exactly what intraday traders need.

---

## Merge Logic (Daily + Intraday)

**File:** `apps/server/src/services/intraday-levels.service.ts` — `selectBestSR()`

For each side (support and resistance) independently:

```
1. Is intraday available?
   └─ No → use daily

2. Does intraday pass safety checks?
   ├─ Session candle count >= 15?
   ├─ Distance from price <= 1.5%?
   └─ Touches >= 3?
   └─ Any check fails → use daily

3. Is intraday closer than daily?
   ├─ Yes → use intraday
   └─ No → use daily
```

**Per-side merging:** Support and resistance are evaluated independently. It's possible to use intraday support with daily resistance (or vice versa) if one side has better intraday data than the other.

**Example merge:**
```
Daily:    Support ₹143.00 (2.1% away)    Resistance ₹148.00 (1.8% away)
Intraday: Support ₹145.20 (0.2% away, 4 touches)    Resistance: null

Result:   Support ₹145.20 (INTRADAY)     Resistance ₹148.00 (DAILY)
srType:   "INTRADAY" (because at least one side uses intraday)
```

---

## Safety Checks

| Check | Rule | Why |
|-------|------|-----|
| **Early market guard** | `sessionCandles < 15` → daily only | First ~75 minutes don't have enough data for reliable intraday levels |
| **Distance check** | `intradayDist <= 1.5%` | Prevents far intraday noise from overriding closer daily levels |
| **Touch validation** | `touches >= 3` | Requires multiple price interactions to confirm a level, not just a single bounce |
| **Closer than daily** | `intradayDist < dailyDist` | Only switch if intraday is genuinely closer to current price |
| **Session reset** | IST date comparison | Prevents previous day's candles from contaminating today's levels |
| **Default fallback** | Any check fails → daily | Daily S/R is always the safe default |

---

## Timeline: What Happens During a Trading Day

```
9:15 AM   Market opens
          Session candles: 0
          S/R source: DAILY only

9:20 AM   First 5-min candle closes
          Session candles: 1
          S/R source: DAILY only (need 15+)

10:30 AM  15th candle closes (~75 min after open)
          Session candles: 15
          Intraday S/R computed for first time
          S/R source: INTRADAY if valid, else DAILY

10:35 AM  16th candle closes
          Intraday S/R recomputed with 16 candles
          Levels may shift as more data accumulates

12:00 PM  33 candles accumulated
          Intraday S/R well-established
          Most active stocks show INTRADAY levels

3:30 PM   Market closes
          Session candles: ~75
          S/R source: INTRADAY (mature levels)

Next day  Session candles reset to 0
          S/R source: DAILY only (until 15+ candles)
```

---

## Frontend Display

**Stock Detail — Key Levels card:**

Shows a badge next to "Key Levels" header:
- `INTRADAY` (blue badge) — when intraday levels are active
- `DAILY` (grey badge) — when using daily levels (default/fallback)

The badge only appears when the signal has an `srType` field (CONFIRMED stage signals with S/R context).

---

## Files

| File | Role | Changed |
|------|------|---------|
| `apps/server/src/services/candle-tracker.service.ts` | Added `sessionCandles[]` + IST date reset | Modified |
| `apps/server/src/services/intraday-levels.service.ts` | `getIntradaySR()` + `selectBestSR()` | New |
| `apps/server/src/services/signal-worker.service.ts` | Merge daily + intraday in `computeForSymbol()` | Modified |
| `apps/server/src/index.ts` | Wire intraday computation in `onCandleClose` | Modified |
| `apps/server/src/lib/types.ts` | Added `srType` to `SignalResult` | Modified |
| `apps/web/src/lib/types.ts` | Added `srType` to `SignalResult` | Modified |
| `apps/web/src/components/stock-detail.tsx` | INTRADAY/DAILY badge | Modified |

**Unchanged files:**
- `levels.service.ts` — `getSupportResistance()` reused as-is
- `eod-job.service.ts` — daily S/R computation unchanged
- `levels-worker.service.ts` — daily S/R refresh unchanged
- `momentum-engine.ts` — uses `completed[]` (3 candles), not `sessionCandles`
- `pattern-engine.ts` — same
- `broadcast.service.ts` — reads from signal cache, no direct S/R access
- `redis.service.ts` — daily cache unchanged

---

## Performance

| Metric | Value |
|--------|-------|
| Intraday S/R computation | < 1ms per symbol (50 candles, pure function) |
| Frequency | Every 5 min per symbol (on candle close) |
| Memory per symbol | ~75 candles × ~50 bytes = ~3.75 KB |
| Total memory (500 symbols) | ~1.8 MB |
| Session candle cap | 75 (prevents unbounded growth) |

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Reuse `getSupportResistance()` | Proven algorithm, no new bugs, consistent behavior across timeframes |
| Per-side merging | Support and resistance have independent quality — merge the best of each |
| 15-candle minimum | 75 minutes of data ensures at least a few meaningful price clusters |
| 1.5% distance cap | Prevents weak intraday levels from overriding strong daily levels |
| 3-touch minimum | Single/double bounces are noise — 3+ touches confirm a real level |
| Session candles separate from completed | Momentum/pattern engines need exactly 3 candles — no interference |
| IST date reset | Strict timezone-aware check prevents cross-day contamination |
| `srType` on signal | Frontend can show traders which type of level they're seeing |
| Optional config getters | Backward compatible — signal worker works without intraday if not wired |
