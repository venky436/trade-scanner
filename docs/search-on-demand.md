# Stock Search & On-Demand Analysis

## Overview

Users can search **any NSE equity stock** (~9,400 stocks) from the navbar. For stocks not in the tracked list (~514), the system computes full signal analysis **on-demand** in ~1-2 seconds and auto-refreshes every 10 seconds.

---

## How It Works

```
User types "SAN" in search bar
        ↓
Debounce 300ms
        ↓
GET /api/stocks/search?q=SAN
        ↓
Backend searches ALL ~9,400 NSE instruments
        ↓
Returns top 10 matches:
  SANOFI      ₹5,420   (On-demand)
  SANDHAR     ₹498     (On-demand)
  SANSTAR     ₹125     (On-demand)
  SBIN        ₹812     (Live)        ← tracked stock
        ↓
User clicks "SANOFI"
        ↓
Navigate to /stock/SANOFI
        ↓
Is SANOFI in stockMap (live 150)?
  └── NO
        ↓
Show loading spinner: "Loading stock analysis..."
        ↓
GET /api/stocks/SANOFI/snapshot
        ↓
Backend computes ON-DEMAND:
  ┌───────────────────────────────────────────────┐
  │ 1. Find token from allInstruments (9,400 list)│
  │                                                │
  │ 2. Fetch 25-day daily candles from Kite API   │
  │                                                │
  │ 3. From candles:                               │
  │    → Price (latest close)                      │
  │    → OHLCV data                                │
  │    → S/R levels (clustering algorithm)         │
  │    → Momentum (weighted 3-candle return)       │
  │                                                │
  │ 4. Pressure: UNAVAILABLE (needs live ticks)    │
  │                                                │
  │ 5. Signal Engine:                              │
  │    getSignal(price, sr, pressure, momentum)    │
  │                                                │
  │ 6. Score Engine:                               │
  │    computeSignalScore(all inputs) → 1-10       │
  │                                                │
  │ 7. Market Phase Control:                       │
  │    applyMarketPhase(signal, score)             │
  │    → OPENING: force WAIT, score ×0.6           │
  │    → STABILIZING: confirmed only, ×0.8         │
  │    → NORMAL/CLOSED: pass through               │
  │                                                │
  │ 8. Cache result (60 seconds)                   │
  └───────────────────────────────────────────────┘
        ↓
Return to frontend:
  {
    symbol: "SANOFI",
    price: 5420,
    signal: { action: "BUY", type: "BOUNCE", score: 7 },
    momentum: { signal: "UP" },
    pressure: { status: "UNAVAILABLE" },
    srLevels: { support: 5350, resistance: 5520 },
    dataSource: "on-demand",
    computedAt: 1711100000000
  }
        ↓
Frontend renders full detail page:
  ✅ Trade Decision Box
  ✅ Score Breakdown
  ✅ Chart (with S/R lines + MA)
  ✅ Key Levels
  ✅ Volume & Market Data
        ↓
Auto-refresh every 10 seconds
  (re-fetches /api/stocks/SANOFI/snapshot)
        ↓
Note shown: "Data refreshes every 10 seconds — not real-time"
```

---

## Two Types of Stocks

| | Tracked Stocks (514) | On-Demand Stocks (~8,900) |
|---|---|---|
| **Source** | Filtered by Phase 0 (price + priority) | All remaining NSE EQ |
| **Price updates** | Real-time via Kite WebSocket | Refreshed every 10 seconds |
| **Pressure engine** | Live (tick-by-tick) | Unavailable (needs live ticks) |
| **Momentum** | Live (5-min candle close) | From daily candles (EOD) |
| **S/R Levels** | From EOD job + levels worker | Computed on-demand from Kite API |
| **Signal** | Progressive pipeline (ACTIVITY → CONFIRMED) | Computed on-demand |
| **Score** | Updated every 500ms-1s | Updated every 10s |
| **Badge** | "Live" (green) | "On-demand" (yellow) |
| **Chart** | Real-time candles | Static candles (refreshes on period change) |

---

## Search API

### `GET /api/stocks/search?q=TAT`

Searches all ~9,400 NSE EQ instruments by symbol name.

**Matching logic:**
1. Starts-with matches first (e.g., "TAT" → TATASTEEL, TATAELXSI)
2. Then contains matches (e.g., "TAT" → PERSISTENT)
3. Max 10 results

