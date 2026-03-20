# Pressure Detection Engine

## What It Does

The Pressure Engine infers **buy/sell pressure** for each stock in real time. Since the Kite API does not provide separate buy and sell volume, we estimate buyer and seller activity by looking at the **direction of price movement** on each tick. If the price goes up between ticks, the volume traded in that interval is attributed to buyers. If the price goes down, it's attributed to sellers.

The engine outputs a signal per symbol — one of `STRONG_BUY`, `BUY`, `NEUTRAL`, `SELL`, or `STRONG_SELL` — along with a numeric value, trend direction, and confidence score. This data is broadcast to the frontend via WebSocket and exposed through a REST endpoint.

---

## Why We Built It This Way

### The Problem with Kite Data

Kite's tick data gives us `last_price` and cumulative `volume` — but no breakdown of buy-side vs sell-side volume. We can't call an order book API on every tick (latency, rate limits), so we need a heuristic that runs locally with zero external calls.

### Volume Direction Heuristic

The idea is simple: if the price moved **up** since the last tick, whoever traded that volume was likely a buyer (they pushed the price up). If the price moved **down**, it was likely a seller. This is a well-known approximation used in volume delta analysis.

### Running Average Instead of 20-Day Historical

The spec originally called for `avgVolume20 / 375` (20-day average volume divided by market minutes) for normalization. Fetching 20-day historical data per symbol on startup adds complexity and latency. Instead, we use a **running estimate**: `totalVolumeProcessed / elapsedMinutes`. After a few minutes this converges to a good approximation, and since the engine already requires 3 candle closes (~3 minutes) before producing any output, the estimate is warm by first use.

---

## Architecture

```
Kite Ticker
    │
    │  onTick(symbol, quote)
    ▼
Pressure Engine (per-symbol state)
    │
    │  processTick() — O(1), no async
    │  closeCandle() — every 60s
    │  getPressure() — returns result after 3 candles
    │
    ├──► Broadcast Engine ──► WebSocket clients (pressure field on each snapshot)
    └──► REST endpoint     ──► GET /api/stocks/pressure
```

### Files

| File | Role |
|------|------|
| `apps/server/src/services/pressure.service.ts` | Core engine — tick processing, candle scoring, signal generation |
| `apps/server/src/lib/types.ts` | `PressureResult`, `PressureSignal`, `PressureTrend` types |
| `apps/server/src/services/kite-ticker.service.ts` | Added `onTick` callback to forward ticks to the engine |
| `apps/server/src/services/broadcast.service.ts` | Attaches `pressure` field to each WebSocket snapshot |
| `apps/server/src/routes/stocks.route.ts` | `GET /api/stocks/pressure` endpoint |
| `apps/server/src/server.ts` | Threads `getPressureEngine` through server deps |
| `apps/server/src/index.ts` | Wires engine creation, ticker callback, broadcast, and route |
| `apps/web/src/lib/types.ts` | Frontend mirror of pressure types |
| `apps/web/src/components/sr-cards.tsx` | Displays pressure badges on near-S/R stocks |

---

## How It Works — Step by Step

### 1. Tick Processing (`processTick`)

Every tick from Kite is forwarded to the engine. For each symbol, we maintain a `TickState` object:

```
prevPrice, prevVolume     ← tracking between ticks
buyerVolume, sellerVolume ← accumulated within current 1-min candle
delta                     ← buyerVolume - sellerVolume (net)
candleVolume              ← total volume in current candle
candleOpenPrice/Time      ← candle boundaries
totalVolumeProcessed      ← lifetime volume (for running average)
firstTickTime             ← when we first saw this symbol
candleScores[]            ← ring buffer of last 3 candle scores
```

On each tick:

1. Compute `volumeDiff = tick.volume - prevVolume`. If ≤ 0 (volume reset or duplicate), skip classification.
2. If price went **up** → add `volumeDiff` to `buyerVolume` and `delta`.
3. If price went **down** → add `volumeDiff` to `sellerVolume` and subtract from `delta`.
4. Accumulate into `candleVolume` and `totalVolumeProcessed`.
5. If 60 seconds have passed since `candleOpenTime`, close the candle.
6. Update `prevPrice` and `prevVolume`.

This is O(1) per tick — no loops, no async, no allocations.

### 2. Candle Close (`closeCandle`)

When a 1-minute candle closes, we score it using three components:

#### Delta Strength (weight: 50%)
```
deltaStrength = delta / (buyerVolume + sellerVolume)
```
This is the net buy/sell ratio. Ranges from -1 (all sellers) to +1 (all buyers). This is the primary signal.

#### Price Momentum (weight: 30%)
```
priceDiff = (currentPrice - candleOpenPrice) / candleOpenPrice
momentum = clamp(priceDiff / 0.003, -1, 1)
```
How much did the price actually move this candle? We normalize against 0.3% (a meaningful 1-minute move). This catches cases where volume is split but price clearly moved one direction.

#### Volume Strength (weight: 20%)
```
avgCandleVolume = totalVolumeProcessed / elapsedMinutes
volumeStrength = clamp(candleVolume / avgCandleVolume, 0, 1)
```
Was this candle's volume above or below average? High-volume candles carry more conviction. This component is signed by `deltaStrength` — high volume only amplifies the existing direction, it doesn't create one.

#### Combined Score
```
combined = deltaStrength * 0.5 + momentum * 0.3 + volumeStrength * 0.2 * sign(deltaStrength)
```

