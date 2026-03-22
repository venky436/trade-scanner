# Support/Resistance Zone Engine

Computes the nearest support and resistance zones for a stock given its current
price and recent daily candles. Provides trader context — reaction behavior,
direction hints, and actionability flags — for UI display and future signal
aggregation.

**File:** `apps/server/src/services/levels.service.ts`
**Types:** `apps/server/src/lib/types.ts`
**REST endpoint:** `GET /api/stocks/levels` (in `apps/server/src/routes/stocks.route.ts`)
**Frontend:** `apps/web/src/components/sr-cards.tsx`

---

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [Function Signature](#2-function-signature)
3. [Types](#3-types)
4. [Algorithm](#4-algorithm)
5. [Trader Context Fields](#5-trader-context-fields)
6. [Worked Example](#6-worked-example)
7. [Edge Cases](#7-edge-cases)
8. [REST Endpoint](#8-rest-endpoint)
9. [Frontend Integration](#9-frontend-integration)

---

## 1. Quick Start

```ts
import { getSupportResistance } from "./services/levels.service.js";

const candles = [
  { time: 0, open: 100, high: 105, low: 95,  close: 102, volume: 1000 },
  { time: 1, open: 102, high: 108, low: 100, close: 106, volume: 1200 },
  { time: 2, open: 106, high: 107, low: 101, close: 103, volume: 900  },
  { time: 3, open: 103, high: 109, low: 99,  close: 105, volume: 1100 },
  { time: 4, open: 105, high: 110, low: 102, close: 104, volume: 1000 },
  { time: 5, open: 104, high: 106, low: 98,  close: 101, volume: 800  },
  { time: 6, open: 101, high: 107, low: 100, close: 105, volume: 1300 },
  { time: 7, open: 105, high: 108, low: 101, close: 103, volume: 950  },
];

const result = getSupportResistance(candles, 104);
// result.support     ≈ 101.89
// result.resistance  ≈ 107.36
// result.supportZone.reaction     → "APPROACHING"
// result.resistanceZone.reaction  → "REJECTING"
// result.summary → { hasNearbySupport: false, hasNearbyResistance: false }

// Custom window size:
const result5 = getSupportResistance(candles, 104, { windowSize: 5 });
```

---

## 2. Function Signature

```ts
function getSupportResistance(
  candles: Candle[],
  currentPrice: number,
  options?: SROptions,
): SupportResistanceResult;
```

| Parameter      | Type         | Description                                      |
|----------------|--------------|--------------------------------------------------|
| `candles`      | `Candle[]`   | Daily OHLCV candles. Uses last N (default 10).   |
| `currentPrice` | `number`     | Live market price to measure zones against.      |
| `options`      | `SROptions?` | Optional. `{ windowSize?: number }` (default 10) |

**Properties:**
- Pure function — no async, no DB, no network calls
- Runs in < 1 ms for 10 candles
- Only reads `high`, `low`, `close` from each candle

---

## 3. Types

### SROptions

```ts
interface SROptions {
  windowSize?: number; // default: 10
}
```

### SRZone

```ts
type Proximity     = "VERY_CLOSE" | "NEAR" | "FAR";
type Reaction      = "APPROACHING" | "REJECTING" | "NEUTRAL";
type DirectionHint = "BULLISH" | "BEARISH" | "NEUTRAL";

interface SRZone {
  min: number;              // lower bound of the zone
  max: number;              // upper bound of the zone
  level: number;            // weighted average price (the "line")
  touches: number;          // how many price points formed this cluster
  strength: number;         // score = weightSum / distance
  confidence: number;       // total accumulated weight
  distancePercent: number;  // distance from currentPrice as %
  proximity: Proximity;     // human-readable distance label
  reaction: Reaction;       // is price approaching or rejecting this zone?
  zoneScore: number;        // strength * confidence (for signal aggregation)
  isActionable: boolean;    // true if proximity is VERY_CLOSE or NEAR
  directionHint: DirectionHint; // BULLISH/BEARISH bias from reaction
}
```

### SupportResistanceResult

```ts
interface SupportResistanceResult {
  support: number | null;
  resistance: number | null;
  supportZone: SRZone | null;
  resistanceZone: SRZone | null;
  summary: {
    hasNearbySupport: boolean;    // supportZone?.isActionable
    hasNearbyResistance: boolean; // resistanceZone?.isActionable
  };
}
```

All zone fields are nullable — a stock may only have support or only resistance.

---

## 4. Algorithm

Twelve synchronous steps optimized for intraday relevance. Recent levels dominate
via exponential decay, and multiple ±5% filters ensure no stale levels leak through.

```
Candles ──> Extract Candidates ──> Filter +-5% ──> ATR Threshold
              (high/low/close        (relevance     (adaptive
               + exponential          gate)        cluster size)
                 recency)                |
           +-----------------------------+
           v
       Cluster ──> Filter >=2 ──> Filter +-5% ──> Classify ──> Score ──> Select Best
       (merge       touches      (post-cluster   S vs R       weight/     per side
        nearby)                   relevance)                  distance
                                                                 |
                                                    +------------+
                                                    v
                                         Safety ──> Cap Width ──> Trader Context ──> Result
                                         Check      (ATR-based    (reaction, score,   + summary
                                         (+-5%)      zone cap)     actionable, hint)
```

### Step 1 — Extract Weighted Candidates

From each candle (last N, default 10), extract three price points:

| Source  | Base Weight |
|---------|-------------|
| `high`  | 1.0         |
| `low`   | 1.0         |
| `close` | 0.6         |

Recency scaling uses **exponential decay** for strong intraday relevance:

```
recency = exp(-daysAgo / 5)
```

| Days Ago | Weight |
|----------|--------|
| 0        | 1.00   |
| 1        | 0.82   |
| 2        | 0.67   |
| 3        | 0.55   |
| 5        | 0.37   |
| 7        | 0.25   |
| 10       | 0.14   |

Recent levels dominate naturally. Old levels fade without an artificial floor.

### Step 2 — Filter +/-5%

Discard candidates where `abs(price - currentPrice) / currentPrice > 0.05`.

### Step 3 — ATR-Based Cluster Threshold

```
ATR       = mean(all True Ranges)
threshold = max(ATR * 0.5, currentPrice * 0.007)
```

### Step 4 — Weighted Clustering

Sort by price, merge candidates within `threshold` of the current cluster's
weighted average.

### Step 5 — Filter >= 2 Touches

Single-touch clusters are noise.

### Step 5.5 — Post-Cluster ±5% Filter

Even though individual candidates passed the ±5% filter in Step 2, cluster averages can drift outside the range after weighted merging. This step removes any clusters whose level is >5% from the current price.

### Step 6 — Classify

Support: `level < currentPrice`. Resistance: `level > currentPrice`.

### Step 7 — Score

```
score = weightSum / max(distance, currentPrice * 0.001)
```

### Step 8 — Select Best

Highest-scoring cluster per side.

### Step 8.5 — Final ±5% Safety Check

Belt-and-suspenders: after selecting the best support and resistance, validate that each is within ±5% of the current price. If not, discard it (set to null). This catches any edge case that slips through the earlier filters.

### Step 9 — Cap Zone Width

```
zoneCap  = max(ATR * 0.15, currentPrice * 0.002)
zone.min = max(zone.min, zone.level - zoneCap)
zone.max = min(zone.max, zone.level + zoneCap)
```

### Step 10 — Trader Context

Computed inside `buildZone()` with no extra loops:

**Proximity + Actionability:**
```
distancePercent = abs(level - currentPrice) / currentPrice * 100
proximity:  <=0.5% VERY_CLOSE | <=1% NEAR | >1% FAR
isActionable = proximity is VERY_CLOSE or NEAR
```

**Reaction** (uses `prevClose = candles[N-2].close`):
```
movingUp   = currentPrice > prevClose
movingDown = currentPrice < prevClose

Resistance zone:
  movingUp   && price < level  ->  APPROACHING
  movingDown && price < level  ->  REJECTING

Support zone:
  movingDown && price > level  ->  APPROACHING
  movingUp   && price > level  ->  REJECTING

Otherwise -> NEUTRAL
```

**Direction Hint** (derived from reaction + side):
```
Support  + REJECTING  ->  BULLISH  (bouncing off support)
Resistance + REJECTING  ->  BEARISH  (rejected at resistance)
Everything else         ->  NEUTRAL
```

**Zone Score** (for future signal aggregation):
```
zoneScore = strength * confidence
```

**Summary:**
```
hasNearbySupport    = supportZone?.isActionable ?? false
hasNearbyResistance = resistanceZone?.isActionable ?? false
```

---

## 5. Trader Context Fields

Quick reference for how to interpret the new fields:

| Field          | What it tells the trader                                    |
|----------------|-------------------------------------------------------------|
| `reaction`     | Is price moving toward the zone (APPROACHING) or away (REJECTING)? |
| `directionHint`| Bias: BULLISH if bouncing off support, BEARISH if rejected at resistance |
| `isActionable` | Should the UI highlight this zone? Only true within 1% of price |
| `zoneScore`    | Composite score for ranking across engines (strength * confidence) |
| `summary`      | Quick boolean check: any nearby support/resistance at all?  |

**Composability:** These fields are designed for aggregation with future engines
(Volume, Momentum, Pressure). The `zoneScore` provides a normalized input, and
`directionHint` provides a directional signal that can be combined with other
directional signals.

---

## 6. Worked Example

### Input

```
currentPrice = 104,  prevClose (candle[6].close) = 105
-> movingDown = true, movingUp = false
```

```
Day | Open | High | Low | Close | Volume
----+------+------+-----+-------+-------
 0  | 100  | 105  |  95 |  102  | 1000
 1  | 102  | 108  | 100 |  106  | 1200
 2  | 106  | 107  | 101 |  103  |  900
 3  | 103  | 109  |  99 |  105  | 1100
 4  | 105  | 110  | 102 |  104  | 1000
 5  | 104  | 106  |  98 |  101  |  800
 6  | 101  | 107  | 100 |  105  | 1300
 7  | 105  | 108  | 101 |  103  |  950
```

### Output

```json
{
  "support": 101.89,
  "resistance": 107.36,
  "supportZone": {
    "min": 100.69,
    "max": 103.09,
    "level": 101.89,
    "touches": 14,
    "strength": 4.01,
    "confidence": 8.46,
    "distancePercent": 2.03,
    "proximity": "FAR",
    "reaction": "APPROACHING",
    "zoneScore": 33.93,
    "isActionable": false,
    "directionHint": "NEUTRAL"
  },
  "resistanceZone": {
    "min": 106.16,
    "max": 108.56,
    "level": 107.36,
    "touches": 7,
    "strength": 1.52,
    "confidence": 5.09,
    "distancePercent": 3.23,
    "proximity": "FAR",
    "reaction": "REJECTING",
    "zoneScore": 7.71,
    "isActionable": false,
    "directionHint": "BEARISH"
  },
  "summary": {
    "hasNearbySupport": false,
    "hasNearbyResistance": false
  }
}
```

**Reading the output:**

- Support at **101.89** — price is falling (movingDown) and above this level,
  so reaction is **APPROACHING**. directionHint is NEUTRAL (not yet confirmed
  as a bounce). The zone is FAR (2%) so `isActionable = false`.
- Resistance at **107.36** — price is falling away from resistance,
  so reaction is **REJECTING** with a **BEARISH** hint. Also FAR (3.2%).
- Summary confirms no actionable zones nearby — both are > 1% away.

If price were at 102.3, the support zone proximity would shift to "VERY_CLOSE",
`isActionable` would become `true`, and `summary.hasNearbySupport` would be `true`.

---

## 7. Edge Cases

| Scenario                    | Result                                  |
|-----------------------------|-----------------------------------------|
| Fewer than 2 candles        | All-null + summary both false           |
| All candidates outside +/-5% | All-null + summary both false          |
| No cluster has >= 2 touches | All-null + summary both false           |
| All clusters drift outside ±5% | All-null (post-cluster filter)       |
| Best level >5% from price  | Discarded by safety check → null        |
| Only support clusters found | resistance/resistanceZone = null        |
| Only resistance clusters    | support/supportZone = null              |
| Stock at all-time high      | Likely no resistance (no price above)   |
| prevClose == currentPrice   | movingUp/Down both false -> NEUTRAL     |

---

## 8. REST Endpoint

```
GET /api/stocks/levels
```

Fetches daily candles per tracked stock from Kite API, runs
`getSupportResistance()` for each using the live price (default window: last 10 candles), and returns all results.

**Response:**
```json
{
  "levels": {
    "GOLD": { "support": 72100, "resistance": 72800, "supportZone": {...}, ... },
    "SILVER": { ... }
  },
  "timestamp": 1711000000000
}
```

**Caching:** Results are cached for 30 minutes (daily candles don't change
intraday). Cache is stored in-memory in `stocks.route.ts`.

**File:** `apps/server/src/routes/stocks.route.ts`

---

## 9. Frontend Integration

The dashboard (`apps/web/src/components/dashboard.tsx`) fetches levels once when
stocks load and renders two cards above the main stock table.

**Component:** `apps/web/src/components/sr-cards.tsx`

```
+---------------------------+  +---------------------------+
| Near Resistance           |  | Near Support              |
|                           |  |                           |
| GOLD    72,450 APPROACHING|  | SILVER  88,200 REJECTING  |
|    R: 72,800  (0.48%)     |  |  ^ S: 87,950  (0.28%)    |
|                           |  |                           |
| SILVER  88,500            |  | CRUDE   6,450  APPROACHING|
|    R: 88,750  (0.28%)     |  |    S: 6,420   (0.47%)    |
+---------------------------+  +---------------------------+
```

Each stock row shows:
- Symbol and live price (updates via WebSocket)
- Reaction badge: yellow "APPROACHING" or blue "REJECTING" (hidden if NEUTRAL)
- Direction arrow: green up-triangle (BULLISH) or red down-triangle (BEARISH)
- Level value and distance percentage

Stocks are sorted by distance ascending (closest to level first), top 3 shown.
Clicking a row navigates to the stock detail page.

**Dependencies:**

```
sr-cards.tsx
  +-- types.ts (SRZone, SupportResistanceResult, Reaction, DirectionHint)
  +-- dashboard.tsx (fetches /api/stocks/levels, passes data)
        +-- use-market-data.ts (live prices via WebSocket)
```

**Server dependency chain:**

```
stocks.route.ts  (GET /api/stocks/levels)
  +-- levels.service.ts  (getSupportResistance)
  +-- market-data.service.ts  (live prices for each symbol)
  +-- types.ts  (Candle, SRZone, SROptions, SupportResistanceResult)
```

No external packages. No async in the engine. No side effects.
