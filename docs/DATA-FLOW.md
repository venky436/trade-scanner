# Data Flow Documentation

Complete data flow reference for the real-time MCX trading scanner. This document
traces every byte from the Zerodha Kite WebSocket to the pixels on the user's
screen, with ASCII diagrams, real JSON examples, and direct code references.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Authentication Flow](#2-authentication-flow)
3. [Market Data Pipeline](#3-market-data-pipeline)
4. [Frontend Real-Time Display](#4-frontend-real-time-display)
5. [Historical Candles Flow](#5-historical-candles-flow)
6. [WebSocket Message Format](#6-websocket-message-format)
7. [Key Data Types](#7-key-data-types)
8. [Network Architecture (Production)](#8-network-architecture-production)

---

## 1. System Overview

```
+-----------------------------------------------------+
|                      Browser                         |
|  Next.js Dashboard  (:3000)                          |
|  +-----------------------------------------------+  |
|  | useMarketData hook  <--- ws://server:4002/ws   |  |
|  | StockRow components (live price table)          |  |
|  | CandlestickChart   (lightweight-charts)         |  |
|  +-----------------------------------------------+  |
+-----------------------------------------------------+
          |  WebSocket (real-time)     |  HTTP (REST)
          v                            v
+-----------------------------------------------------+
|                  Backend  (:4002)                     |
|  Fastify HTTP Server                                 |
|  +-----------------------------------------------+  |
|  | WsManager        - manages browser WS clients  |  |
|  | BroadcastEngine   - 500ms push interval         |  |
|  | MarketDataService - in-memory quote store        |  |
|  | KiteTickerManager - Kite WS subscription         |  |
|  +-----------------------------------------------+  |
+-----------------------------------------------------+
          |  WebSocket (binary ticks)  |  REST API
          v                            v
+-----------------------------------------------------+
|                Zerodha Kite APIs                     |
|  KiteTicker WebSocket  |  REST (instruments, OHLCV)  |
+-----------------------------------------------------+
```

**Two independent data channels run simultaneously:**

| Channel | Protocol | Direction | Purpose |
|---------|----------|-----------|---------|
| Kite Ticker -> Backend | WebSocket (binary) | Kite -> Server | Live tick data for all subscribed MCX instruments |
| Backend -> Browser | WebSocket (JSON) | Server -> Browser | Aggregated price snapshots, pushed every 500ms |
| Browser -> Backend | HTTP GET | Browser -> Server | Historical candle data, auth status |
| Backend -> Kite REST | HTTP GET | Server -> Kite | Instrument list, historical OHLCV |

---

## 2. Authentication Flow

### 2.1 Full Login Sequence

```
 Browser                  Backend (:4002)          Kite (kite.trade)
    |                          |                          |
    |  1. GET /api/auth/login  |                          |
    |------------------------->|                          |
    |                          |                          |
    |  2. 302 Redirect         |                          |
    |<-------------------------|                          |
    |     Location: https://kite.trade/connect/login      |
    |              ?v=3&api_key=<KITE_API_KEY>             |
    |                          |                          |
    |  3. User logs in on Kite |                          |
    |---------------------------------------------------->|
    |                          |                          |
    |  4. 302 Redirect from Kite                          |
    |<----------------------------------------------------|
    |     Location: http://server:4002/api/auth/callback   |
    |              ?action=login&request_token=abc123       |
    |                          |                          |
    |  5. GET /api/auth/callback?action=login&             |
    |        request_token=abc123                          |
    |------------------------->|                          |
    |                          |  6. POST generateSession  |
    |                          |     (request_token +      |
    |                          |      api_secret)          |
    |                          |------------------------->|
    |                          |                          |
    |                          |  7. { access_token: ... } |
    |                          |<-------------------------|
    |                          |                          |
    |                          |  8. saveSession()        |
    |                          |     writes .kite-session.json
    |                          |                          |
    |                          |  9. startMarketData()    |
    |                          |     (loads instruments,   |
    |                          |      connects ticker,     |
    |                          |      starts broadcast)    |
    |                          |                          |
    | 10. 302 Redirect         |                          |
    |<-------------------------|                          |
    |     Location: http://localhost:3000 (frontend)       |
    |                          |                          |
```

### 2.2 URL Redirect Chain (concrete example)

```
Step 1:  http://localhost:4002/api/auth/login
Step 2:  https://kite.trade/connect/login?v=3&api_key=xpz4r8k2abc123
Step 3:  (user enters Kite credentials on Zerodha's page)
Step 4:  http://localhost:4002/api/auth/callback?action=login&request_token=7fHkQ9xN3mPvRs2Y
Step 5:  http://localhost:3000  (frontend dashboard)
```

### 2.3 Session Persistence (.kite-session.json)

The access token is saved to disk so the server can restart without requiring
the user to log in again during the same trading day.

```
File: apps/server/.kite-session.json

{
  "accessToken": "wK7x9mRp3nQvLs5Y2hBf",
  "savedAt": 1711008000000
}
```

**Lifecycle rules:**

| Event | Behavior |
|-------|----------|
| Login succeeds | `saveSession(accessToken)` writes file with current timestamp |
| Server starts | `loadSession()` reads file; returns token if < 14 hours old |
| Token age > 14h | `clearSession()` deletes file; user must re-login |
| File missing | Returns `null`; falls through to `KITE_ACCESS_TOKEN` env var |

**Startup token resolution order:**

```
loadSession()              -- .kite-session.json (if < 14h old)
    |
    +-- found? ---------> use it, call startMarketData(token)
    |
    +-- null? ----------> check process.env.KITE_ACCESS_TOKEN
                              |
                              +-- found? --> use it
                              +-- null? ---> log "Login at /api/auth/login"
```

Code references:
- `apps/server/src/lib/session-store.ts` -- saveSession, loadSession, clearSession
- `apps/server/src/routes/auth.route.ts` -- /api/auth/login, /api/auth/callback
- `apps/server/src/index.ts` lines 62-88 -- startup token resolution

---

## 3. Market Data Pipeline

This is the main real-time flow. It starts after authentication succeeds and
runs continuously throughout the trading session.

### 3.1 Pipeline Overview

```
+-------------------+     +-------------------+     +-------------------+
|  Kite WebSocket   |     |  MarketDataService|     |  BroadcastEngine  |
|  (binary ticks)   |     |  (in-memory store)|     |  (500ms timer)    |
|                   |     |                   |     |                   |
|  KiteTicker emits |---->|  quotes Map       |---->|  reads dirty set  |
|  "ticks" event    |     |  dirtySymbols Set |     |  builds snapshots |
|                   |     |                   |     |  sends to WsManager|
+-------------------+     +-------------------+     +-------------------+
                                                            |
                                                            v
                                                    +-------------------+
                                                    |  WsManager        |
                                                    |  (ws library)     |
                                                    |                   |
                                                    |  broadcasts JSON  |
                                                    |  to all connected |
                                                    |  browser clients  |
                                                    +-------------------+
                                                            |
                                                            v
                                                    +-------------------+
                                                    |  Browser(s)       |
                                                    |  useMarketData()  |
                                                    +-------------------+
```

### 3.2 Step-by-Step Data Transformation

**Step 1: Kite sends a binary tick**

The Kite WebSocket sends binary-encoded tick packets. The `kiteconnect`
library decodes them into JavaScript objects with this shape:

```js
// Raw tick from KiteTicker "ticks" event
{
  instrument_token: 53523207,
  last_price: 71842.0,
  ohlc: {
    open: 71650.0,
    high: 71950.0,
    low: 71480.0,
    close: 71520.0      // previous trading day's close
  },
  volume_traded: 14523,
  // ... other fields (exchange_timestamp, oi, depth, etc.)
}
```

**Step 2: KiteTickerManager converts tick to Quote**

`apps/server/src/services/kite-ticker.service.ts` -- on "ticks" handler

```
Kite tick                          Quote (internal)
-----------                        ----------------
instrument_token: 53523207    -->  (looked up) symbol: "GOLDM25APRFUT"
last_price: 71842.0           -->  lastPrice: 71842.0
ohlc.open: 71650.0            -->  open: 71650.0
ohlc.high: 71950.0            -->  high: 71950.0
ohlc.low: 71480.0             -->  low: 71480.0
ohlc.close: 71520.0           -->  close: 71520.0
volume_traded: 14523          -->  volume: 14523
(generated)                   -->  timestamp: 1711022400000
```

The `instrument_token -> symbol` lookup uses the `InstrumentMaps.tokenToSymbol`
map, built during startup by `loadInstruments()`.

**Step 3: MarketDataService stores the quote**

```
marketDataService.updateQuote("GOLDM25APRFUT", quote)
    |
    +---> quotes.set("GOLDM25APRFUT", quote)     // update the map
    +---> dirtySymbols.add("GOLDM25APRFUT")      // mark as changed
```

The `dirtySymbols` set is the key optimization: the broadcast engine only
sends data for symbols that actually changed since the last broadcast.

**Step 4: BroadcastEngine fires every 500ms**

```
Every 500ms:
    |
    +-- clientCount() === 0?  --> skip (no one listening)
    |
    +-- getDirtySymbols() empty? --> skip (nothing changed)
    |
    +-- for each dirty symbol:
    |       read quote from marketDataService
    |       compute change% = (lastPrice - close) / close * 100
    |       build StockSnapshot object
    |
    +-- wrap in WsMessage { type: "market_update", data: [...], timestamp }
    |
    +-- wsManager.broadcast(msg)
    |       JSON.stringify the message
    |       send to every connected WebSocket client
    |
    +-- clearDirty()  (reset for next cycle)
```

**Step 5: The full transformation chain**

```
Kite binary tick
       |
       v
 { instrument_token, last_price, ohlc, volume_traded }    (Kite format)
       |
       |  kite-ticker.service.ts -- token->symbol lookup
       v
 Quote { lastPrice, open, high, low, close, volume, timestamp }
       |
       |  marketDataService.updateQuote()
       v
 In-memory Map<string, Quote>  +  dirtySymbols Set
       |
       |  broadcast.service.ts -- every 500ms
       v
 StockSnapshot { symbol, price, open, high, low, close, volume, change, timestamp }
       |
       |  wrapped in WsMessage
       v
 { type: "market_update", data: [StockSnapshot, ...], timestamp }
       |
       |  JSON.stringify()
       v
 Raw JSON string sent over WebSocket to browser
```

### 3.3 Instrument Loading

Before any ticks flow, the system must know which MCX instruments to subscribe
to. This happens in `loadInstruments()`.

```
loadInstruments(apiKey, accessToken, "commodity")
    |
    |  1. kc.getInstruments("MCX")         // fetches ~2000+ instruments
    |
    |  2. filter: segment === "MCX-FUT"    // only futures
    |
    |  3. filter: expiry >= today           // only active (non-expired)
    |
    |  4. group by commodity name           // e.g., GOLD, SILVER, CRUDEOIL
    |
    |  5. per group, pick nearest expiry    // most liquid contract
    |
    |  6. sort by last_price descending     // highest value first
    |
    |  7. take top 100                      // configurable via maxCount
    |
    |  8. build bidirectional maps:
    |       tokenToSymbol: Map<number, string>
    |       symbolToToken: Map<string, number>
    |       symbols: string[]
    |
    v
  InstrumentMaps { tokenToSymbol, symbolToToken, symbols }
```

Example resulting maps:

```
tokenToSymbol:
  53523207  -->  "GOLDM25APRFUT"
  53496327  -->  "SILVER25APRFUT"
  53478407  -->  "CRUDEOIL25APRFUT"
  53501959  -->  "NATURALGAS25APRFUT"
  ...

symbolToToken:
  "GOLDM25APRFUT"         -->  53523207
  "SILVER25APRFUT"        -->  53496327
  "CRUDEOIL25APRFUT"      -->  53478407
  "NATURALGAS25APRFUT"    -->  53501959
  ...
```

Code reference: `apps/server/src/services/instrument.service.ts`

---

## 4. Frontend Real-Time Display

### 4.1 Connection Lifecycle

```
 Dashboard mounts
       |
       v
 useMarketData() hook initializes
       |
       v
 new WebSocket("ws://localhost:4002/ws")
       |
       +-- onopen:
       |       isConnected = true
       |       retriesRef = 0
       |
       +-- onmessage (first message):
       |       type: "snapshot"
       |       stockMapRef = new Map() from snapshot data
       |       setStocks([...stockMapRef.values()])
       |
       +-- onmessage (subsequent, every ~500ms):
       |       type: "market_update"
       |       merge changed stocks into stockMapRef
       |       setStocks([...stockMapRef.values()])
       |
       +-- onclose:
       |       isConnected = false
       |       schedule reconnect with exponential backoff
       |       delay = min(1000 * 2^retries, 30000)
       |
       +-- onerror:
               set error state
               close socket (triggers onclose -> reconnect)
```

**Reconnection backoff schedule:**

| Attempt | Delay |
|---------|-------|
| 1 | 1 second |
| 2 | 2 seconds |
| 3 | 4 seconds |
| 4 | 8 seconds |
| 5 | 16 seconds |
| 6+ | 30 seconds (max) |

### 4.2 State Management

```
useMarketData() hook
    |
    +-- stockMapRef (useRef)
    |       Map<string, StockData>
    |       "GOLDM25APRFUT"         -> { symbol, price, change, ... }
    |       "SILVER25APRFUT"        -> { symbol, price, change, ... }
    |       "CRUDEOIL25APRFUT"      -> { symbol, price, change, ... }
    |
    |   On "snapshot":  replace entire map
    |   On "market_update":  merge changed entries only
    |
    +-- stocks (useState)
    |       StockData[]  (array derived from stockMapRef.values())
    |       Triggers React re-render on every update
    |
    v
 Dashboard component
    |
    +-- filteredAndSorted (useMemo)
    |       apply search filter (string match on symbol)
    |       apply sort (by symbol, price, change, volume, etc.)
    |
    +-- StockTable
            |
            +-- StockRow (one per stock, memo'd)
                    re-renders only when price/change/volume/high/low change
```

### 4.3 Price Flash Animation

When a price changes, the table row briefly flashes green (price up) or
red (price down). This is CSS-driven using a `data-flash` attribute.

```
StockRow component (memo'd):
    |
    +-- prevPriceRef stores previous tick's price
    |
    +-- useEffect on [stock.price]:
    |       if price === prevPrice --> no flash
    |       if price > prevPrice   --> data-flash="up"   (green)
    |       if price < prevPrice   --> data-flash="down"  (red)
    |
    +-- setTimeout(500ms):
            remove data-flash attribute
```

```
 Time 0ms        100ms       500ms       600ms
    |              |           |           |
    v              v           v           v
 [71842.00]   [71856.00]   flash ends   [71840.00]
  (normal)    (green glow)  (normal)    (red glow)
```

The flash duration is controlled by `FLASH_DURATION_MS = 500` in
`apps/web/src/lib/constants.ts`.

### 4.4 Memo Optimization

`StockRow` is wrapped in `React.memo` with a custom comparator:

```ts
memo(StockRowInner, (prev, next) => {
  return (
    prev.stock.price  === next.stock.price  &&
    prev.stock.change === next.stock.change &&
    prev.stock.volume === next.stock.volume &&
    prev.stock.high   === next.stock.high   &&
    prev.stock.low    === next.stock.low    &&
    prev.index        === next.index
  );
});
```

This means a row only re-renders when one of those 6 values changes, not
on every 500ms broadcast cycle. With 50+ instruments, this prevents
re-rendering rows whose data has not changed.

Code references:
- `apps/web/src/hooks/use-market-data.ts` -- WebSocket hook
- `apps/web/src/components/dashboard.tsx` -- main dashboard
- `apps/web/src/components/stock-row.tsx` -- individual row + flash logic

---

## 5. Historical Candles Flow (Stock Detail Page)

### 5.1 User Interaction

```
 Dashboard                                 Stock Detail Page
 +---------------------------------+       +---------------------------------+
 | # | Symbol          | Price     |       | <-- GOLDM25APRFUT               |
 |---|-----------------|-----------|       |     71,842.00  +0.45%           |
 | 1 | GOLDM25APRFUT   | 71,842.00 | ---> |                                 |
 | 2 | SILVER25APRFUT  | 88,450.00 |click  | +---------------------------+   |
 | 3 | CRUDEOIL25APR...| 5,832.00  |       | | Candlestick Chart         |   |
 +---------------------------------+       | | (lightweight-charts)      |   |
                                           | +---------------------------+   |
   User clicks a row:                      | [1m] [5m] [15m] [30m] [1H] [1D]|
   router.push("/stock/GOLDM25APRFUT")     |                                 |
                                           | Open: 71,650  High: 71,950      |
                                           | Low: 71,480   Close: 71,520     |
                                           | Volume: 14.5K  Change: +0.45%   |
                                           +---------------------------------+
```

### 5.2 Data Fetch Sequence

```
 Browser                        Backend (:4002)                 Kite REST API
    |                               |                               |
    | 1. GET /api/stocks/           |                               |
    |    GOLDM25APRFUT/history      |                               |
    |    ?interval=minute&days=1    |                               |
    |------------------------------>|                               |
    |                               |                               |
    |                               | 2. symbolToToken lookup       |
    |                               |    "GOLDM25APRFUT" -> 53523207|
    |                               |                               |
    |                               | 3. kc.getHistoricalData(      |
    |                               |      53523207,                |
    |                               |      "minute",                |
    |                               |      "2026-03-19 00:00:00",   |
    |                               |      "2026-03-20 15:30:00"    |
    |                               |    )                          |
    |                               |------------------------------>|
    |                               |                               |
    |                               | 4. Returns OHLCV array        |
    |                               |<------------------------------|
    |                               |                               |
    |                               | 5. Transform: Kite date ->    |
    |                               |    unix seconds (time field)  |
    |                               |                               |
    | 6. { symbol, interval,        |                               |
    |      candles: [...] }         |                               |
    |<------------------------------|                               |
    |                               |                               |
    | 7. CandlestickChart renders   |                               |
    |    candleSeries.setData()     |                               |
    |    volumeSeries.setData()     |                               |
    |                               |                               |
```

### 5.3 Interval Mapping

The frontend uses human-readable labels that map to Kite API interval values:

| Button | API interval | Seconds per candle | Days fetched |
|--------|--------------|--------------------|--------------|
| 1m | `minute` | 60 | 1 |
| 5m | `5minute` | 300 | 1 |
| 15m | `15minute` | 900 | 1 |
| 30m | `30minute` | 1800 | 1 |
| 1H | `60minute` | 3600 | 1 |
| 1D | `day` | 86400 | 90 |

Valid intervals accepted by the backend (validated in `stocks.route.ts`):
`minute`, `3minute`, `5minute`, `15minute`, `30minute`, `60minute`, `day`

**Timezone:** The `formatDate()` function in `stocks.route.ts` converts dates to IST before sending to Kite API. This is critical for production servers running in UTC — without it, intraday candle requests would miss the current trading session (UTC is 5:30 hours behind IST).

### 5.4 Real-Time Candle Updates

Once historical candles are loaded, the chart also receives live tick updates
from the same `useMarketData()` WebSocket connection. The `CandlestickChart`
component merges these ticks into the latest candle.

```
Live tick arrives (tick.price = 71856, tick.timestamp = 1711022460000)
    |
    |  tickTime = floor(1711022460000 / 1000) = 1711022460
    |  candleStart = floor(1711022460 / 60) * 60 = 1711022460
    |  lastCandleStart = floor(last.time / 60) * 60
    |
    +-- candleStart === lastCandleStart?
    |       YES: Update existing candle
    |           high = max(last.high, tick.price)
    |           low  = min(last.low, tick.price)
    |           close = tick.price
    |           volume = tick.volume
    |           candleSeries.update(...)
    |
    +-- candleStart > lastCandleStart?
            YES: New candle
            open = high = low = close = tick.price
            volume = tick.volume
            candleSeries.update(...)  (creates new bar)
```

Code references:
- `apps/web/src/components/stock-detail.tsx` -- detail page layout
- `apps/web/src/components/candlestick-chart.tsx` -- chart + tick merge logic
- `apps/server/src/routes/stocks.route.ts` -- /api/stocks/:symbol/history

---

## 6. WebSocket Message Format

### 6.1 snapshot (sent once on initial connection)

When a browser connects to `ws://server:4002/ws`, the server immediately
sends a `snapshot` message containing the latest data for ALL tracked symbols.

```json
{
  "type": "snapshot",
  "data": [
    {
      "symbol": "GOLDM25APRFUT",
      "price": 71842.00,
      "open": 71650.00,
      "high": 71950.00,
      "low": 71480.00,
      "close": 71520.00,
      "volume": 14523,
      "change": 0.45,
      "timestamp": 1711022400000
    },
    {
      "symbol": "SILVER25APRFUT",
      "price": 88450.00,
      "open": 88100.00,
      "high": 88620.00,
      "low": 87850.00,
      "close": 88200.00,
      "volume": 28740,
      "change": 0.28,
      "timestamp": 1711022400000
    },
    {
      "symbol": "CRUDEOIL25APRFUT",
      "price": 5832.00,
      "open": 5810.00,
      "high": 5855.00,
      "low": 5790.00,
      "close": 5805.00,
      "volume": 42150,
      "change": 0.47,
      "timestamp": 1711022400000
    },
    {
      "symbol": "NATURALGAS25APRFUT",
      "price": 248.60,
      "open": 245.90,
      "high": 250.20,
      "low": 244.80,
      "close": 246.30,
      "volume": 65200,
      "change": 0.93,
      "timestamp": 1711022400000
    }
  ],
  "timestamp": 1711022400500
}
```

### 6.2 market_update (sent every 500ms with changed stocks only)

After the initial snapshot, the server sends incremental updates containing
ONLY the symbols whose prices have changed since the last broadcast.

```json
{
  "type": "market_update",
  "data": [
    {
      "symbol": "GOLDM25APRFUT",
      "price": 71856.00,
      "open": 71650.00,
      "high": 71956.00,
      "low": 71480.00,
      "close": 71520.00,
      "volume": 14587,
      "change": 0.47,
      "timestamp": 1711022401000
    },
    {
      "symbol": "CRUDEOIL25APRFUT",
      "price": 5828.00,
      "open": 5810.00,
      "high": 5855.00,
      "low": 5790.00,
      "close": 5805.00,
      "volume": 42310,
      "change": 0.40,
      "timestamp": 1711022401000
    }
  ],
  "timestamp": 1711022401500
}
```

Note: `SILVER25APRFUT` and `NATURALGAS25APRFUT` are absent because their
prices did not change during this 500ms window.

### 6.3 StockData / StockSnapshot Field Reference

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `symbol` | string | Trading symbol (includes expiry) | `"GOLDM25APRFUT"` |
| `price` | number | Last traded price | `71842.00` |
| `open` | number | Today's opening price | `71650.00` |
| `high` | number | Today's high | `71950.00` |
| `low` | number | Today's low | `71480.00` |
| `close` | number | Previous trading day's close | `71520.00` |
| `volume` | number | Total volume traded today | `14523` |
| `change` | number | % change from previous close | `0.45` |
| `timestamp` | number | Epoch milliseconds | `1711022400000` |

The `change` field is computed server-side:
```
change = round(((price - close) / close) * 100, 2)
```

### 6.4 Server-Side Ping/Pong (Keep-Alive)

The WsManager runs a ping interval every 30 seconds to detect dead connections:

```
Every 30 seconds:
    for each client:
        if client.__alive === false:
            terminate()       // dead connection
        else:
            client.__alive = false
            client.ping()     // send ping frame

    On pong received:
        client.__alive = true
```

Code reference: `apps/server/src/ws/ws-server.ts` -- startPingInterval()

---

## 7. Key Data Types

### 7.1 Server-Side Types

**InstrumentMaps** (`apps/server/src/lib/types.ts`)

```ts
interface InstrumentMaps {
  tokenToSymbol: Map<number, string>;   // Kite instrument_token -> trading symbol
  symbolToToken: Map<string, number>;   // trading symbol -> Kite instrument_token
  symbols: string[];                    // ordered list of all tracked symbols
}
```

**StockSnapshot** (`apps/server/src/lib/types.ts`)

```ts
interface StockSnapshot {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;       // previous close
  volume: number;
  change: number;      // (price - close) / close * 100
  timestamp: number;
}
```

**WsMessage** (`apps/server/src/lib/types.ts`)

```ts
interface WsMessage {
  type: "snapshot" | "market_update";
  data: StockSnapshot[];
  timestamp: number;
}
```

**Candle** (`apps/server/src/lib/types.ts`)

```ts
interface Candle {
  time: number;     // unix seconds (lightweight-charts expects seconds)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
```

**Quote** (`apps/server/src/services/market-data.service.ts`)

```ts
interface Quote {
  lastPrice: number;
  open: number;
  high: number;
  low: number;
  close: number;       // previous close
  volume: number;
  timestamp: number;   // epoch ms
}
```

### 7.2 Frontend Types

**StockData** (`apps/web/src/lib/types.ts`)

```ts
// Identical shape to StockSnapshot on the server
interface StockData {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
  timestamp: number;
}
```

**MarketMessage** (`apps/web/src/lib/types.ts`)

```ts
// Identical shape to WsMessage on the server
interface MarketMessage {
  type: "snapshot" | "market_update";
  data: StockData[];
  timestamp: number;
}
```

**CandleData** (`apps/web/src/lib/types.ts`)

```ts
interface CandleData {
  time: number;     // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
```

### 7.3 Type Mapping Across Boundaries

```
Server (TypeScript)          Wire (JSON)              Frontend (TypeScript)
-------------------          ----------               ---------------------
StockSnapshot        ---->   JSON object       ---->  StockData
WsMessage            ---->   JSON object       ---->  MarketMessage
Candle               ---->   JSON object       ---->  CandleData
Quote                        (internal only, never sent over the wire)
InstrumentMaps               (internal only, never sent over the wire)
```

---

## 8. Network Architecture (Production)

### 8.1 Full Production Stack

```
+-------------------+
|     Browser       |
|  (any device)     |
+-------------------+
         |
         |  HTTPS / WSS (port 443)
         v
+-------------------+
|      Nginx        |
|  (reverse proxy)  |
|  SSL termination  |
+-------------------+
         |
         |--- /ws  ---------> WebSocket upgrade ----+
         |                                          |
         |--- /api/* -------> HTTP proxy -----------+
         |                                          |
         |                                          v
         |                               +-------------------+
         |                               |  Backend (:4002)  |
         |                               |  Fastify + WS     |
         |                               +-------------------+
         |                                          |
         |--- /* -----------> HTTP proxy            |  Kite WebSocket
         |                          |               |  (outbound)
         v                          v               v
+-------------------+      +-------------------+
|  Frontend (:3000) |      |  Kite APIs        |
|  Next.js          |      |  kite.trade       |
+-------------------+      +-------------------+
```

### 8.2 Nginx Configuration for WebSocket Upgrade

For WebSocket connections to work through Nginx, the `Upgrade` and
`Connection` headers must be forwarded. Example configuration:

```nginx
server {
    listen 443 ssl;
    server_name scanner.example.com;

    ssl_certificate     /etc/ssl/certs/scanner.crt;
    ssl_certificate_key /etc/ssl/private/scanner.key;

    # Frontend (Next.js)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Backend REST API
    location /api/ {
        proxy_pass http://127.0.0.1:4002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Backend WebSocket -- note the Upgrade headers
    location /ws {
        proxy_pass http://127.0.0.1:4002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;    # keep WS alive for 24h
    }
}
```

### 8.3 WebSocket Upgrade Handshake Through Nginx

```
Browser                         Nginx                        Backend (:4002)
   |                              |                              |
   | GET /ws HTTP/1.1             |                              |
   | Upgrade: websocket           |                              |
   | Connection: Upgrade          |                              |
   | Sec-WebSocket-Key: dGhlI...  |                              |
   |----------------------------->|                              |
   |                              | GET /ws HTTP/1.1             |
   |                              | Upgrade: websocket           |
   |                              | Connection: upgrade          |
   |                              | Sec-WebSocket-Key: dGhlI...  |
   |                              |----------------------------->|
   |                              |                              |
   |                              |   HTTP/1.1 101 Switching     |
   |                              |   Upgrade: websocket         |
   |                              |   Connection: Upgrade        |
   |                              |<-----------------------------|
   |   HTTP/1.1 101 Switching     |                              |
   |   Upgrade: websocket         |                              |
   |   Connection: Upgrade        |                              |
   |<-----------------------------|                              |
   |                              |                              |
   |<============= WebSocket frames flow bidirectionally =======>|
   |                              |                              |
```

On the backend side, `WsManager.attach()` listens for the `upgrade` event on
the Node HTTP server and only accepts connections whose pathname is `/ws`:

```ts
httpServer.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (url.pathname !== "/ws") {
    socket.destroy();   // reject non-/ws upgrade requests
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    handleConnection(ws);
  });
});
```

### 8.4 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4002` | Backend HTTP/WS server port |
| `KITE_API_KEY` | (required) | Zerodha Kite API key |
| `KITE_API_SECRET` | (required) | Zerodha Kite API secret |
| `KITE_ACCESS_TOKEN` | (optional) | Pre-set access token (skips login) |
| `MARKET_MODE` | `"commodity"` | `"commodity"` (MCX) or `"equity"` (NSE) |
| `FRONTEND_URL` | `http://localhost:3000` | Where to redirect after Kite login |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4002` | Backend URL used by frontend |
| `NEXT_PUBLIC_WS_URL` | `ws://localhost:4002/ws` | WebSocket URL used by frontend |

---

## Quick Reference: End-to-End Trace

For a single price update on GOLD, from Kite to pixel:

```
 1. Kite WebSocket sends binary tick for token 53523207

 2. kite-ticker.service.ts "ticks" handler:
    - Looks up 53523207 -> "GOLDM25APRFUT"
    - Builds Quote { lastPrice: 71856, ... }
    - Calls marketDataService.updateQuote("GOLDM25APRFUT", quote)

 3. market-data.service.ts:
    - quotes.set("GOLDM25APRFUT", quote)
    - dirtySymbols.add("GOLDM25APRFUT")

 4. broadcast.service.ts (500ms timer fires):
    - Reads dirtySymbols -> ["GOLDM25APRFUT"]
    - Builds StockSnapshot { symbol: "GOLDM25APRFUT", price: 71856, change: 0.47, ... }
    - Wraps in { type: "market_update", data: [...], timestamp }
    - Calls wsManager.broadcast(msg)
    - Calls marketDataService.clearDirty()

 5. ws-server.ts broadcast():
    - JSON.stringify(msg)
    - Sends to all connected browser WebSocket clients

 6. use-market-data.ts onmessage:
    - JSON.parse(event.data) -> MarketMessage
    - stockMapRef.set("GOLDM25APRFUT", stockData)
    - setStocks([...stockMapRef.values()])

 7. dashboard.tsx re-renders:
    - filteredAndSorted recalculates (useMemo)
    - StockTable receives new array

 8. stock-row.tsx (memo check):
    - prev.stock.price (71842) !== next.stock.price (71856) -> re-render
    - prevPriceRef was 71842, new price is 71856
    - 71856 > 71842 -> data-flash="up" (green flash)
    - setTimeout(500ms) -> remove flash

 9. User sees: GOLDM25APRFUT row flashes green, price updates to 71,856.00
```
