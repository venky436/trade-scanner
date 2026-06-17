# Day Movers Screen — Plan

> **Status:** Awaiting approval before implementation
> **Target:** Ready by 2026-06-18 09:00 IST (after the Volatile Stocks screen ships)
> **Use case:** Live intraday trading aid — surface stocks that have already made a *large directional move* from today's open, in either direction → reversal-hunting candidates

> **Sibling to:** `VOLATILE_STOCKS_SCREEN_PLAN.md`. These two screens are intentionally separate because they answer different trading questions:
> | Screen | Question | Trading mode |
> |---|---|---|
> | Volatile | "What's moving *right now*?" | Momentum scalp |
> | **Day Movers** | "What's already moved *a lot* today?" | **Reversal hunt** |

---

## 1. Why this screen exists

During live intraday trading there are two distinct opportunity types:
1. **Momentum scalps** — stocks moving right now, ride the trend → handled by the Volatile screen
2. **Reversal trades** — stocks that have *already* made a big directional move and look exhausted → handled by **this screen**

Your example: a stock opens at ₹250 and rallies to ₹320 by 10am (+28%). That's a reversal short candidate. The Volatile screen might miss it (if the stock has since gone flat, ATR% would be low). This screen catches it.

The key insight: **direction doesn't matter for surfacing — only magnitude.** A stock down 12% and a stock up 12% are equally interesting; one is a short-reversal candidate, the other a long-reversal candidate.

---

## 2. Hard requirements (locked scope for v1)

1. **New tab "Day Movers"** on the dashboard — sits alongside Stocks / Options / Volatile in the mode toggle. One click from where you are.
2. **Backend filters** — server returns only stocks meeting:
   - `|Day Move %| ≥ 3%` (meaningful directional move, not noise)
   - `RVOL ≥ 1.0×` (the move has at least average volume behind it — filters illiquid gappers)
3. **Direction chips** — `All · Gainers · Losers` (default = All).
4. **Price-range preset chips** — same as Volatile: `<250 · 250–500 · 500–1000 · 1000–2500 · >2500` (default = All).
5. **Sort toggles** — `|Day Move %| · Day Move % (signed) · RVOL · Last-Candle Vol Spike` (default = `|Day Move %|` DESC).
6. **Each card shows**: price, **Day Move % (big, signed, color-coded)**, open price, day high/low, distance to day high and day low, RVOL, **last 3 closed 5-min candles with direction + volume + ×avg**, zone, pattern (if any). Click → existing stock detail page.
7. **Live updates** — re-ranks via the existing WebSocket. As price moves, day move % updates in real-time.
8. **No new infra** — reuses everything the Volatile screen will already have wired (`volatility-metrics.ts`, candle tracker, levels, market-data quotes). Adds one new pure function for the day-move filter.

### Explicitly deferred (NOT in v1)
- Custom min-move % input (chips only: 3% / 5% / 10% if needed later)
- Sector-grouped view ("which sectors are moving most today")
- Pre-market gap detection (today's open vs yesterday's close)
- Historical context ("is +12% normal for this stock?") — needs longer history than session

---

## 3. How "big day movers" are detected

### The signal — Day Move %

```
dayMovePct = (currentPrice - dayOpen) / dayOpen × 100
```

`dayOpen` comes from `marketDataService.getQuote(sym).open` — already populated by the existing market-data service. Zero new infra; just one subtraction + division.

### Why absolute value matters

A stock down 14% and a stock up 28% are equally tradeable as reversal candidates — the direction tells you whether to short or long the reversal, not whether the stock is *interesting*. So we filter and rank on `|dayMovePct|`:

| Stock | Open | Now | Day Move | `|dayMove|` | Qualifies? |
|---|---|---|---|---|---|
| EXAMPLECO_A | ₹250 | ₹320 | +28% | 28% | ✅ |
| EXAMPLECO_B | ₹500 | ₹430 | −14% | 14% | ✅ |
| EXAMPLECO_C | ₹100 | ₹101 | +1% | 1% | ❌ |

EXAMPLECO_A is a long that may be exhausted → look for short reversal setup.
EXAMPLECO_B is a short that may be exhausted → look for long reversal setup.
EXAMPLECO_C is normal noise → hide.

### Threshold — why ≥ 3%

| `|dayMove|` | Meaning | Default action |
|---|---|---|
| < 2% | Normal day noise | Skip |
| 2–3% | Borderline | Skip (too many qualifiers, noisy grid) |
| **≥ 3%** | Meaningful move, exhaustion-watch candidate | **Show** |
| ≥ 5% | Notable mover | Show, ranks high |
| ≥ 10% | Outlier / news-driven move | Show, top of list |

