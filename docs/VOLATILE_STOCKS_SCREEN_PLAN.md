# Volatile Stocks Screen — Plan

> **Status:** Awaiting approval before implementation
> **Target:** Ready by 2026-06-18 09:00 IST (before market open)
> **Use case:** Live intraday trading aid — surface stocks that are moving *right now* with enough volume to actually trade

---

## 1. Why this screen exists

Starting tomorrow you're trading real money intraday. The existing dashboard (Strong Alignment / Near Support / Near Resistance) is built around *structural setups* — confidence-ranked stocks at meaningful levels. That's the right lens for swing thinking, but during a live intraday session you also need a different question answered:

> "Which stocks are moving enough RIGHT NOW that I can scalp them, and is the move backed by real volume?"

This screen answers exactly that — nothing else.

---

## 2. Hard requirements (locked scope for v1)

1. **New tab "Volatile"** on the existing dashboard — next to the existing stocks/options mode toggle, so the page you already use stays as-is.
2. **Backend filters** — server returns only stocks meeting:
   - `ATR% ≥ 1.5%` (enough intraday range to make a profit after slippage)
   - `RVOL ≥ 1.5×` (volume confirms the volatility is real, not low-liquidity noise)
3. **Price-range preset chips** — user clicks one bucket: `<250 · 250–500 · 500–1000 · 1000–2500 · >2500` (always-on default = "All").
4. **Sort toggles** — chips above the grid: `ATR% · RVOL · % Change · Last-Candle Vol Spike` (default = ATR% DESC).
5. **Each card shows**: price + % change, ATR%, RVOL, day's-range bar, distance to nearest S/R, **last 3 closed 5-min candles with direction + volume + ×avg**, zone, pattern (if any). Click → existing stock detail page.
6. **Live updates** — re-ranks via the same WebSocket the dashboard already uses. List shifts naturally when a new 5-min candle closes.
7. **No new infra** — uses existing candle tracker, levels service, ATR module, market-data service. Zero new env vars, zero new dependencies.

### Explicitly deferred (NOT in v1 — confirmed with user)
- Alerts / starred stocks
- Sector correlation
- Custom min/max price input (presets only)
- Suggested entry/SL/target on card (AI module already does this in detail view)
- Mobile-specific layout tweaks

---

## 3. How "high volatility" is detected

### The primary metric — ATR%

```
ATR% = ATR(14) / current_price × 100
```

ATR(14) is the average true range of the last 14 closed 5-min candles. Dividing by price normalises across stocks so you can compare a ₹150 stock to a ₹2500 stock fairly.

**Why % matters:** ₹10 range on a ₹2500 stock = 0.4% (calm). ₹10 range on a ₹200 stock = 5% (wild). Without %, only cheap stocks would ever surface.

**Thresholds:**
| ATR% range | Meaning | Action |
|---|---|---|
| < 1.0% | Too quiet — slippage eats edge | Skip |
| 1.0–1.5% | Marginal | Maybe |
| **1.5–2.5%** | **Healthy intraday range** | **Default qualifying band** |
| > 2.5% | Very volatile, large swings | Trade with smaller size |

ATR is already computed in `apps/server/src/lib/atr.ts` and used by the AI module — nothing new to write.

### The liquidity gate — RVOL ≥ 1.5

```
RVOL = current_5min_volume / 20-day_avg_5min_volume
```

Volatility on thin volume is a trap: you move the price yourself and get bad fills. Requiring `RVOL ≥ 1.5` ensures the movement is supported by real participants. RVOL is already computed in `stock-filter.service.ts` and used in the AI prompt — reuse.

### Why both gates together

| ATR% | RVOL | Verdict |
|---|---|---|
| High | High | ✅ Real, tradeable volatility — show it |
| High | Low | ❌ Illiquid trap — hide it |
| Low | High | ❌ Volume without movement — hide it |
| Low | Low | ❌ Nothing happening — hide it |

---

## 4. Example — what the user actually sees

