# Candlestick Pattern Engine

## What It Does

The Pattern Engine detects **candlestick reversal patterns** (Hammer, Engulfing, Morning Star, etc.) near S/R zones. It runs server-side so the home screen can display pattern badges on SR cards without the frontend fetching candle data per symbol.

The engine is a **pure function** — no state, no async, max 3 candles in, one signal out.

---

## Why We Built It This Way

### Patterns Only Matter at S/R Levels

A hammer candle in the middle of a range is noise. A hammer at a support zone that the price has bounced off 4 times before is actionable. The engine enforces a **0.5% proximity gate** — if the price isn't within 0.5% of a known support or resistance level, no pattern is emitted regardless of what the candles look like.

### Pressure Confirmation Reduces False Signals

Candlestick patterns alone have mediocre hit rates. By requiring the Pressure Engine to agree (buy pressure for bullish patterns, sell pressure for bearish patterns), we filter out patterns that form against the prevailing volume flow. The one exception is Doji, which represents indecision and requires neutral pressure instead.

### Multi-Candle Patterns Take Priority

A Morning Star (3 candles) is a stronger reversal signal than a Hammer (1 candle). The engine tries multi-candle patterns first and returns the first match. This means a stock will never show "HAMMER" when it actually has a "MORNING_STAR" forming.

---

## Architecture

```
S/R Levels Cache        Pressure Engine        Kite Historical API
    │                        │                        │
    │  supportZone           │  getPressure(symbol)   │  5-min candles
    │  resistanceZone        │                        │  (last 3)
    ▼                        ▼                        ▼
              ┌──────────────────────────┐
              │     detectPattern()      │
              │     pure function        │
              │     no state, no async   │
              └────────────┬─────────────┘
                           │
                           ▼
                    PatternSignal | null
                           │
              ┌────────────┴─────────────┐
              │                          │
              ▼                          ▼
    REST endpoint              SR Cards (frontend)
    GET /api/stocks/patterns   PatternBadge component
```

### Files

| File | Role |
|------|------|
| `apps/server/src/lib/pattern-engine.ts` | Core engine — `detectPattern()` + pattern helpers |
| `apps/server/src/lib/types.ts` | `PatternSignal`, `PatternName` types |
| `apps/server/src/routes/stocks.route.ts` | `GET /api/stocks/patterns` endpoint |
| `apps/web/src/lib/types.ts` | Frontend mirror of pattern types |
| `apps/web/src/components/dashboard.tsx` | Fetches patterns, passes to SR cards |
| `apps/web/src/components/sr-cards.tsx` | `PatternBadge` component |

---

## How It Works — Step by Step

### 1. Proximity Gate

Before any pattern analysis, the engine checks whether `currentPrice` is within 0.5% of a support or resistance level:

```
abs(price - level) / price <= 0.005
```

- If **neither** is within range → return `null` immediately
- If **both** qualify → pick the closer one
- The chosen side becomes the **context**: `"SUPPORT"` or `"RESISTANCE"`

This filters ~80% of symbols on each scan, since most stocks aren't sitting right at a level.

### 2. Pattern Detection (Priority Order)

Patterns are tried in descending strength. The first match wins.

**At SUPPORT (bullish reversal):**

| Priority | Pattern | Candles | Strength |
|----------|---------|---------|----------|
| 1 | Morning Star | 3 | 2 |
| 2 | Bullish Engulfing | 2 | 2 |
| 3 | Hammer | 1 | 1 |

**At RESISTANCE (bearish reversal):**

| Priority | Pattern | Candles | Strength |
|----------|---------|---------|----------|
| 1 | Evening Star | 3 | 2 |
| 2 | Bearish Engulfing | 2 | 2 |
| 3 | Shooting Star | 1 | 1 |

**Either side:**

| Priority | Pattern | Candles | Strength |
|----------|---------|---------|----------|
| Last | Doji | 1 | 1 |

### 3. Pattern Helper Definitions

Each helper is a pure function operating on `Candle` objects (open, high, low, close).

**Hammer** — long lower shadow, tiny upper shadow, decent body:
```
lowerShadow >= 2 × body
upperShadow <= 0.3 × body
body >= range × 0.2
```

**Shooting Star** — inverse of hammer (long upper shadow):
```
upperShadow >= 2 × body
lowerShadow <= 0.3 × body
body >= range × 0.2
```

**Bullish Engulfing** — previous candle bearish, current candle bullish, current body engulfs previous body:
```
prev.close < prev.open    (bearish)
curr.close > curr.open    (bullish)
curr.close > prev.open    (engulfs top)
curr.open < prev.close    (engulfs bottom)
```