**Response:**
```json
{
  "results": [
    { "symbol": "TATASTEEL", "token": 895745, "price": 143.25, "change": 2.31, "isTracked": true },
    { "symbol": "TATAELXSI", "token": 3465729, "price": 4237, "change": 4.91, "isTracked": true },
    { "symbol": "TATACHEM", "token": 871681, "price": 1050, "change": -0.5, "isTracked": true },
    { "symbol": "TATACOMM", "token": 2365441, "price": 1820, "change": 0, "isTracked": false }
  ]
}
```

**`isTracked`**: true = live data available, false = on-demand only

---

## Snapshot API

### `GET /api/stocks/:symbol/snapshot`

Returns full analysis for any stock. Uses caching to prevent API abuse.

**Caching:**
- Snapshot cache: 60 seconds TTL (in-memory Map)
- Same stock searched by multiple users → cached response returned instantly

**For tracked stocks:** Returns live data from engines (instant, no Kite API call)

**For untracked stocks:** Fetches candles from Kite API, computes S/R + momentum + signal (1-2 seconds)

**Response:**
```json
{
  "symbol": "SANOFI",
  "price": 5420.50,
  "open": 5380,
  "high": 5445,
  "low": 5370,
  "close": 5395,
  "volume": 12500,
  "change": 0.47,
  "signal": {
    "action": "BUY",
    "type": "BOUNCE",
    "confidence": "MEDIUM",
    "score": 7,
    "stage": "MOMENTUM",
    "reasons": ["UP momentum (STABLE)", "Near support at 5350"],
    "scoreBreakdown": {
      "pressure": 0,
      "momentum": 8,
      "sr": 8,
      "pattern": 0,
      "volatility": 6
    }
  },
  "momentum": { "value": 0.5, "signal": "UP", "acceleration": "STABLE" },
  "pressure": { "status": "UNAVAILABLE", "reason": "Not tracked in real-time" },
  "srLevels": {
    "support": 5350,
    "resistance": 5520,
    "supportZone": { "min": 5330, "max": 5370, "level": 5350, "touches": 5 },
    "resistanceZone": { "min": 5500, "max": 5540, "level": 5520, "touches": 3 }
  },
  "dataSource": "on-demand",
  "computedAt": 1711100000000
}
```

---

## Frontend Search UI

### Location
Navbar — center, always visible on all pages.

### Behavior
1. User types → debounced 300ms → API call
2. Dropdown appears below input with glass-morphism styling
3. Each result shows: symbol + Live/On-demand badge + price + change%
4. Keyboard: Arrow Up/Down to select, Enter to open, Escape to close
5. Click outside → close dropdown
6. Click result → navigate to `/stock/[symbol]`

### Detail Page Behavior
- **Live stock** (in stockMap): renders immediately, real-time WebSocket updates
- **On-demand stock**: shows loading spinner → fetches snapshot → renders → auto-refreshes every 10s
- **Note shown**: yellow pulse dot + "Data refreshes every 10 seconds — not real-time"
- **"On-demand" badge**: yellow badge next to NSE badge in header

---

## Chart for On-Demand Stocks

The chart history endpoint (`/api/stocks/:symbol/history`) also works for untracked stocks — it looks up the instrument token from `allInstruments` as a fallback when `symbolToToken` doesn't have it.

So charts with candles, MA lines, and S/R levels all render correctly for any stock.

---

## Limitations

| What | Limitation | Why |
|---|---|---|
| Pressure | Always "Unavailable" for on-demand | Needs live tick-by-tick data |
| Pattern | Not detected for on-demand | Needs 5-min candles near S/R |
| Real-time price | Refreshes every 10s, not live | Not subscribed to Kite ticker |
| Score accuracy | Lower without pressure | Pressure is 25% of score weight |

---

## Example Flow

```
1. User opens TradeScanner
2. Home screen shows 150 tracked stocks with live signals
3. User searches "SANOFI" — not in tracked list
4. Clicks result → detail page loads
5. Loading spinner: "Loading stock analysis..."
6. After ~1.5s: full page renders with:
   - Trade Decision: WATCH (near support)
   - Score: 5/10 (no pressure data)
   - Chart: 5D with S/R lines + 20/50 MA
   - Key Levels: Support ₹5,350 / Resistance ₹5,520
   - Note: "Data refreshes every 10 seconds"
7. Every 10 seconds: data refreshes silently
8. User goes back → searches another stock
```