### Scenario
It's 10:18 AM. NIFTY is up 0.4%. RELIANCE just closed its 10:15 candle on heavy volume after closing 10:10 + 10:05 on rising volume.

### User flow
1. Opens `tradescanner.io` → already on dashboard
2. Clicks **Volatile** tab
3. Clicks price-range chip **₹250–500** (because they want to trade mid-priced stocks today)
4. Sort is default ATR% DESC
5. Sees ~8 cards, RELIANCE is #3

### One RELIANCE card

```
┌─────────────────────────────────────────────┐
│ RELIANCE          ₹487.30   +1.8% ↑         │
│ ATR 2.1%  ·  RVOL 2.4×                       │
│ ▓▓▓▓▓▓▓░░░  72% of day range                 │
│ +₹3.20 (0.6%) to resistance                  │
│                                              │
│ Last 3 × 5m candles (newest → oldest):       │
│  10:15  ▲  124K   (1.8× avg)                 │
│  10:10  ▲   89K   (1.3× avg)                 │
│  10:05  ▼   62K   (0.9× avg)                 │
│                                              │
│ Zone: NEAR_RESISTANCE  ·  Pattern: —         │
└─────────────────────────────────────────────┘
```

### What the trader reads in 2 seconds

- **+1.8%, ATR 2.1%, RVOL 2.4×** → stock is alive and well-traded
- **72% of day range + ₹3.20 to resistance** → near today's top, watch for rejection OR breakout
- **3 candles: 62K↓ → 89K↑ → 124K↑** → volume *building* on *up* candles = buyers stepping in
- **Zone NEAR_RESISTANCE** → if breakout happens, momentum is supported

Decision: "Wait for the 10:20 candle. If it closes above resistance on > 124K volume, enter long with SL just below 10:15 low."

That's a complete intraday trade thesis from one card in 2 seconds. **That's what the screen is for.**

### Auto-refresh
At 10:20:00 a new 5-min candle closes. The card updates:
- "Last 3 candles" shifts: 10:10 89K → 10:15 124K → 10:20 ???K
- Card re-ranks within the list if ATR% changed enough to pass another stock

No page refresh needed — the existing WebSocket already pushes ticks.

---

## 5. End-to-end flowchart

```
                          USER FLOW
   ┌──────────────────────────────────────────────────────┐
   │  User opens tradescanner.io                          │
   │            │                                         │
   │            ▼                                         │
   │  Dashboard mounts (existing /dashboard route)        │
   │            │                                         │
   │            ▼                                         │
   │  Clicks "Volatile" tab  (new — sits alongside the   │
   │                          existing Stocks/Options    │
   │                          mode toggle)                │
   │            │                                         │
   │            ▼                                         │
   │  Selects price-range chip: e.g. "₹250–500"           │
   │  Selects sort chip:        e.g. "ATR%"               │
   └──────────────────────────────────────────────────────┘
                  │
                  ▼
              FRONTEND
   ┌──────────────────────────────────────────────────────┐
   │  use-volatile-stocks.ts hook                         │
   │  GET /api/sections/volatile                          │
   │       ?priceMin=250&priceMax=500                     │
   │       &sortBy=atrPct                                 │
   │  Re-polls every 30s + on every WS tick               │
   └──────────────────────────────────────────────────────┘
                  │
                  ▼
               BACKEND
   ┌──────────────────────────────────────────────────────┐
   │  /api/sections/volatile  (in sections.route.ts)      │
   │     │                                                │
   │     ▼                                                │
   │  Build candidate pool (same as existing /api/sections│
   │  — toIntelligence() over every tracked symbol)       │
   │     │                                                │
   │     ▼                                                │
   │  selectVolatile(snapshots, {priceMin, priceMax,      │
   │                              sortBy})                │
   │  defined in section-selector.ts (pure function):     │
   │    1. drop indices                                   │
   │    2. compute atrPct & rvol for each candidate       │
   │    3. filter:  atrPct ≥ 1.5%                         │
   │             AND rvol  ≥ 1.5                          │
   │             AND price in [priceMin, priceMax]        │
   │    4. for each surviving stock, attach:              │
   │         • last 3 closed 5-min candles                │
   │         • their direction (up/down)                  │
   │         • their volume vs the 20-day-avg per-5m vol  │
   │         • day's range position                       │
   │         • distance to nearest S/R level              │
   │    5. sort by sortBy DESC                            │
   │    6. cap at 20 (avoid wall of cards)                │
   └──────────────────────────────────────────────────────┘
                  │
                  ▼
            API RESPONSE
   ┌──────────────────────────────────────────────────────┐
   │  { stocks: VolatileStock[], meta: {...} }            │
   │  See §7 for full shape                               │
   └──────────────────────────────────────────────────────┘
                  │
                  ▼
              FRONTEND
   ┌──────────────────────────────────────────────────────┐
   │  Renders <VolatileCard> grid (3-up on desktop)       │
   │  Each card: hero + metrics + 3-candle list + zone    │
   │  Click → existing /stock/[symbol] detail page        │
   └──────────────────────────────────────────────────────┘


                       LIVE UPDATE
   ┌──────────────────────────────────────────────────────┐
   │  Existing WS pushes tick to useMarketData()          │
   │            │                                         │
   │            ▼                                         │
   │  Hook re-fetches /api/sections/volatile (debounced)  │
   │            │                                         │
   │            ▼                                         │
   │  Card-level numbers animate; list re-ranks if needed │
   └──────────────────────────────────────────────────────┘
```

