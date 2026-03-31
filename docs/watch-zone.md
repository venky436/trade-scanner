# Watch Zone

## What It Does

The Watch Zone lets users **bookmark up to 10 symbols** to monitor in a dedicated section with live signal updates. Unlike the Best Setups and Watchlist sections which appear/disappear based on real-time conditions, Watch Zone items **persist until the user manually removes them**.

Each bookmarked symbol shows:
- Live price and P&L since added
- Current signal status (ACTIVE / WEAKENING / EXPIRED)
- Original signal context (what signal triggered the bookmark)
- Live momentum and pressure state

---

## Why We Built It

Signals in the scanner appear and disappear within seconds. Users saw a great setup, looked away, and it was gone. There was no way to:
- Track a signal they liked
- Monitor how a setup developed over time
- Compare multiple opportunities side by side

Watch Zone gives users **control over what they monitor** while the system provides **real-time truth** about each symbol's current state.

---

## Core Behavior

### Adding a Symbol

Users click the "+" button on any signal card (Best Setups, Watchlist, scanner). The system stores:

```
{
  userId        — who added it
  symbol        — which stock/index
  addedPrice    — price at the moment of adding
  signalAction  — BUY or SELL (what signal was showing)
  signalType    — BOUNCE / BREAKOUT / REJECTION / BREAKDOWN / CONTINUATION
  addedAt       — timestamp
}
```

### Limits

- Maximum **10 symbols** per user
- If full → must remove one before adding
- Duplicate symbols blocked

### Removal

- Manual only — user clicks "X" on any item
- No auto-removal — expired items stay until user decides

---

## Status System

Each Watch Zone item has a live status computed from real-time engine data compared against the `addedPrice`.

### ACTIVE (🟢)

ALL three must be true:

| Check | BUY Signal | SELL Signal |
|-------|-----------|-------------|
| Price in direction | currentPrice >= addedPrice | currentPrice <= addedPrice |
| Momentum aligned | UP or STRONG_UP | DOWN or STRONG_DOWN |
| Pressure aligned | BUY or STRONG_BUY | SELL or STRONG_SELL |

Means: The trade is working as expected — price moving right, engines still confirming.

### WEAKENING (🟡)

ANY of these (but price still in signal direction):

| Check | BUY Signal | SELL Signal |
|-------|-----------|-------------|
| Momentum weakening | Turned FLAT or DOWN | Turned FLAT or UP |
| Acceleration lost | Not INCREASING | Not DECREASING |
| Pressure weakening | Turned NEUTRAL or SELL | Turned NEUTRAL or BUY |

Means: The trade was working but engines are losing conviction. Consider exiting or tightening stop.

### EXPIRED (🔴)

ANY of these:

| Check | BUY Signal | SELL Signal |
|-------|-----------|-------------|
| Price against (with 0.3% buffer) | currentPrice < addedPrice × 0.997 | currentPrice > addedPrice × 1.003 |
| Both engines flipped | Momentum DOWN + Pressure SELL | Momentum UP + Pressure BUY |

The 0.3% buffer prevents flickering from minor price noise.

Means: The trade is no longer valid — price went against or conditions completely reversed.

---

## Status Flow

```
User clicks "+" on a BUY signal at ₹100
       │
       ▼
┌─────────────────────────────────────────┐
│ Stored: symbol, addedPrice=100,         │
│         signalAction=BUY, signalType    │
└──────────────────┬──────────────────────┘
                   │
                   │ Every WebSocket tick:
                   │ Read live price + momentum + pressure
                   │
                   ▼
        ┌─────────────────────┐
        │ Price=102, Mom=UP,  │
        │ Pressure=BUY        │
        │ → ACTIVE 🟢         │
        └─────────────────────┘
                   │
                   │ Time passes...
                   ▼
        ┌─────────────────────┐
        │ Price=103, Mom=FLAT,│
        │ Pressure=NEUTRAL    │
        │ → WEAKENING 🟡      │
        └─────────────────────┘
                   │
                   │ Conditions reverse...
                   ▼
        ┌─────────────────────┐
        │ Price=99.5, Mom=DOWN│
        │ Pressure=SELL       │
        │ → EXPIRED 🔴        │
        └─────────────────────┘
                   │
                   │ User manually removes
                   ▼
               (removed)
```

---

## UI Layout

Watch Zone appears at the **top of the dashboard** (above Best Setups), only when the user has items:

```
┌──────────────────────────────────────────────────┐
│ 👁 WATCH ZONE                           3/10     │
│                                                   │
│ ┌────────────────────────────────────────────┐    │
│ │ 🟢 NIFTY 50     BUY (Trend)          ❌   │    │
│ │    ₹22,580  +0.35%                        │    │
│ │    Strong Up  Strong Buy                   │    │
│ │    Added 5m ago at ₹22,500                 │    │
│ ├────────────────────────────────────────────┤    │
│ │ 🟡 RELIANCE     BUY (Bounce)         ❌   │    │
│ │    ₹2,565  +0.12%                         │    │
│ │    Flat  Buy                               │    │
│ │    Added 8m ago at ₹2,560                  │    │
│ ├────────────────────────────────────────────┤    │
│ │ 🔴 INFY         BUY (Breakout)       ❌   │    │
│ │    ₹1,480  -0.33%                         │    │
│ │    Down  Sell                              │    │
│ │    Added 12m ago at ₹1,485                 │    │
│ └────────────────────────────────────────────┘    │
│                                                   │
│ Sorted: ACTIVE → WEAKENING → EXPIRED              │
└──────────────────────────────────────────────────┘
```

### "+" Button Placement

Available on:
- Best Setups cards
- Watchlist cards
- (Future: scanner table rows, stock detail page)

Only visible when user is logged in and signal is BUY or SELL (not WAIT).

---

## Architecture

### Storage

PostgreSQL table `watch_zone`:

| Column | Type | Description |
|--------|------|-------------|
| id | serial | Primary key |
| userId | uuid | References users.id (cascade delete) |
| symbol | varchar(50) | Stock/index symbol |
| addedPrice | numeric(12,2) | Price when user clicked "+" |
| signalAction | varchar(10) | BUY or SELL |
| signalType | varchar(20) | BOUNCE / BREAKOUT / CONTINUATION etc. (nullable) |
| addedAt | timestamp | When added |

### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/watch-zone` | Required | Get user's watch zone items |
| POST | `/api/watch-zone` | Required | Add symbol (max 10, rejects duplicates) |
| DELETE | `/api/watch-zone/:symbol` | Required | Remove symbol |

### Data Flow

```
1. User clicks "+" → POST /api/watch-zone (stores in DB)
2. Dashboard loads → GET /api/watch-zone (fetches user's symbols)
3. For each symbol → read live data from stockMap (WebSocket, already available)
4. Compute status (ACTIVE/WEAKENING/EXPIRED) from live engines vs addedPrice
5. Display sorted by status
6. User clicks "❌" → DELETE /api/watch-zone/:symbol
```

**Key principle:** We store only `symbol + addedPrice + signalAction`. All live data (price, momentum, pressure, signal) comes from the existing WebSocket stream — no duplication, always fresh.

---

## Files

| File | Role |
|------|------|
| `apps/server/src/db/schema/watch-zone.ts` | Drizzle table definition |
| `apps/server/src/db/schema/index.ts` | Exports watchZone table |
| `apps/server/src/routes/watch-zone.route.ts` | API endpoints (GET/POST/DELETE) |
| `apps/server/src/server.ts` | Route registration |
| `apps/web/src/components/watch-zone.tsx` | WatchZone component + AddToWatchZoneButton |
| `apps/web/src/components/dashboard.tsx` | Renders WatchZone above Best Setups |
| `apps/web/src/components/top-opportunities.tsx` | "+" button on signal cards |

---

## What Does NOT Change

| Component | Changes? |
|-----------|----------|
| signal-engine.ts | **NO** |
| score-engine.ts | **NO** |
| momentum-engine.ts | **NO** |
| pressure.service.ts | **NO** |
| broadcast.service.ts | **NO** |
| signal-accuracy.service.ts | **NO** |
| Existing DB tables (users, signal_accuracy_log, refresh_tokens) | **NO** |
| Existing UI components (scanner table, SR cards, stock detail) | **NO** |

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| PostgreSQL storage | Persists across devices/sessions (user has auth system) |
| Max 10 items | Prevents clutter, forces user to prioritize |
| Manual remove only | No surprise deletions — user controls what they track |
| Status from live data, not snapshot | Always shows current reality, never stale |
| addedPrice stored | Enables P&L calculation and accurate status detection |
| 0.3% buffer for EXPIRED | Prevents flickering from minor price noise |
| signalType stored | Shows "Added on: BUY (Support Bounce)" for context |
| Sorted by status | ACTIVE first — most important items always on top |
| "+" only on BUY/SELL cards | WAIT signals aren't bookmarkable — nothing to track |

---

## Deployment Note

After deploying, create the new table:

```bash
docker exec -it trading-backend npx drizzle-kit push
```

Or generate and run a migration:

```bash
npm run db:generate -w apps/server
npm run db:migrate -w apps/server
```