The score is pushed into a ring buffer (`candleScores`). Only the last 3 scores are kept.

After scoring, the candle state resets: buyer/seller volumes go to zero, delta resets, and a new candle begins.

### 3. Signal Generation (`getPressure`)

Only returns a result after **3 candle scores** exist (~3 minutes of market data).

#### Weighted Average
Recent candles matter more:
```
value = scores[0] * 0.2 + scores[1] * 0.3 + scores[2] * 0.5
```
The most recent candle gets 50% weight.

#### Consistency Boost
If all 3 candles agree in direction (all positive or all negative), the value is boosted by 15%:
```
if (allSameSign) value *= 1.15
```
Sustained pressure in one direction is a stronger signal than a mix.

#### Noise Filter
Small values are noise. If `|value| < 0.3`, it gets zeroed out to `NEUTRAL`. This prevents flickering signals on low-activity stocks.

#### Signal Mapping
```
 value > 0.6  → STRONG_BUY
 value > 0.3  → BUY
 value < -0.6 → STRONG_SELL
 value < -0.3 → SELL
 else         → NEUTRAL
```

#### Trend
- All 3 candle scores positive → `rising`
- All 3 candle scores negative → `falling`
- Mixed → `mixed`

#### Confidence
Simply `|value|` — how far from neutral. 0 = no confidence, 1 = maximum.

### 4. Output Format

```typescript
interface PressureResult {
  value: number;       // -1 to 1 (0 = neutral)
  signal: PressureSignal;  // "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL"
  trend: PressureTrend;    // "rising" | "falling" | "mixed"
  confidence: number;      // 0 to 1
}
```

---

## Data Flow

### Backend Wiring (in `index.ts`)

```
1. createPressureEngine()

2. Kite ticker gets an onTick callback:
   onTick(symbol, quote) → pressureEngine.processTick(symbol, {
     last_price: quote.lastPrice,
     volume: quote.volume,
     timestamp: quote.timestamp,
   })

3. Broadcast engine gets a getPressure callback:
   getPressure(symbol) → pressureEngine.getPressure(symbol)
   → attached as `pressure` field on each StockSnapshot in WebSocket messages

4. REST route gets engine reference:
   GET /api/stocks/pressure → pressureEngine.getAllPressure()
```

### Frontend Display

Pressure data arrives on `StockData` via WebSocket (`pressure` field). In the **S/R Cards** component, stocks near support or resistance display a colored badge:

| Signal | Badge | Color |
|--------|-------|-------|
| `STRONG_BUY` | S.BUY | bright green |
| `BUY` | BUY | green |
| `NEUTRAL` | (hidden) | — |
| `SELL` | SELL | red |
| `STRONG_SELL` | S.SELL | bright red |

The badge appears next to the reaction badge (APPROACHING/REJECTING) on each stock row. Neutral pressure is hidden to avoid visual clutter.

---

## API

### `GET /api/stocks/pressure`

Returns pressure for all symbols that have warmed up (3+ candle closes).

**Response:**
```json
{
  "pressure": {
    "MCX:GOLD25APRFUT": {
      "value": 0.45,
      "signal": "BUY",
      "trend": "rising",
      "confidence": 0.45
    },
    "MCX:SILVER25MAYFUT": {
      "value": -0.72,
      "signal": "STRONG_SELL",
      "trend": "falling",
      "confidence": 0.72
    }
  },
  "timestamp": 1710936000000
}
```

Returns `503` if the engine is not initialized (Kite not connected).

Returns `{ pressure: {}, timestamp: ... }` during the first ~3 minutes while candles warm up.

### WebSocket (`market_update` messages)

Each `StockSnapshot` in the `data` array now includes an optional `pressure` field:

```json
{
  "type": "market_update",
  "data": [
    {
      "symbol": "MCX:GOLD25APRFUT",
      "price": 87250.00,
      "change": 0.35,
      "volume": 12450,
      "pressure": {
        "value": 0.45,
        "signal": "BUY",
        "trend": "rising",
        "confidence": 0.45
      }
    }
  ],
  "timestamp": 1710936000000
}
```

The `pressure` field is `undefined` (omitted from JSON) until the symbol has 3 candle scores.

---

## Warm-Up Period

The engine produces no output for the first ~3 minutes per symbol. This is by design:

1. **First tick**: Initializes state, sets baseline price and volume.
2. **Minutes 1-3**: Accumulates tick data, closes candles, builds up 3 candle scores.
3. **After 3rd candle close**: `getPressure()` starts returning results.

During warm-up, the REST endpoint returns an empty object and WebSocket snapshots omit the pressure field. The running volume average also becomes more accurate over time.

---

## Design Decisions Summary

| Decision | Rationale |
|----------|-----------|
| Price-direction heuristic for buy/sell | No order book data from Kite; standard volume delta approach |
| Running volume average instead of 20-day historical | Zero external API calls, warm after 3 minutes |
| 1-minute candles | Balances responsiveness with noise reduction |
| 3-candle ring buffer | ~3 minutes of context, enough for trend detection without lag |
| Weighted average (0.2/0.3/0.5) | Recent data weighted more heavily for responsiveness |
| Noise filter at 0.3 | Prevents signal flickering on low-activity symbols |
| Consistency boost at 15% | Rewards sustained directional pressure |
| O(1) per tick, no async | Must not block the ticker event loop |