Single constant in `section-selector.ts` — easy to retune after 1 week of use.

### Why RVOL ≥ 1.0 (not 1.5 like Volatile)

A stock that's already moved 8% is *itself* proof of activity — the move couldn't have happened without volume. We just want to filter out:
- Stocks that gapped up at open then went flat with no real trading interest
- Illiquid stocks where one trade printed a fake move

`RVOL ≥ 1.0` (at-least-average volume) is the right floor for this — strict enough to filter junk, loose enough not to hide real news-driven movers.

### Direction filter

The chip set controls which side(s) of the OR-gate apply:
- **All** → both gainers and losers shown
- **Gainers** → only `dayMovePct ≥ +3%`
- **Losers** → only `dayMovePct ≤ −3%`

---

## 4. Example — what the user actually sees

### Scenario
It's 10:18 AM. EXAMPLECO opened at ₹250 and is now at ₹320 (+28%). The stock has been ripping all morning but the last 2 candles are showing high volume + small bodies → looks like it might be exhausted.

### User flow
1. Opens `tradescanner.io` → already on dashboard
2. Clicks **Day Movers** tab
3. Default sort = `|Day Move %|` DESC → biggest movers up top
4. EXAMPLECO is #1

### One EXAMPLECO card

```
┌─────────────────────────────────────────────┐
│ EXAMPLECO         ₹320.00                    │
│ Day Move: +28.0%  ↑                          │
│ Open ₹250.00  ·  H ₹322.50  ·  L ₹248.75    │
│                                              │
│ RVOL 2.8×                                    │
│ ▓▓▓▓▓▓▓▓▓▓  99% of day range                 │
│ +₹2.50 to day high  ·  ₹71.25 from day low   │
│                                              │
│ Last 3 × 5m candles (newest → oldest):       │
│  10:15  ▼   72K   (1.4× avg)                 │
│  10:10  ▲   85K   (1.6× avg)                 │
│  10:05  ▲  140K   (2.7× avg)                 │
│                                              │
│ Zone: NEAR_RESISTANCE  ·  Pattern: SHOOTING  │
└─────────────────────────────────────────────┘
```

### What the trader reads in 2 seconds

- **Day Move +28% ↑** → huge rally already happened. Long entry now = chasing.
- **Open ₹250 → Now ₹320** → 70-rupee move. Big.
- **99% of day range, +₹2.50 to day high** → at the top, no room left up. Stretched.
- **Last 3 candles: 140K↑ → 85K↑ → 72K↓** → volume PEAKED at 10:05 (140K), now dropping AND last candle was a down candle. Exhaustion signal.
- **Pattern: SHOOTING STAR** → classic top reversal.

Decision: "Watch the 10:20 candle. If it closes below 10:15 low on rising volume, enter short with SL above day high (₹322.50), target back to ₹305."

That's a complete reversal-short thesis from one card in 2 seconds.

### Scenario B — a falling stock
EXAMPLECO_B opened at ₹500, slid to ₹430 (−14%). User sets direction chip = **Losers**:

```
┌─────────────────────────────────────────────┐
│ EXAMPLECO_B       ₹430.00                    │
│ Day Move: −14.0%  ↓                          │
│ Open ₹500.00  ·  H ₹502.10  ·  L ₹428.50    │
│                                              │
│ RVOL 3.1×                                    │
│ ▓░░░░░░░░░  2% of day range                  │
│ ₹72.10 from day high  ·  +₹1.50 to day low   │
│                                              │
│ Last 3 × 5m candles (newest → oldest):       │
│  10:15  ▲   95K   (1.8× avg)                 │
│  10:10  ▼  180K   (3.4× avg)                 │
│  10:05  ▼  165K   (3.1× avg)                 │
│                                              │
│ Zone: NEAR_SUPPORT  ·  Pattern: HAMMER       │
└─────────────────────────────────────────────┘
```

Reads: "Down 14%, sitting at day low, last candle was up on decent volume after two heavy down candles, hammer formed at support" → long reversal setup. Enter on next green candle, SL just below day low.

---

## 5. End-to-end flowchart

