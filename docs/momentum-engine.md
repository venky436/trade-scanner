# Momentum Engine

## What It Does

The Momentum Engine computes **price momentum and acceleration** from the last 3 candles of a stock. It answers two questions:

1. **Which way is price moving?** — A weighted signal from STRONG_DOWN to STRONG_UP.
2. **Is that movement speeding up or slowing down?** — Acceleration: INCREASING, DECREASING, or STABLE.

The engine is a pure function (`getMomentum(candles)`) with no state, no async, and no external dependencies. It runs alongside pattern detection using the same 5-minute candle data already fetched from Kite.

---

## Why We Built It

The Pressure Engine tells us about buy/sell volume imbalance. The Pattern Engine detects candlestick formations. But neither tells us whether the price itself is accelerating in a direction. A stock can have balanced volume (neutral pressure) while the price steadily drifts toward a support level — momentum catches that.

### Why It's a Pure Function (Not a Service)

Unlike the Pressure Engine, which needs tick-by-tick state, momentum only needs the last 3 candles. There's nothing to accumulate over time. A pure function is simpler, testable, and avoids another stateful service.

### Why 3 Candles

Fewer than 3 and there's no acceleration to measure. More than 3 adds lag without improving the signal — we care about what's happening now, not the last hour. Three candles of 5-minute data covers a 15-minute window, which is responsive enough for near-S/R decision-making.

---

## Architecture

```
GET /api/stocks/patterns
    │
    │  (already fetching 5-min candles for pattern detection)
    │
    ├──► detectPattern(last3)  → patterns{}
    └──► getMomentum(candles)  → momentum{}
    │
    ▼
Response: { patterns, momentum, timestamp }
    │
    ▼
Dashboard fetches patterns → extracts momentum → passes to SRCards
    │
    ▼
MomentumBadge on each near-S/R stock
```

No separate endpoint. No separate fetch. Momentum piggybacks on the patterns endpoint because it uses the same candle data.

### Files

| File | Role |
|------|------|
| `apps/server/src/lib/momentum-engine.ts` | Core engine — pure `getMomentum()` function |
| `apps/server/src/lib/types.ts` | `MomentumResult`, `MomentumSignal`, `MomentumAcceleration` types |
| `apps/server/src/routes/stocks.route.ts` | Calls `getMomentum()` inside the patterns endpoint |
| `apps/web/src/lib/types.ts` | Frontend mirror of momentum types |
| `apps/web/src/components/dashboard.tsx` | Extracts momentum from patterns response, passes to SRCards |
| `apps/web/src/components/sr-cards.tsx` | `MomentumBadge` component displayed on near-S/R stocks |

---

## How It Works — Step by Step

### 1. Guard

If fewer than 3 candles are provided, return `null`. No signal can be computed.

### 2. Extract Candle Returns

Take the last 3 candles and compute the **return** for each:

```
r = (close - open) / open
```

This is the percentage move within each candle. A positive `r` means the candle closed higher than it opened (bullish); negative means bearish.

### 3. Weighted Momentum

Recent candles matter more:

```
momentum = r3 * 0.2 + r2 * 0.3 + r1 * 0.5
```

Where `r1` is the most recent candle (50% weight), `r2` is the previous (30%), and `r3` is the oldest (20%). This makes the signal responsive to the latest price action while still considering context.

### 4. Normalize to [-1, +1]

```
value = clamp(momentum / 0.003, -1, 1)
```

The divisor `0.003` (0.3%) acts as a scaling factor — a 0.3% weighted momentum maps to a value of 1.0 (maximum). This threshold was chosen because a 0.3% move across 5-minute candles represents meaningful directional commitment. Anything beyond that saturates at ±1.

### 5. Signal Classification

| Condition | Signal |
|-----------|--------|
| value > 0.6 | `STRONG_UP` |
| value > 0.3 | `UP` |
| value < -0.6 | `STRONG_DOWN` |
| value < -0.3 | `DOWN` |
| else | `FLAT` |

The dead zone between -0.3 and +0.3 filters out noise — small random fluctuations that don't represent real directional movement.