---

## 6. Backend changes

### New files

| File | Purpose |
|---|---|
| `apps/server/src/lib/volatility-metrics.ts` | Pure functions: `computeAtrPct(atr, price)`, `computeRvol(currentVol, avg5MinVol)`, `computeDayRangePosition(price, dayHigh, dayLow)`, `getLastNClosedCandles(symbol, n, candleTracker)`, `computeCandleAvgVolume(allCandles)`. All pure, tested, no side effects. |

### Modified files (additive — no breaking changes)

| File | Change |
|---|---|
| `apps/server/src/lib/section-selector.ts` | Add `VOLATILE_ATR_PCT_FLOOR = 1.5`, `VOLATILE_RVOL_FLOOR = 1.5`, `VOLATILE_CAP = 20`, and a new pure function `selectVolatile(snapshots, opts)` returning the filtered + ranked list of *enriched* records (snapshot + computed metrics + last-3 candles). |
| `apps/server/src/routes/sections.route.ts` | Add a new `GET /api/sections/volatile` handler. Accepts `priceMin`, `priceMax`, `sortBy` query params. Reuses the existing dep-injection pattern (gets `getRecentCandles`, `getCachedLevels`, etc. from the deps already wired in). |
| `apps/server/src/lib/types.ts` | Add `VolatileSortKey = "atrPct" \| "rvol" \| "changePct" \| "lastCandleVolSpike"` and `VolatileStock` interface. |

### Why no new services
- ATR exists (`apps/server/src/lib/atr.ts`)
- RVOL exists (used in `ai-prompt.ts` + `stock-filter.service.ts`)
- Last-N candles exists (`candle-tracker.service.ts` → `getRecentCandles()`)
- S/R levels exist (`levels.service.ts` → `getCachedLevels()`)
- Day's high/low: comes from the quote (`marketDataService.getQuote(sym)` already returns `high`, `low`)
- Tick-driven WS broadcast already updates the dashboard

It's all there. We're just composing it differently in one new pure function + one new route.

---

## 7. API response shape

`GET /api/sections/volatile?priceMin=250&priceMax=500&sortBy=atrPct`