```
                          USER FLOW
   ┌──────────────────────────────────────────────────────┐
   │  User opens tradescanner.io                          │
   │            │                                         │
   │            ▼                                         │
   │  Clicks "Day Movers" tab (4th in ModeToggle)         │
   │            │                                         │
   │            ▼                                         │
   │  Selects direction:  [All | Gainers | Losers]        │
   │  Selects price band: [<250 ... >2500]                │
   │  Selects sort:       [|Day Move %| | Day Move %      │
   │                       (signed) | RVOL | VolSpike]    │
   └──────────────────────────────────────────────────────┘
                  │
                  ▼
              FRONTEND
   ┌──────────────────────────────────────────────────────┐
   │  use-day-movers.ts hook                              │
   │  GET /api/sections/day-movers                        │
   │       ?direction=all                                 │
   │       &priceMin=250&priceMax=500                     │
   │       &sortBy=absDayMove                             │
   │  Re-polls every 30s + on every WS tick (debounced)   │
   └──────────────────────────────────────────────────────┘
                  │
                  ▼
               BACKEND
   ┌──────────────────────────────────────────────────────┐
   │  /api/sections/day-movers  (in sections.route.ts)    │
   │     │                                                │
   │     ▼                                                │
   │  Build candidate pool (same toIntelligence() pass    │
   │  as the existing /api/sections endpoint)             │
   │     │                                                │
   │     ▼                                                │
   │  selectDayMovers(snapshots, opts)                    │
   │  in section-selector.ts (pure function):             │
   │    1. drop indices                                   │
   │    2. compute dayMovePct & rvol for each candidate   │
   │       (dayMovePct = (price - open) / open × 100)     │
   │    3. filter:  |dayMovePct| ≥ 3.0                    │
   │             AND rvol         ≥ 1.0                   │
   │             AND price in [priceMin, priceMax]        │
   │             AND direction matches chip               │
   │    4. for each surviving stock, attach:              │
   │         • dayOpen, dayHigh, dayLow                   │
   │         • last 3 closed 5-min candles + vol × avg    │
   │         • day's range position                       │
   │         • distance to day high (₹ + %)               │
   │         • distance to day low  (₹ + %)               │
   │    5. sort by sortBy DESC                            │
   │    6. cap at 20                                      │
   └──────────────────────────────────────────────────────┘
                  │
                  ▼
            API RESPONSE
   ┌──────────────────────────────────────────────────────┐
   │  { stocks: DayMover[], meta: {...} }                 │
   │  See §7                                              │
   └──────────────────────────────────────────────────────┘
                  │
                  ▼
              FRONTEND
   ┌──────────────────────────────────────────────────────┐
   │  Renders <DayMoverCard> grid                         │
   │  Each card: hero with big signed Day Move %,         │
   │             open/H/L row, distances, 3-candle list   │
   │  Click → existing /stock/[symbol] detail page        │
   └──────────────────────────────────────────────────────┘


                       LIVE UPDATE
   ┌──────────────────────────────────────────────────────┐
   │  Existing WS pushes tick to useMarketData()          │
   │            │                                         │
   │            ▼                                         │
   │  Hook re-fetches /api/sections/day-movers (debounced)│
   │            │                                         │
   │            ▼                                         │
   │  Day Move % animates as price ticks                  │
   │  List re-ranks if needed (e.g. EXAMPLECO_B falls     │
   │  another 1% and overtakes EXAMPLECO_A)               │
   └──────────────────────────────────────────────────────┘
```

---

## 6. Backend changes

> Most of the heavy lifting (volatility-metrics module, sections route file structure) will already exist after the **Volatile screen** ships first. This screen reuses that scaffolding.

### New files
None — all additions land in existing files created by the Volatile screen work.

### Modified files (additive — no breaking changes)

| File | Change |
|---|---|
| `apps/server/src/lib/volatility-metrics.ts` *(created by Volatile screen)* | Add pure functions: `computeDayMovePct(price, open)`, `computeDistanceFromHigh(price, high)`, `computeDistanceFromLow(price, low)`. Reuse existing `getLastNClosedCandles` + `computeCandleAvgVolume`. |
| `apps/server/src/lib/section-selector.ts` | Add constants `DAY_MOVERS_PCT_FLOOR = 3.0`, `DAY_MOVERS_RVOL_FLOOR = 1.0`, `DAY_MOVERS_CAP = 20`. Add pure function `selectDayMovers(snapshots, opts)` returning filtered + ranked enriched records. |
| `apps/server/src/routes/sections.route.ts` | Add `GET /api/sections/day-movers` handler. Accepts `direction`, `priceMin`, `priceMax`, `sortBy` query params. Reuses existing dep-injection (getRecentCandles, getCachedLevels, etc.). |
| `apps/server/src/lib/types.ts` | Add `DayMoverSortKey = "absDayMove" \| "signedDayMove" \| "rvol" \| "lastCandleVolSpike"` and `DayMover` interface. |

