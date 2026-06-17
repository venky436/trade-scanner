# Index Futures Scanner — Plan

> **Status:** Approved 2026-06-17, NIFTY-only scope, branch `feat/nifty-futures-scanner`
> **Use case:** Apply the full engine (pressure / RVOL / momentum / volatility / patterns / signals / S-R / outlook / AI Verdict) to the **NIFTY 50 near-month futures contract** — the way it's already applied to individual stocks.

> **Sibling docs:** `VOLATILE_STOCKS_SCREEN_PLAN.md`, `DAY_MOVERS_SCREEN_PLAN.md`

---

## 1. Why this matters

Today the dashboard shows NIFTY 50, BANKNIFTY, and other indices as **spot** values. Spot indices have **no order book and no volume** — so:

- Pressure is structurally 0 → no buy/sell-flow signal
- RVOL is undefined
- Patterns work but lack volume confirmation
- The volatile + day-movers tabs can't surface index activity at all

But **NIFTY and BANKNIFTY futures are tradeable derivatives**. They have their own:
- Order book (real bid/ask depth)
- Volume (real trades printing)
- OHLC candles
- Independent S/R levels

So the engine works on them *fully* — including pressure and RVOL. Index futures become **the most useful intraday symbols on the scanner** because they're (a) the highest-volume Indian intraday instruments and (b) the only ones where index-level direction comes with real order-flow signals.

---

## 2. Hard requirements (locked scope for v1)

1. **Subscribe to the NIFTY 50 near-month futures contract only.** (BANKNIFTY, FINNIFTY, MIDCPNIFTY are easy follow-ons — config-driven array — but explicitly out of v1 scope per user decision.)
2. **Treat futures like stocks** — they have volume, so they go through *all* engines unchanged (no special-casing).
3. **Auto-pick the near-month contract** at server boot using the existing `MODE_CONFIGS.commodity`-style "group by name, sort by expiry, pick nearest" logic that already lives in `instrument.service.ts`.
4. **Show futures everywhere stocks show** — Strong Alignment lane, Near Support, Near Resistance, Volatile tab, Day Movers tab. They surface naturally wherever they qualify.
5. **Display name** — `NIFTY25JUNFUT` shows as `NIFTY (Jun FUT)` on cards. Cryptic Kite symbol stays internal.
6. **Zero impact on existing stock + spot-index behaviour.** Additive only.