```ts
{
  stocks: [
    {
      symbol: "RELIANCE",
      price: 487.30,
      changePct: 1.8,
      // Volatility metrics
      atrPct: 2.1,
      rvol: 2.4,
      // Day's range
      dayHigh: 489.50,
      dayLow: 478.10,
      dayRangePosition: 0.72,    // 0..1 — where in today's H-L is price
      // Nearest level
      nearestLevel: {
        kind: "RESISTANCE",      // or "SUPPORT"
        price: 490.50,
        distanceAbs: 3.20,
        distancePct: 0.66,
      } | null,
      // Last 3 closed 5-min candles (newest first)
      recentCandles: [
        { time: 1718675700, direction: "up",   volume: 124000, volMultiplier: 1.8 },
        { time: 1718675400, direction: "up",   volume:  89000, volMultiplier: 1.3 },
        { time: 1718675100, direction: "down", volume:  62000, volMultiplier: 0.9 },
      ],
      // Context for the bottom strip
      zone: "NEAR_RESISTANCE",
      pattern: null,             // or "HAMMER" / "ENGULFING" etc.
    },
    // ... up to 20 stocks
  ],
  meta: {
    atrPctFloor: 1.5,
    rvolFloor: 1.5,
    cap: 20,
    sortBy: "atrPct",
    priceMin: 250,
    priceMax: 500,
    poolSize: 184,               // total tracked symbols evaluated
    matchedCount: 8,
  }
}
```

---

## 8. Frontend changes

### New files

| File | Purpose |
|---|---|
| `apps/web/src/components/volatile-card.tsx` | The new card. Self-contained — reads the enriched `VolatileStock` and renders the layout from §4. Includes the 3-candle vertical list with up/down arrows and per-candle vol multiplier. Click → `/stock/[symbol]`. |
| `apps/web/src/components/volatile-filter-bar.tsx` | Price-range chip group + sort chip group. Controlled component — emits `{priceMin, priceMax, sortBy}` to parent. |
| `apps/web/src/hooks/use-volatile-stocks.ts` | `useVolatileStocks({priceMin, priceMax, sortBy})` — polls `/api/sections/volatile` every 30s, also re-fetches on every WS tick from `useMarketData()` (debounced 2s). Returns `{ stocks, isLoading, meta }`. |

### Modified files

| File | Change |
|---|---|
| `apps/web/src/components/dashboard.tsx` | Extend `ScannerMode` to `"stocks" \| "options" \| "volatile"`. Add a 3rd `<ModeToggle>` button. When `mode === "volatile"`, render `<VolatileFilterBar>` + grid of `<VolatileCard>` instead of the existing 3 lanes. |
| `apps/web/src/lib/types.ts` | Add `VolatileStock` interface + `VolatileSortKey` union, mirroring the server. |

### Why no new route
Putting it as a 3rd tab on the existing dashboard means:
- Zero new layout chrome (header/nav already there)
- One click from where the user already is
- Mode toggle pattern is already in the code (`stocks`/`options`)
- The existing market-context banner stays at the top — useful intraday context

---

## 9. Implementation phases (tonight)

Staged so each phase is independently verifiable.

| # | Phase | Outcome | Est. |
|---|---|---|---|
| 1 | `volatility-metrics.ts` + unit tests | `bun test` green for ATR%, RVOL, day-range-position, vol-multiplier | 45 min |
| 2 | `selectVolatile()` in section-selector.ts + tests | Test passes a synthetic snapshot pool → returns expected filtered/ranked result | 30 min |
| 3 | `GET /api/sections/volatile` route + curl smoke | `curl 'localhost:4002/api/sections/volatile?priceMin=250&priceMax=500&sortBy=atrPct' \| jq` returns expected shape | 30 min |
| 4 | `use-volatile-stocks.ts` hook | React DevTools shows hook returns data; no infinite-loop fetches | 30 min |
| 5 | `volatile-card.tsx` — hero + metrics row | Card renders one stock from mock data (visual check) | 1 hr |
| 6 | `volatile-card.tsx` — 3-candle list + day-range bar + distance | Full card layout matches §4 | 1 hr |
| 7 | `volatile-filter-bar.tsx` — chips + sort | Clicking a chip filters/sorts the grid live | 45 min |
| 8 | Wire into `dashboard.tsx` — new tab + render | Full flow works end-to-end on `localhost:3000` | 30 min |
| 9 | Visual polish + edge cases (empty state, < 3 candles, no S/R) | All edge cases handled gracefully | 45 min |
| 10 | Deploy: branch, PR, merge, droplet pulls + restarts | Production shows the new tab by 8:30 AM IST | 30 min |