### Why no new services
- `marketDataService.getQuote(sym)` already returns `open`, `high`, `low`, `close`, `lastPrice`
- RVOL formula is identical to Volatile screen — same module
- Candle tracker → `getRecentCandles()` — already used
- Levels → `getCachedLevels()` — already wired

It's purely composition of existing inputs into one new pure function + one new route handler.

---

## 7. API response shape

`GET /api/sections/day-movers?direction=all&priceMin=250&priceMax=500&sortBy=absDayMove`

```ts
{
  stocks: [
    {
      symbol: "EXAMPLECO",
      price: 320.00,
      // Day move metrics
      dayOpen: 250.00,
      dayHigh: 322.50,
      dayLow:  248.75,
      dayMovePct:    28.0,   // signed
      absDayMovePct: 28.0,   // for ranking
      direction: "up",       // "up" | "down"
      // Distances (always positive)
      distanceFromHighAbs: 2.50,
      distanceFromHighPct: 0.78,
      distanceFromLowAbs:  71.25,
      distanceFromLowPct:  28.65,
      dayRangePosition:    0.99,   // 0..1
      // Volume
      rvol: 2.8,
      // Last 3 closed 5-min candles (newest first)
      recentCandles: [
        { time: 1718675700, direction: "down", volume:  72000, volMultiplier: 1.4 },
        { time: 1718675400, direction: "up",   volume:  85000, volMultiplier: 1.6 },
        { time: 1718675100, direction: "up",   volume: 140000, volMultiplier: 2.7 },
      ],
      // Context
      zone: "NEAR_RESISTANCE",
      pattern: "SHOOTING_STAR",
    },
    // ... up to 20 stocks
  ],
  meta: {
    dayMovePctFloor: 3.0,
    rvolFloor: 1.0,
    cap: 20,
    direction: "all",
    sortBy: "absDayMove",
    priceMin: 250,
    priceMax: 500,
    poolSize: 184,
    matchedCount: 12,
    gainersCount: 8,
    losersCount: 4,
  }
}
```

---

## 8. Frontend changes

> Reuses `<PriceRangeChips>` and the chip-styling utilities created for the Volatile screen.

### New files

| File | Purpose |
|---|---|
| `apps/web/src/components/day-mover-card.tsx` | New card. Hero emphasises the big signed Day Move % (green/red) and the open→now move. Reuses the 3-candle list component from the Volatile card (extracted into a shared component during Volatile screen work, or inlined again — decided during implementation). |
| `apps/web/src/components/day-movers-filter-bar.tsx` | Direction chips (All / Gainers / Losers) + reused price-range chips + sort chips. Controlled component — emits `{direction, priceMin, priceMax, sortBy}`. |
| `apps/web/src/hooks/use-day-movers.ts` | `useDayMovers(opts)` — polls `/api/sections/day-movers` every 30s + debounced WS-tick re-fetch. Returns `{ stocks, isLoading, meta }`. |

### Modified files

| File | Change |
|---|---|
| `apps/web/src/components/dashboard.tsx` | Extend `ScannerMode` to `"stocks" \| "options" \| "volatile" \| "dayMovers"`. Add 4th button to `<ModeToggle>`. When `mode === "dayMovers"`, render `<DayMoversFilterBar>` + grid of `<DayMoverCard>`. |
| `apps/web/src/lib/types.ts` | Add `DayMover` interface + `DayMoverSortKey` union, mirroring server. |

---

## 9. Implementation phases

Builds *after* the Volatile screen ships, since this reuses its scaffolding. Estimated 3 hrs (vs 6.5 hrs for Volatile) because most components and the metrics module already exist.

| # | Phase | Outcome | Est. |
|---|---|---|---|
| 1 | Extend `volatility-metrics.ts`: `computeDayMovePct` + distance helpers + tests | `bun test` green | 30 min |
| 2 | `selectDayMovers()` in section-selector.ts + tests | Test passes synthetic pool → returns expected filtered/ranked result | 30 min |
| 3 | `GET /api/sections/day-movers` route + curl smoke | `curl '.../api/sections/day-movers?direction=all&sortBy=absDayMove' \| jq` returns expected shape | 20 min |
| 4 | `use-day-movers.ts` hook | React DevTools shows hook returns data; no infinite loop | 20 min |
| 5 | `day-mover-card.tsx` — hero with big signed Day Move % + open/H/L row | Card renders one stock from mock data | 45 min |
| 6 | `day-mover-card.tsx` — distances + 3-candle list + zone/pattern footer | Full card matches §4 | 30 min |
| 7 | `day-movers-filter-bar.tsx` — direction + price + sort chips | Clicking chips re-fetches with new params | 30 min |
| 8 | Wire into `dashboard.tsx` — 4th tab | Full flow works on `localhost:3000` | 15 min |
| 9 | Edge cases: no day movers yet (early market), 0 results from filter | Empty states handled | 20 min |