**Bearish Engulfing** — inverse of bullish engulfing.

**Doji** — extremely small body relative to range:
```
body <= range × 0.1
```

**Morning Star** (c3 → c2 → c1, oldest to newest):
```
c3 is bearish with large body  (c3.body > c2.body × 2)
c2 has small body              (the "star")
c1 is bullish closing above c3 midpoint
```

**Evening Star** — inverse of morning star (c3 bullish, c1 bearish closing below c3 midpoint).

### 4. Pressure Confirmation

All patterns **except Doji** require:
- `pressure !== null`
- `pressure.confidence >= 0.3`
- Direction alignment:
  - Bullish patterns → pressure signal is `BUY` or `STRONG_BUY`
  - Bearish patterns → pressure signal is `SELL` or `STRONG_SELL`

**Doji** has its own rule: requires `pressure.signal === "NEUTRAL"`. This makes sense — Doji represents market indecision, which aligns with neutral pressure. It is exempt from the confidence gate.

### 5. Output

If a pattern matches, the engine returns:

```typescript
interface PatternSignal {
  pattern: PatternName;              // "HAMMER", "MORNING_STAR", etc.
  direction: "BULLISH" | "BEARISH";
  strength: 1 | 2;                  // 1 = single-candle, 2 = multi-candle
  reason: string;                   // human-readable, e.g. "Hammer at support zone"
}
```

If nothing matches, returns `null`.

---

## Server Endpoint

### `GET /api/stocks/patterns`

Scans near-S/R symbols for candlestick patterns. Cached for 5 minutes.

**Dependencies:**
- `levelsCache` — if S/R levels haven't been computed yet, returns empty
- `marketDataService` — for current prices
- `pressureEngine` — for pressure confirmation
- Kite historical API — for 5-minute candles

**Flow:**

1. Check `levelsCache` exists, return empty if not
2. Return cached result if within 5-minute TTL
3. Filter symbols to those within 0.5% of support or resistance (typically 5-15 out of ~29)
4. Fetch 5-minute candles from Kite for those symbols, batched in groups of 5
5. Run `detectPattern()` for each with last 3 candles, current price, S/R zones, and pressure
6. Cache and return results

**Response:**
```json
{
  "patterns": {
    "MCX:GOLD25APRFUT": {
      "pattern": "HAMMER",
      "direction": "BULLISH",
      "strength": 1,
      "reason": "Hammer at support zone"
    },
    "MCX:SILVER25MAYFUT": {
      "pattern": "BEARISH_ENGULFING",
      "direction": "BEARISH",
      "strength": 2,
      "reason": "Bearish engulfing at resistance zone"
    }
  },
  "timestamp": 1710936000000
}
```

Returns `503` if market data is not initialized.

Returns `{ patterns: {}, timestamp: ... }` if S/R levels haven't been computed or no symbols are near levels.

---

## Frontend Display

Patterns are fetched in `dashboard.tsx` after S/R levels load, with a 5-minute refresh interval. A module-level cache survives component remounts.

In the SR Cards, each stock row can show a `PatternBadge` after the existing `PressureBadge`:

| Pattern | Label | Color |
|---------|-------|-------|
| Hammer | HAMMER | green |
| Shooting Star | SHOT.STAR | red |
| Bullish Engulfing | B.ENGULF | green |
| Bearish Engulfing | B.ENGULF | red |
| Doji | DOJI | yellow |
| Morning Star | M.STAR | green |
| Evening Star | E.STAR | red |

Multi-candle patterns (strength 2) use a slightly stronger background opacity (`/20` vs `/15`) to visually distinguish them from single-candle patterns.

---

## Design Decisions Summary

| Decision | Rationale |
|----------|-----------|
| Pure function, no state | Testable, deterministic, no lifecycle to manage |
| 0.5% proximity gate | Patterns are only meaningful at S/R levels; filters ~80% of symbols |
| Pressure confirmation required | Reduces false signals; candles + volume flow > candles alone |
| Doji requires neutral pressure | Doji = indecision, which matches neutral pressure semantically |
| Multi-candle priority over single | 3-candle patterns are stronger reversal signals |
| 5-minute candles | Matches the scan frequency; fast enough for intraday trading |
| 5-minute cache TTL | Same as candle interval; avoids redundant Kite API calls |
| Batch Kite calls in groups of 5 | Respects Kite rate limits (same pattern as S/R levels endpoint) |
| Only scan near-S/R symbols | Avoids fetching candles for symbols where patterns would be ignored anyway |
