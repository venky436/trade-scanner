# Momentum Engine

## What It Does

The Momentum Engine computes **price momentum, acceleration, and quality** from recent candles of a stock. It answers three questions:

1. **Which way is price moving?** — A weighted signal from STRONG_DOWN to STRONG_UP (3-candle velocity).
2. **Is that movement speeding up or slowing down?** — Sliding-window acceleration: INCREASING, DECREASING, or STABLE.
3. **How trustworthy is the move?** — Quality score: velocity adjusted by a multiplier based on signal + acceleration combo.

The engine is a pure function (`getMomentum(candles)`) with no state, no async, and no external dependencies. It runs alongside pattern detection using the same 5-minute candle data already fetched from Kite.

---

## Why We Built It

The Pressure Engine tells us about buy/sell volume imbalance. The Pattern Engine detects candlestick formations. But neither tells us whether the price itself is accelerating in a direction. A stock can have balanced volume (neutral pressure) while the price steadily drifts toward a support level — momentum catches that.

### Why It's a Pure Function (Not a Service)

Unlike the Pressure Engine, which needs tick-by-tick state, momentum only needs the last 3 candles. There's nothing to accumulate over time. A pure function is simpler, testable, and avoids another stateful service.

### Why 3 Candles for Velocity

Fewer than 3 and there's no acceleration to measure. More than 3 adds lag without improving the signal — we care about what's happening now, not the last hour. Three candles of 5-minute data covers a 15-minute window, which is responsive enough for near-S/R decision-making.

### Why 4 Candles for Acceleration

The acceleration calculation uses a sliding window: it compares the velocity of the current 3-candle window (`v_now`) against the previous shifted window (`v_prev`). This requires 4 candles total. When only 3 candles are available (early in the session), it falls back to the simpler `r1 - r2` method.

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

### 6. Acceleration (Sliding Window)

Uses two overlapping velocity windows to detect true trend change:

```
If 4+ candles available:
  v_now  = r3 × 0.2 + r2 × 0.3 + r1 × 0.5   (current window)
  v_prev = r4 × 0.2 + r3 × 0.3 + r2 × 0.5   (previous window)
  accelerationRaw = v_now - v_prev

If only 3 candles (fallback):
  accelerationRaw = r1 - r2
```

| Condition | Acceleration |
|-----------|-------------|
| accelerationRaw > 0.002 | `INCREASING` — momentum is building |
| accelerationRaw < -0.002 | `DECREASING` — momentum is fading |
| else | `STABLE` — momentum is steady |

The threshold `0.002` (0.2%) prevents noise from causing false acceleration signals while still being responsive enough to detect real momentum changes. The original threshold of 0.001 was too sensitive (triggered on minor fluctuations); a brief experiment at 0.003 over-filtered. The 0.002 middle ground requires a meaningful ~0.2% shift in weighted momentum between windows, filtering noise while preserving genuine directional changes. The sliding window approach is more reliable than simple `r1 - r2` because it compares two full velocity calculations rather than two individual candle returns.

### 7. Quality Layer

The quality score adjusts the momentum value based on how the signal and acceleration interact:

```
qualityMultiplier = based on signal + acceleration combo:
```

| Signal | Acceleration | Multiplier | Meaning |
|--------|-------------|------------|---------|
| UP / STRONG_UP | INCREASING | ×1.10 | Move is strengthening — trust it |
| UP / STRONG_UP | DECREASING | ×0.90 | Move is fading — be cautious |
| DOWN / STRONG_DOWN | DECREASING | ×1.10 | Selling is strengthening — trust it |
| DOWN / STRONG_DOWN | INCREASING | ×0.90 | Selling is fading — possible reversal |
| FLAT | INCREASING | ×1.05 | New move forming — watch closely |
| FLAT | DECREASING | ×1.05 | New move forming (downside) — watch closely |
| Any other combo | — | ×1.00 | No adjustment |

```
quality = value × qualityMultiplier
```

The quality field is available for future use in scoring and signal filtering to distinguish strong, reliable moves from fading ones.

### 8. Output

```typescript
interface MomentumResult {
  value: number;                     // -1 to +1 (0 = no momentum)
  signal: MomentumSignal;            // "STRONG_UP" | "UP" | "FLAT" | "DOWN" | "STRONG_DOWN"
  acceleration: MomentumAcceleration; // "INCREASING" | "DECREASING" | "STABLE"
  accelerationRaw: number;           // numeric acceleration value
  quality: number;                   // value × quality multiplier
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
    "MCX:GOLD25APRFUT": { "value": 0.72, "signal": "STRONG_UP", "acceleration": "INCREASING", "accelerationRaw": 0.0028, "quality": 0.79 },
    "MCX:SILVER25MAYFUT": { "value": -0.45, "signal": "DOWN", "acceleration": "STABLE", "accelerationRaw": 0.0003, "quality": -0.45 }
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
| Pure function, not a service | No state needed — only uses recent candles |
| Piggybacked on patterns endpoint | Avoids duplicate Kite API calls, shares candle data and cache |
| Weighted 0.2/0.3/0.5 | Same weighting scheme as Pressure Engine — recent candles weighted more |
| 0.3% normalization divisor | A 0.3% move in 5-minute candles is meaningful directional commitment |
| Dead zone at ±0.3 | Filters noise from low-volatility periods |
| 0.2% acceleration threshold | Prevents false acceleration signals from noise — raised from 0.1% which triggered on random candle-to-candle variation; tuned down from 0.3% which over-filtered |
| Sliding window acceleration | Compares two full velocity windows (v_now vs v_prev) for more reliable trend change detection than simple r1-r2 |
| 3-candle fallback for acceleration | Gracefully handles early session when only 3 candles available |
| Quality multiplier | Distinguishes strong reliable moves (UP+INCREASING) from fading ones (UP+DECREASING) without changing existing signal/score logic |
| Full candle array passed to engine | Engine takes last 3-4 internally — caller doesn't need to slice |
| FLAT badge hidden | Consistent with Pressure Engine — only show actionable signals |
