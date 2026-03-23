# Market Phase Control

## What It Does

The Market Phase system protects traders from unreliable signals during the first 10 minutes after market open (9:15 AM IST). It applies phase-based restrictions to all signals — penalizing scores, forcing WAIT decisions, and showing visual warnings — then lifts restrictions automatically as the market stabilizes.

---

## Why We Built It

The first 5-10 minutes of every trading session are dominated by:
- **Gap fills** — overnight news creates artificial price jumps
- **Order book imbalance** — queued overnight orders execute in bursts
- **False breakouts** — support/resistance levels get temporarily breached then revert
- **Momentum fakes** — early price direction often reverses within minutes

Our engines (pressure, momentum, pattern) treat this data like any other — they'd produce BUY/SELL signals from noise. Without phase control, the scanner would show "TRADE NOW" on stocks that are just settling into their real prices.

The solution: **don't suppress signals — penalize and warn**. Traders still see what's happening, but the system clearly communicates that confidence is reduced and entry should wait.

---

## The Four Phases

```
Market Timeline (IST)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Before 9:15        9:15      9:20        9:25              15:30  After 15:30
  ─────────────┬──────┬─────────┬───────────┬────────────────┬─────────────
    CLOSED     │OPENING│STABILIZE│  NORMAL   │    NORMAL      │  CLOSED
               │(5 min)│(5 min)  │           │                │
               │       │         │           │                │
  No signals   │WAIT   │Confirmed│Full speed │Full speed      │No signals
  No penalty   │forced │only     │No penalty │No penalty      │No penalty
               │×0.6   │×0.8     │×1.0       │×1.0            │
  ─────────────┴──────┴─────────┴───────────┴────────────────┴─────────────
```

| Phase | Time Window | Score Multiplier | Decision Override | Accuracy Tracking |
|-------|-------------|------------------|-------------------|-------------------|
| **CLOSED** | Before 9:15 / After 15:30 / Weekends | ×1.0 (no change) | None | N/A |
| **OPENING** | 9:15 – 9:20 (0-5 min) | ×0.6 | Force ALL to WAIT | Disabled |
| **STABILIZING** | 9:20 – 9:25 (5-10 min) | ×0.8 | Only confirmed types pass | Disabled |
| **NORMAL** | 9:25 – 15:30 (10+ min) | ×1.0 (no change) | None | Enabled |

### CLOSED (Before 9:15 / After 15:30 / Weekends)

No market data flowing. Signals from previous session remain in cache but don't get phase-adjusted. Everything passes through unchanged.

### OPENING (9:15 – 9:20, first 5 minutes)

The most volatile window. Every signal is forced to WAIT regardless of strength.

- **Score penalty:** raw score × 0.6 → a perfect 10 becomes 6
- **Decision:** ALL forced to WAIT
- **Confidence:** ALL forced to LOW
- **Warning:** "Market opening volatility — signals restricted"
- **Accuracy tracking:** Disabled — signals are unreliable, don't pollute win rate data

**Example:** Stock TATASTEEL has raw score 9 (BREAKOUT, HIGH confidence). During OPENING:
```
Before phase:  BUY BREAKOUT, score 9, HIGH confidence
After phase:   WAIT, score 5 (9×0.6=5.4→5), LOW confidence
               "Market opening volatility — signals restricted"
```

### STABILIZING (9:20 – 9:25, minutes 5-10)

Opening noise is fading but not gone. Only signals with a confirmed type (BREAKOUT, REJECTION, BOUNCE, BREAKDOWN) are allowed through. Unconfirmed signals (ACTIVITY/MOMENTUM stage with no type) remain WAIT.

- **Score penalty:** raw score × 0.8 → a 10 becomes 8
- **Decision:** Confirmed types keep their action (BUY/SELL), unconfirmed forced to WAIT
- **Confidence:** ALL forced to LOW (even confirmed signals)
- **Warning:** "Market stabilizing — only confirmed signals" or "Waiting for confirmed signal pattern"
- **Accuracy tracking:** Disabled