**Total: ~6.5 hours.** Buffer to 8 hours including testing.

---

## 10. Verification checklist

Before declaring done (run in this order):

### Backend
1. **Unit tests** — `cd apps/server && bun test` — all new tests green, no existing tests broken.
2. **Endpoint sanity** — with the dev server up:
   ```bash
   curl 'http://localhost:4002/api/sections/volatile?sortBy=atrPct' | jq '.stocks[0]'
   ```
   First stock should have ATR% ≥ 1.5 AND RVOL ≥ 1.5, and `recentCandles` should have 0–3 entries (0 only during the very first 15 min of the session).

3. **Price filter** — same curl with `?priceMin=250&priceMax=500` returns only stocks with `250 ≤ price ≤ 500`.

4. **Sort works** — change `sortBy=rvol` and check `stocks[0].rvol ≥ stocks[1].rvol`.

5. **Meta is accurate** — `meta.matchedCount === stocks.length`.

### Frontend
6. **Tab switches cleanly** — click Volatile → grid appears; click Stocks → original lanes return; no console errors, no flicker.

7. **Live update** — leave the tab open during market hours; numbers tick, 3-candle list rolls forward when a new 5-min candle closes.

8. **Empty state** — set absurd filter (e.g. `priceMin=99999`) → friendly empty message, not blank screen.

9. **Click-through** — clicking a card opens `/stock/SYMBOL` and the detail page works as before.

10. **No regressions** — existing Strong Alignment / Near Support / Near Resistance lanes are visually identical to before. Existing AI module + WS still work.

### Production
11. **CI green** before merge.
12. **Auto-deploy completes** — `docker ps` on droplet shows backend + web containers healthy.
13. **Live check** — open `tradescanner.io`, switch to Volatile tab, confirm cards render before 09:00.

---

## 11. Out of scope (intentional)

- **Per-user filter preferences (saved settings)** — defer until you know which preset you use most.
- **Mobile-optimised layout** — desktop-first for v1; mobile works but isn't tuned.
- **CSV export** — not needed during a live session.
- **Volatility *trend* (rising/falling over the last hour)** — interesting but adds complexity; ATR% is already an avg so it self-smooths.
- **Sound alerts on volume spike** — phase 2 if you find yourself glued to the screen waiting for these.
- **Toggle to include/exclude indices** — indices are auto-excluded.
- **Combining this with the AI module** — AI verdict will *automatically* show on the detail page when you click through, since `useAiCall(symbol)` already fires there. No extra work.

---

## 12. Risk + mitigation

| Risk | Mitigation |
|---|---|
| ATR% floor too tight at open → empty grid for 30 min | Show a friendly "Market still waking up — volatility data builds over the first 15 min" empty state |
| Too many cards in mid-session | Hard cap at 20; user picks price-range chip to narrow |
| WS re-fetch hammers the endpoint | Debounce to max 1 fetch per 2s in the hook |
| Computed metrics drift from AI module's view of the same stock | Both call the same `atr.ts` and same RVOL formula — single source of truth, will not drift |
| Breaking existing dashboard | All changes are additive (new tab, new component, new endpoint, new pure function); existing modes/lanes untouched |

---

## 13. After v1 (data → improvement)

After 1 week of live use, the questions to answer:
- Are the chips you actually use covering the right price bands? (Add custom range if not.)
- Is `RVOL ≥ 1.5` too restrictive or too loose? (Tune.)
- Which sort do you reach for most? (Make it default.)
- Did the 3-candle volume strip help you avoid bad entries? (If yes, expand to 5; if no, shrink to 1.)
- Should AI verdict appear *on the card itself* (not just on detail click)? (Probably yes if you find yourself opening details every time.)

These are tuning, not redesign — the architecture supports all of them by editing constants.