**Total: ~3 hours.**

Combined with Volatile screen (~6.5 hrs), grand total ≈ **9.5 hrs**. Tight for tomorrow 9am, but achievable with disciplined execution and the staged checkpoints.

---

## 10. Verification checklist

### Backend
1. **Unit tests** — `cd apps/server && bun test` — all new tests green, no existing tests broken.
2. **Endpoint sanity**:
   ```bash
   curl 'http://localhost:4002/api/sections/day-movers?direction=all&sortBy=absDayMove' | jq '.stocks[0]'
   ```
   First stock should have `|dayMovePct| ≥ 3`, `rvol ≥ 1.0`, and ranks first by `absDayMovePct`.
3. **Direction filter** — `?direction=losers` returns only stocks with `dayMovePct < 0`.
4. **Price filter** — `?priceMin=250&priceMax=500` returns only stocks in band.
5. **Sort works** — `?sortBy=signedDayMove` returns most positive first (gainers top), most negative last.

### Frontend
6. **Tab switches cleanly** — Stocks ↔ Volatile ↔ Day Movers all work; no console errors.
7. **Direction chip filtering** — clicking Gainers hides losers from the grid live.
8. **Live update** — leave the tab open; Day Move % ticks with price; list re-ranks as moves grow/shrink.
9. **Empty state** — direction=Losers in a strong-up market → friendly empty message, not blank screen.
10. **Click-through** — opens existing `/stock/SYMBOL` detail page; AI module + chart still work.
11. **No regressions** — Volatile screen + structural lanes still work identically to before.

### Production
12. **CI green** before merge.
13. **Auto-deploy completes** — backend + web containers healthy.
14. **Live verification** — both new tabs visible and populated before 09:00 IST.

---

## 11. Out of scope (intentional)

- **Custom min-move % input** — chips only for v1 (3% fixed). Add a `5% / 10%` quick-filter later if needed.
- **Top gainers / Top losers as separate tabs** — direction chip handles it inside one tab; saves UI real estate.
- **Pre-market gap % from yesterday close** — interesting but needs a separate data source (yesterday's close); v2.
- **Sector grouping** — "show me all the day movers in Banking" — defer until you find yourself wanting it.
- **Historical day-move context** — "is +12% normal for INFY?" — needs historical volatility data we don't track yet.
- **Sound alerts on biggest movers** — phase 2.

---

## 12. Risk + mitigation

| Risk | Mitigation |
|---|---|
| `dayOpen` is 0 or NaN early in session before first tick | Guard: skip stock if `dayOpen <= 0`; show empty state until ticks arrive |
| Stocks gap-up at open with no real volume → false positives | RVOL ≥ 1.0 gate filters these |
| Too many movers in volatile market sessions → wall of cards | Hard cap at 20; user uses price/direction chips to narrow |
| User confuses this screen with Volatile screen | Strong visual distinction — Day Mover card hero is the signed % (green/red), Volatile card hero is the price + ATR%; tab labels are unambiguous |
| Reusing components between two cards causes coupling | Keep both card components separate files; extract only the truly identical pieces (e.g. 3-candle list) into a shared sub-component |
| Breaking existing dashboard | All additive — new tab, new pure function, new route handler |

---

## 13. After v1 (data → improvement)

After 1 week of live use:
- Did 3% catch the right stocks, or do you need 4% / 5%?
- Are you mostly looking at Gainers (long-bias) or Losers (short-bias)?
- Did exhaustion signals (volume drying up + small candles after big move) actually predict reversals on this list?
- Should the card show distance to **VWAP** as another reversal benchmark?
- Worth merging with Volatile screen as one "Intraday" tab with two sub-tabs?

These are tuning decisions — easy to make with one week of real data.

---

## 14. Execution sequencing

Per your direction: **Volatile screen first, Day Movers second.**

Reason: Volatile builds the scaffolding (`volatility-metrics.ts`, `<PriceRangeChips>`, sections-route extension pattern, dashboard ModeToggle extension pattern). Day Movers then *reuses* all of that and finishes in half the time. Building the other order would mean re-doing scaffolding work.

So tonight's order:
1. Build & deploy **Volatile** screen end-to-end (~6.5 hrs).
2. Verify it works.
3. Build & deploy **Day Movers** screen on top of the same scaffolding (~3 hrs).
4. Both visible on `tradescanner.io` before 09:00 IST.

Both plans approved → I start with Volatile Phase 1.