**Example:** Two stocks during STABILIZING:
```
TATASTEEL (CONFIRMED stage, BREAKOUT type):
  Before: BUY BREAKOUT, score 9, HIGH
  After:  BUY BREAKOUT, score 7 (9×0.8=7.2→7), LOW confidence
          "Market stabilizing — only confirmed signals"

INFY (MOMENTUM stage, no type):
  Before: BUY, score 6, LOW
  After:  WAIT, score 5 (6×0.8=4.8→5), LOW confidence
          "Waiting for confirmed signal pattern"
```

### NORMAL (9:25 – 15:30, 10+ minutes)

Full speed. No restrictions, no penalties. All signals pass through unchanged with their original score, decision, and confidence.

---

## Complete Data Flow

```
                        ┌──────────────────────────┐
                        │     Engine Pipeline       │
                        │  (pressure, momentum,     │
                        │   pattern, signal, S/R)   │
                        └──────────┬───────────────┘
                                   │
                                   ▼
                        ┌──────────────────────────┐
                        │   Score Engine            │
                        │   computeSignalScore()    │
                        │   → rawScore (1-10)       │
                        └──────────┬───────────────┘
                                   │
                                   ▼
                   ┌───────────────────────────────────┐
                   │       Market Phase Control         │
                   │       applyMarketPhase()           │
                   │                                    │
                   │  Input: signal + rawScore          │
                   │                                    │
                   │  ┌────────────┐                    │
                   │  │getMarketPha│  What time is it?  │
                   │  │se()        │  → phase, elapsed, │
                   │  │            │    multiplier       │
                   │  └─────┬──────┘                    │
                   │        │                           │
                   │        ▼                           │
                   │  ┌──────────────────┐              │
                   │  │ Phase Logic      │              │
                   │  │                  │              │
                   │  │ CLOSED → pass    │              │
                   │  │ OPENING → WAIT   │              │
                   │  │ STABILIZING →    │              │
                   │  │   confirmed only │              │
                   │  │ NORMAL → pass    │              │
                   │  └─────┬────────────┘              │
                   │        │                           │
                   │        ▼                           │
                   │  Output:                           │
                   │  - finalScore (adjusted)           │
                   │  - decision (may be overridden)    │
                   │  - confidence (may be overridden)  │
                   │  - marketPhase                     │
                   │  - warningMessage                  │
                   └───────────┬───────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │                     │
                    ▼                     ▼
           ┌──────────────┐      ┌──────────────────┐
           │ Signal Cache  │      │ Accuracy Service  │
           │ (effectiveScor│      │                   │
           │  e stored)    │      │ OPENING? → skip   │
           │               │      │ STABILIZING? →    │
           │ signal.finalSc│      │   skip            │
           │ ore           │      │ NORMAL? → record  │
           │ signal.market │      │                   │
           │ Phase         │      └──────────────────┘
           │ signal.warnin │
           │ gMessage      │
           └───────┬──────┘
                   │
                   ▼
           ┌──────────────┐
           │  Broadcast    │
           │  → WebSocket  │
           │  → Frontend   │
           └──────────────┘
```

### Where It Runs

| Component | What Happens |
|-----------|-------------|
| `setCacheEntry()` in signal-worker | Calls `applyMarketPhase()` after score, before cache write |
| `shouldSkip()` in signal-worker | Forces recomputation when phase changes (e.g., OPENING → NORMAL) |
| `recordSignal()` in accuracy service | Independently checks phase, skips OPENING/STABILIZING |
| `onHighConfidenceSignal` callback | Only fires during NORMAL phase |
| On-demand `/api/stocks/:symbol/snapshot` | Applies phase adjustment to freshly computed signals |

---

## Integration Points

### 1. Signal Worker (`signal-worker.service.ts`)

Phase control is applied inside `setCacheEntry()` — the single function through which every signal passes before being cached.