### Explicitly deferred (NOT in v1)
- **Auto-rollover** on expiry day — v1 picks the near-month at boot; user restarts the server after expiry (we'll add auto-rollover after v1 once we see how it actually behaves at the first expiry).
- **Weekly futures** — NIFTY/BANKNIFTY now have weekly contracts (introduced 2024). v1 uses monthly only; weekly is a one-flag flip after v1.
- **Dedicated "Index Futures" section** on the dashboard — futures will appear in the existing lanes for v1. A dedicated section can come after we see if it's useful.
- **Spot-vs-future basis chip** — interesting but not load-bearing.
- **Lot-size / margin display** — v1 is scan-only, no order-placement aid.
- **Far-month / next-month contracts** — only the near-month, since that's the liquid one.

---

## 3. Engine compatibility — what works

| Engine / metric | On NIFTY spot | On NIFTY future | Why |
|---|---|---|---|
| Momentum | ✅ | ✅ | Price-only |
| Volatility / ATR | ✅ | ✅ | OHLC-only |
| **Pressure** | ❌ (no volume) | **✅ full order flow** | Candle volume × shape — futures candles have it |
| **RVOL** | ❌ | **✅** | volume / avg(volume) — futures have it |
| Candle patterns | ✅ | ✅ | Price-shape only |
| S/R levels | ✅ (spot levels) | ✅ (futures levels — independent) | Computed from historical candles |
| Outlook (BOUNCE / BREAKOUT etc.) | partial | **full** | Same engine, full inputs available |
| Volatile lane (ATR% + RVOL) | ❌ | **✅** | Both metrics available |
| Day Movers lane (\|Day Move%\| + RVOL) | ❌ | **✅** | Both metrics available |
| AI Verdict module | n/a today | **✅** | Will evaluate futures alongside stocks |

**Conclusion: futures are a strict superset of what the engine can do today.** Nothing special-cased; they "just work."

---

## 4. End-to-end flowchart

```
                          BOOT TIME
   ┌──────────────────────────────────────────────────────────┐
   │  apps/server/src/index.ts                                │
   │       │                                                  │
   │       ▼                                                  │
   │  loadInstruments(apiKey, accessToken, mode)              │
   │  in services/instrument.service.ts                       │
   │       │                                                  │
   │       ├── existing: load NSE-EQ stocks                  │
   │       └── NEW:      load NFO-FUT index-futures           │
   │                                                          │
   │  For each underlying ∈ {NIFTY, BANKNIFTY}:               │
   │     1. filter instruments where                          │
   │          segment === "NFO-FUT" AND name === underlying   │
   │     2. drop expired (expiry < today)                     │
   │     3. sort ascending by expiry                          │
   │     4. pick first (= near-month) → e.g. NIFTY25JUNFUT    │
   │  Result: 2 extra instrument tokens added to subscription │
   │          (same map as stocks — symbolToToken, etc.)      │
   └──────────────────────────────────────────────────────────┘
                  │
                  ▼
            LIVE STREAM
   ┌──────────────────────────────────────────────────────────┐
   │  services/kite-ticker.service.ts                         │
   │  WS ticks for futures flow through the same pipeline:    │
   │                                                          │
   │   tick → marketDataService.updateQuote()                 │
   │        → broadcast.service consumes                      │
   │        → candle-tracker builds 5-min candles             │
   │        → on candle close:                                │
   │             pressure-from-candles → score                │
   │             momentum-engine       → score                │
   │             atr                   → score                │
   │             pattern-engine        → detection            │
   │        → intelligence-transformer → IntelligenceSnapshot │
   │        → broadcast to WS clients                         │
   │                                                          │
   │  EVERY ENGINE IS SYMBOL-AGNOSTIC. No code change inside. │
   └──────────────────────────────────────────────────────────┘
                  │
                  ▼
           DISPLAY
   ┌──────────────────────────────────────────────────────────┐
   │  Dashboard cards (Stocks lane / Volatile / Day Movers):  │
   │  Futures surface wherever they qualify by the same       │
   │  thresholds (confidence ≥ 0.65, ATR% ≥ 1.5%, etc.)       │
   │                                                          │
   │  Display name mapping:                                   │
   │     NIFTY25JUNFUT       → "NIFTY (Jun FUT)"              │
   │     BANKNIFTY25JUNFUT   → "BANKNIFTY (Jun FUT)"          │
   │  Built from inst.name + month-of-expiry — derived from   │
   │  the instrument record we already loaded.                │
   └──────────────────────────────────────────────────────────┘


                       EXPIRY-DAY HANDLING (v1)
   ┌──────────────────────────────────────────────────────────┐
   │  Last Thursday of the month, 15:30 IST: contract expires │
   │       │                                                  │
   │       ▼                                                  │
   │  Old contract stops ticking (no rollover automation v1)  │
   │  User notices stale data → restart server                │
   │       │                                                  │
   │       ▼                                                  │
   │  Boot-time loadInstruments() re-picks the new            │
   │  near-month (now the previously-next-month contract)     │
   │                                                          │
   │  v2: a daily 15:40 IST cron checks if today is expiry    │
   │      day for any tracked contract, and if so, runs the   │
   │      re-pick + re-subscribe automatically.               │
   └──────────────────────────────────────────────────────────┘
```

---

## 5. Backend changes

> All additive — no existing engine touched.

### New file
| File | Purpose |
|---|---|
| `apps/server/src/lib/index-futures-config.ts` | Tiny config module: `INDEX_FUTURE_UNDERLYINGS = ["NIFTY", "BANKNIFTY"]` + a `formatFutureDisplayName(symbol, expiry)` helper that turns `NIFTY25JUNFUT` into `NIFTY (Jun FUT)`. Easy to add `FINNIFTY` later by appending to the array. |

### Modified files (additive)
| File | Change |
|---|---|
| `apps/server/src/services/instrument.service.ts` | Add a new branch — when called with `mode = "index_futures"` (or extend the equity mode), fetch `NFO` exchange, filter `segment === "NFO-FUT"` AND `name ∈ INDEX_FUTURE_UNDERLYINGS`, then run the same group-by-name + sort-by-expiry + pick-first logic that already exists for commodities. |
| `apps/server/src/index.ts` | After loading equity instruments, also call `loadIndexFutures()` and **merge** the result into the same `symbolToToken` / `tokenToSymbol` / subscription set. Futures now flow through the existing pipeline. |
| `apps/server/src/lib/index-symbols.ts` | **NO change.** Futures are *not* in `INDEX_SYMBOLS` — they're tradeable and need full engine treatment (pressure, RVOL). This is the whole point. |
| `apps/server/src/services/stock-filter.service.ts` | Optionally: always-include futures in the eligible set (like indices are today, but the futures will pass the activity filter naturally due to high volume — likely no change needed). |
| `apps/server/src/services/levels.service.ts` | Already computes per-symbol levels from historical candles — works as-is. Futures' historical data window is shorter (since the contract started trading ~1 month ago), so levels may be thinner than for stocks. |

### Why no changes to engines
`pressure-from-candles.ts`, `momentum-engine.ts`, `atr.ts`, `pattern-engine.ts`, `intelligence-transformer.ts`, `section-selector.ts`, `signal-engine.ts`, `volatility-metrics.ts` — **all take symbol-agnostic inputs.** Feed them a future's candles and they produce results the same way they do for stocks.

---

## 6. Frontend changes (minimal)

### Modified files
| File | Change |
|---|---|
| `apps/web/src/lib/constants.ts` | Optionally: add a `isFuturesSymbol(s)` helper (regex `/FUT$/i`) for display-name formatting on cards. The display-name itself comes from the backend in the snapshot. |
| `apps/web/src/components/market-card.tsx` | No structural change. If we want a tiny "FUT" chip on the card hero to distinguish futures from stocks at a glance, ~5 lines. |
| `apps/web/src/components/volatile-card.tsx`, `day-mover-card.tsx` | Same — optional tiny "FUT" chip. |
| `apps/web/src/components/dashboard.tsx` | **NO change** — futures show up naturally in the existing lanes via section-selector. |

### Why no new screen/tab
The plan's whole point is "futures = stocks, but better." A separate tab would imply they're different, which they aren't (from the engine's POV). They sit in existing lanes alongside their stock peers. A user who wants only futures can sort by symbol or watch the activity organically — most users want them mixed in.