### 6. Acceleration

Compares the two most recent candle returns:

```
acc = r1 - r2
```

| Condition | Acceleration |
|-----------|-------------|
| acc > 0.001 | `INCREASING` — momentum is building |
| acc < -0.001 | `DECREASING` — momentum is fading |
| else | `STABLE` — momentum is steady |

The threshold `0.001` (0.1%) prevents noise from causing false acceleration signals.

### 7. Output

```typescript
interface MomentumResult {
  value: number;                     // -1 to +1 (0 = no momentum)
  signal: MomentumSignal;            // "STRONG_UP" | "UP" | "FLAT" | "DOWN" | "STRONG_DOWN"
  acceleration: MomentumAcceleration; // "INCREASING" | "DECREASING" | "STABLE"
}
```

---

## Data Flow

### Server Side

The momentum computation runs inside the existing `GET /api/stocks/patterns` endpoint:

1. For each near-S/R symbol, 5-minute candles are fetched from Kite (already happening for patterns).
2. After pattern detection, `getMomentum(candles)` is called with the full candle array.
3. The response includes both `patterns` and `momentum` maps.

```json
{
  "patterns": {
    "MCX:GOLD25APRFUT": { "pattern": "HAMMER", "direction": "BULLISH", "strength": 1, "reason": "..." }
  },
  "momentum": {
    "MCX:GOLD25APRFUT": { "value": 0.72, "signal": "STRONG_UP", "acceleration": "INCREASING" },
    "MCX:SILVER25MAYFUT": { "value": -0.45, "signal": "DOWN", "acceleration": "STABLE" }
  },
  "timestamp": 1710936000000
}
```

Momentum shares the same cache as patterns (5-minute TTL). When patterns are recomputed, momentum is too.

### Frontend Display

The Dashboard extracts `momentum` from the patterns response and passes it to `SRCards`. Each stock in the "Near Resistance" and "Near Support" cards shows a momentum badge:

| Signal | Badge | Color | Arrow |
|--------|-------|-------|-------|
| `STRONG_UP` | S.UP | bright green | ↗ if increasing, ↘ if decreasing |
| `UP` | UP | green | ↗ if increasing, ↘ if decreasing |
| `FLAT` | (hidden) | — | — |
| `DOWN` | DOWN | red | ↗ if increasing, ↘ if decreasing |
| `STRONG_DOWN` | S.DOWN | bright red | ↗ if increasing, ↘ if decreasing |

The badge is hidden when momentum is FLAT to avoid clutter. The acceleration arrow appears next to the label — for example, `S.UP ↗` means strong upward momentum that's still increasing.

---

## How to Read the Signals

### At Resistance

| Momentum | Meaning |
|----------|---------|
| S.UP ↗ | Price charging toward resistance with acceleration — likely breakout attempt |
| UP ↘ | Moving up but losing steam — may stall at resistance |
| DOWN | Already pulling back from resistance — rejection underway |

### At Support

| Momentum | Meaning |
|----------|---------|
| S.DOWN ↗ | Falling hard toward support with acceleration — watch for a bounce or break |
| DOWN ↘ | Falling but decelerating — potential support hold |
| UP | Bouncing off support — recovery signal |

---

## Design Decisions Summary

| Decision | Rationale |
|----------|-----------|
| Pure function, not a service | No state needed — only uses last 3 candles |
| Piggybacked on patterns endpoint | Avoids duplicate Kite API calls, shares candle data and cache |
| Weighted 0.2/0.3/0.5 | Same weighting scheme as Pressure Engine — recent candles weighted more |
| 0.3% normalization divisor | A 0.3% move in 5-minute candles is meaningful directional commitment |
| Dead zone at ±0.3 | Filters noise from low-volatility periods |
| 0.1% acceleration threshold | Prevents false acceleration signals from minor fluctuations |
| Full candle array passed to engine | Engine takes last 3 internally — caller doesn't need to slice |
| FLAT badge hidden | Consistent with Pressure Engine — only show actionable signals |