```
setCacheEntry(symbol, signal, stage, reaction, score, scoreBreakdown)
  │
  ├─ Attach raw score + scoreBreakdown to signal
  │
  ├─ applyMarketPhase(signal, score)           ← NEW
  │    ├─ signal.finalScore = adjusted score
  │    ├─ signal.marketPhase = current phase
  │    └─ signal.warningMessage = phase warning
  │
  ├─ Override signal.action/confidence if OPENING/STABILIZING
  │
  ├─ Accuracy callback (only during NORMAL)
  │
  └─ Store in signalCache with effectiveScore
```

**Phase transition handling:** The `shouldSkip()` dedup function compares the cached signal's `marketPhase` against the current phase. If they differ (e.g., cached during OPENING, now it's NORMAL), the symbol is forced to recompute even if engine versions haven't changed.

### 2. Signal Accuracy (`signal-accuracy.service.ts`)

Double protection against recording unreliable signals:

1. **In signal-worker:** The `onHighConfidenceSignal` callback only fires when `phaseResult.marketPhase === "NORMAL"`
2. **In accuracy service:** `recordSignal()` independently calls `getMarketPhase()` and skips if not NORMAL

This ensures accuracy data is never polluted by opening volatility, even if the callback somehow fires during wrong phases.

### 3. On-Demand Snapshot (`stocks.route.ts`)

When a user searches for an untracked stock and the server computes a fresh signal, the snapshot route applies phase control too:

```
if (!signal.marketPhase) {
  const phaseResult = applyMarketPhase(signal, score);
  // Apply phase overrides...
}
```

The `!signal.marketPhase` guard prevents double-applying phase control when the signal comes from the signal-worker cache (which already has phase applied).

### 4. Frontend — Global Nav (`global-nav.tsx`)

The nav bar badge shows the current phase with a countdown:

| Phase | Badge | Style |
|-------|-------|-------|
| CLOSED | "Market Closed" | Grey dot, grey text |
| OPENING | "Opening (Xm)" | Yellow dot (pulsing), yellow text |
| STABILIZING | "Stabilizing (Xm)" | Orange dot (pulsing), orange text |
| NORMAL | "Live" / "Offline" | Green dot (pulsing) / Red dot |

The countdown shows minutes remaining in the current phase (e.g., "Opening (3m)" means 3 minutes until STABILIZING).

Phase is computed client-side from `new Date()` to avoid extra API calls. The badge refreshes on every component re-render (triggered by WS data updates during market hours).

### 5. Frontend — Trade Decision Box (`stock-detail.tsx`)

Phase overrides take highest priority in the decision logic:

```
Decision priority:
  1. OPENING → WAIT (⏳ "Market just opened — signals restricted")
  2. STABILIZING → WAIT (⏳ "Market stabilizing — only confirmed signals")
  3. Near resistance + momentum up → WAIT
  4. Near support + momentum down → WAIT
  5. Score ≥ 8 + confirmed type → TRADE
  6. Score ≥ 6 → WATCH
  7. Else → AVOID
```

A phase warning banner is displayed below the summary line:
- OPENING: Yellow background, "Market opening volatility — signals restricted"
- STABILIZING: Orange background, "Market stabilizing — only confirmed signals"

### 6. Frontend — Top Opportunities (`top-opportunities.tsx`)

Uses `finalScore` (phase-adjusted) for filtering and sorting:

```typescript
function getScore(stock: StockData): number {
  return stock.signal?.finalScore ?? stock.signal?.score ?? 0;
}
```

During OPENING, a stock with raw score 10 → finalScore 6 → appears in "Watchlist" (6-7) instead of "Best Setups" (8+). This prevents traders from seeing "Best Setup" cards for stocks whose scores are artificially high from opening noise.

Phase warnings are shown on each opportunity card when active.

### 7. Frontend — Watchlist Cards (`watchlist-cards.tsx`)

Score badges use `finalScore ?? score` to display phase-adjusted scores consistently.

---

## Edge Cases

### Phase Transition (OPENING → STABILIZING → NORMAL)

When the market transitions between phases, cached signals need recomputation even if underlying engine data hasn't changed. This is handled by `shouldSkip()`:

```typescript
function shouldSkip(symbol: string): boolean {
  const cached = signalCache.get(symbol);
  if (!cached) return false;

  // Force recompute if market phase changed
  const { phase } = getMarketPhase();
  if (cached.signal.marketPhase !== phase) return false;

  return (
    cached.pressureVersion === config.getPressureVersion(symbol) &&
    cached.momentumVersion === config.getMomentumVersion(symbol) &&
    cached.patternVersion === config.getPatternVersion(symbol)
  );
}
```

**Fast lane** (top 100 stocks): Recomputes every 500ms regardless — phase transitions are picked up within 500ms.

**Batch lane** (~400 remaining stocks): Uses `shouldSkip()` — the phase check forces recomputation within one batch cycle (~2-3 seconds).

### Score Display Consistency

All frontend components use `finalScore` (phase-adjusted) for display:

| Component | Score Source |
|-----------|-------------|
| `computeScore()` in stock-detail | `signal.finalScore ?? signal.score ?? fallback` |
| `getScore()` in top-opportunities | `signal.finalScore ?? signal.score ?? 0` |
| Watchlist cards | `signal.finalScore ?? signal.score` |
| Score Breakdown card | Uses `computeScore()` which prefers `finalScore` |

The raw `signal.score` is preserved for reference but `finalScore` is what traders see and what controls filtering.

### CLOSED Phase Behavior

During CLOSED phase (weekends, before/after market):
- `finalScore = rawScore` (no penalty)
- `warningMessage = null` (no warning)
- No decision overrides
- Existing cached signals from the previous session remain unchanged
- Accuracy tracking: not applicable (no live data)

### On-Demand Stocks During OPENING

If a user searches for any stock during OPENING (via search bar → on-demand snapshot), the server computes the signal fresh and applies phase control. The user sees:
- WAIT decision
- Penalized score (×0.6)
- Phase warning banner on the detail page
- "Opening (Xm)" badge in the nav bar

---

## Files

| File | Role |
|------|------|
| `apps/server/src/lib/market-phase.ts` | Pure functions: `getMarketPhase()`, `applyMarketPhase()` |
| `apps/server/src/lib/types.ts` | `MarketPhase` type, `finalScore`/`marketPhase`/`warningMessage` on `SignalResult` |
| `apps/server/src/services/signal-worker.service.ts` | Integration in `setCacheEntry()` + phase-aware `shouldSkip()` |
| `apps/server/src/services/signal-accuracy.service.ts` | Phase check in `recordSignal()` |
| `apps/server/src/routes/stocks.route.ts` | Phase adjustment in on-demand snapshot |
| `apps/web/src/lib/types.ts` | Frontend mirror: `MarketPhase`, `finalScore`, `marketPhase`, `warningMessage` |
| `apps/web/src/components/global-nav.tsx` | Phase badge with countdown |
| `apps/web/src/components/stock-detail.tsx` | Phase override in TradeDecisionBox + warning banner |
| `apps/web/src/components/top-opportunities.tsx` | Uses `finalScore` for filtering + phase warnings |
| `apps/web/src/components/watchlist-cards.tsx` | Uses `finalScore` for score badge display |

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Pure function, not a service | Phase depends only on clock time — no state, no async |
| Applied in `setCacheEntry()` | Single chokepoint — every signal passes through here |
| `finalScore` separate from `score` | Preserves raw engine output for debugging; frontend shows adjusted score |
| Confidence forced to LOW during STABILIZING | Even confirmed signals have reduced reliability in early trading |
| Accuracy tracking disabled during OPENING/STABILIZING | Prevents opening noise from polluting win rate metrics |
| Phase computed client-side for nav badge | Avoids extra API call; refreshes naturally from WS re-renders |
| Phase-aware `shouldSkip()` | Without this, batch-lane stocks could stay stuck in OPENING's WAIT after phase transition |
| On-demand snapshot applies phase too | Users searching for stocks during OPENING should see the same restrictions |
| Double protection for accuracy | Both callback guard + service guard prevent recording during volatile phases |
| Explicit IST timezone | `getMarketPhase()` uses `toLocaleString("en-US", { timeZone: "Asia/Kolkata" })` — production servers in UTC would miscalculate market hours without this |