(If after a week the user wants a futures-only view, that's a 30-min extension — same section-selector pattern.)

---

## 7. Rollover handling

### v1 — manual (matches commodities today)
- Boot-time pick is the near-month contract
- On expiry day (last Thursday of the month, 15:30 IST), the contract stops ticking
- User notices stale data the next morning and restarts server → new near-month picked
- This is the **same behaviour as commodities** in the existing code, so we're not introducing new ops complexity

### v2 — auto-rollover (deferred until after v1 ships)
- Cron at 15:40 IST daily: for each tracked future, check if today is the expiry date
- If so: re-run `loadIndexFutures()` and update the subscription set
- Old contract gets unsubscribed, new contract gets subscribed
- ~1 hour of work — easy to add once we've watched v1 behave at one expiry

---

## 8. Implementation phases

Staged so each step is independently verifiable.

| # | Phase | Outcome | Est. |
|---|---|---|---|
| 1 | `lib/index-futures-config.ts` with constants + `formatFutureDisplayName()` + unit tests | `bun test` green | 30 min |
| 2 | Extend `instrument.service.ts` with `loadIndexFutures()` — reuses commodity-mode logic | Logs show: `[index_futures] Selected NIFTY25JUNFUT (expires 2026-06-25), BANKNIFTY25JUNFUT (expires 2026-06-25)` | 45 min |
| 3 | Wire into `index.ts` — merge futures into subscription set | Server boots, ticks flow for futures (verify via `marketDataService.getQuote("NIFTY25JUNFUT")`) | 30 min |
| 4 | Verify candles + engines populate for futures | Wait 10 min during market hours → futures appear in Strong Alignment lane / Volatile tab when qualified | 30 min |
| 5 | Display-name plumbing — backend exposes `displayName` field on snapshot for futures | Card renders "NIFTY (Jun FUT)" instead of "NIFTY25JUNFUT" | 45 min |
| 6 | Optional FUT chip on cards (visual differentiator) | Small chip visible on futures cards in dashboard, Volatile tab, Day Movers | 30 min |
| 7 | Edge cases — what if Kite returns 0 futures matching, what if user starts mid-market | Friendly logging, no crashes | 30 min |
| 8 | Branch + commit + PR | PR up | 15 min |

**Total: ~4 hours.**

---

## 9. Verification checklist

### Backend
1. Server boot logs include: `[index_futures] Selected NIFTY25JUNFUT, BANKNIFTY25JUNFUT` (or current near-month).
2. `curl http://localhost:4002/api/stocks/snapshot/NIFTY25JUNFUT | jq` returns a valid snapshot with **non-zero** pressure score (proving order-flow is flowing through).
3. RVOL on the futures snapshot is a real number, not null.
4. Existing stock snapshots are unchanged.
5. Existing spot index snapshots (NIFTY 50, NIFTY BANK) still return `pressure.label === "NOT_APPLICABLE"`.

### Frontend
6. Dashboard renders NIFTY future card in Strong Alignment / Volatile / Day Movers lanes when it qualifies — with the **violet/orange volatile gradient** and ATR%/RVOL chips (not the grey spot-index card).
7. Card hero shows `NIFTY (Jun FUT)`, not `NIFTY25JUNFUT`.
8. Click → existing `/stock/[symbol]` detail page works (the page is already symbol-agnostic).
9. AI module (when toggled on) issues verdicts on the futures symbol.
10. Spot-index cards at the top of the dashboard render unchanged.

### Production
11. `bun test` green (no new tests broken; new ones for `formatFutureDisplayName` pass).
12. Frontend production build clean.

---

## 10. Risk + mitigation

| Risk | Mitigation |
|---|---|
| **Expiry day mid-session** — old contract stops ticking, no auto-rollover in v1 | User notices stale price + zero candles → restart server. Plan v2 cron after first observed expiry. |
| **Far-month accidentally selected** if the near-month already expired but Kite still lists it | Filter explicitly: `expiry >= today` (same filter that already works in commodity mode). |
| **Thin historical candles** for a newly-listed contract (1-2 days old) → S/R thin | Tolerable — S/R service already handles "insufficient data" by returning null levels; card just won't show a zone label until enough candles accumulate. |
| **Misclassified as index** elsewhere in code | Futures are *not* in `INDEX_SYMBOLS` set, so `isIndexSymbol()` returns false → engine treats them as stocks correctly. Single point of truth. |
| **WS subscription limit on Kite** (3000 instruments) | We're adding 2 (or up to 4). Well within limit. |
| **Display confusion** — user sees `NIFTY (Jun FUT)` vs `NIFTY 50` and doesn't realize they're different instruments | Distinct visual chip ("FUT" label) + completely different price (futures trade at a premium/discount vs spot) makes them obviously different in practice. |
| **Breaking existing dashboard** | All changes additive. Engines untouched. Stock + spot-index display untouched. |

---

## 11. Decisions (made 2026-06-17)

### A. Underlyings in v1 → **NIFTY 50 only**
- One symbol, one card. Easiest to debug + verify.
- BANKNIFTY / FINNIFTY can be added by appending one string to the underlyings array, post-v1.

### B. Monthly only → **yes** (no weekly futures in v1)
- Less rollover surface, simpler ops.

---

## 12. What this isn't

To set expectations correctly:

- **Not** an order-placement aid — scanner only, no execution help
- **Not** a backtesting tool — just live-scan signals
- **Not** a basis tracker — doesn't compare future vs spot premium/discount
- **Not** an options scanner — index *futures* only, not options chains
- **Not** a multi-leg strategy aid — single instrument per card

These are all interesting extensions but explicitly outside this plan.
