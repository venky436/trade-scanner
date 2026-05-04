# Social Templates (`/admin/social`)

> Admin-only screenshot generator. Renders 1080×1080 templates for high-confidence + high-volatility signals so the admin can manually screenshot and post to Telegram / Instagram. **Not** an auto-poster, **not** a public-facing page.

## Why this exists

Pre-launch audience building. We want to share what the system sees in real time (and what happened 10 minutes later) without building any auto-posting infrastructure or platform integrations. The platform's job is just to render beautiful, on-brand templates that look great as static images.

The feature is intentionally **scoped down**:
- **No auto-post** — admin screenshots manually
- **No image generation server-side** — pure browser rendering, zero impact on the tick-processing loop
- **No new infrastructure** — reuses the existing `signal_tracking` table + 10-min evaluator that already runs

---

## Trigger criteria

A signal becomes a "social-eligible" template candidate when **both** are true at the moment `recordSignal()` fires:

```
intel.confidence       >= 0.75    (HIGH bucket lower bound)
intel.volatility.score >= 0.7     (HIGH volatility band)
```

This produces ~15-25 signals on a typical trading day — enough for daily content, sparse enough that each one is hand-pickable.

The eligibility flag is computed once, at insert time, and persisted. We do **not** re-evaluate eligibility later (e.g., if volatility changes mid-window, the row's flag stays as it was).

| Constant | File | Value |
|---|---|---|
| `SOCIAL_MIN_CONFIDENCE` | `apps/server/src/services/signal-tracking.service.ts` | `0.75` |
| `SOCIAL_MIN_VOLATILITY_SCORE` | same | `0.7` |

---

## Two template variants per signal

| | InitialTemplate | OutcomeTemplate |
|---|---|---|
| **When** | At signal time | After 10-min eval (status decided) |
| **Shows** | Symbol, zone, momentum, pressure, volatility, alignment | Symbol, % move, best/worst intraday, status verdict |
| **Status required** | Any | `SUCCESS` / `FAILED` / `NEUTRAL` (not `PENDING`) |
| **File** | `apps/web/src/components/social/initial-template.tsx` | `apps/web/src/components/social/outcome-template.tsx` |

The outcome template **automatically** becomes available once the existing signal-tracking evaluator updates the row's status — no new timer, worker, or trigger needed.

---

## Data flow

```
ULTRA-conf high-vol signal fires
       ↓
broadcast.service.ts onIntelligenceComputed
       ↓
signal-tracking.service.ts recordSignal()
       ↓
   conf ≥ 0.75 AND vol ≥ 0.7?
       ↓ yes
   INSERT into signal_tracking
     volatility_score = 0.85
     social_eligible  = true
     status           = PENDING
       ↓
   GET /api/admin/social returns this row
       ↓
   /admin/social list page shows:
     [10:15] KALYANKJIL · Bounce Expected · ULTRA · Outcome Pending
       ↓
   Admin clicks → /admin/social/123?view=initial
       ↓
   InitialTemplate renders at 1080×1080
   Admin screenshots, posts manually
       ↓
   ... 10 minutes pass ...
       ↓
   Existing evaluator runs:
     UPDATE signal_tracking
       status = SUCCESS / FAILED / NEUTRAL
       price_after = 414.30
       change_percent = +0.55
       max_profit_percent = +0.78
       max_drawdown_percent = -0.12
       ↓
   /admin/social list page (auto-refreshes 30s):
     row badge flips from "Outcome Pending" → "Played Out"
       ↓
   Admin clicks → /admin/social/123?view=outcome
       ↓
   OutcomeTemplate renders at 1080×1080
   Admin screenshots, posts as follow-up
```

The `view=outcome` page **polls every 30 seconds** while the underlying status is still `PENDING`. As soon as the evaluator commits, the outcome template appears on the next poll without a manual refresh.

---

## Database schema (additive only)

Two new columns on `signal_tracking`:

```sql
volatility_score   NUMERIC(5,4)              -- nullable; backfills as NULL
social_eligible    BOOLEAN  NOT NULL DEFAULT false  -- backfills as false
```

Both are **purely additive**:
- Existing rows backfill cleanly (`NULL` and `false`)
- All existing reads of `signal_tracking` work unchanged (none of them reference these columns)
- Schema change is reversible without data loss

Apply with:
```bash
cd apps/server && npx drizzle-kit push
```

---

## API endpoints

Both gated by the existing `authMiddleware + adminGuard` used by `/api/admin/tracking`.

| Endpoint | Returns |
|---|---|
| `GET /api/admin/social?date=YYYY-MM-DD` | List of social-eligible signals on that date (defaults to today). Ordered by `signalTime DESC`. |
| `GET /api/admin/social/:id` | Single full signal row by ID. 404 if not found. |

Response shapes:

```ts
// GET /api/admin/social
{ signals: SocialSignal[], count: number }

// GET /api/admin/social/:id
{ signal: SocialSignal }

interface SocialSignal {
  id: number;
  symbol: string;
  signalTime: string;            // ISO
  priceAtSignal: string;          // numeric serialized as string by Drizzle
  outlook: string;
  confidence: string;
  confidenceBucket: string;       // ULTRA_HIGH / HIGH / MEDIUM
  zone: string;                   // NEAR_SUPPORT / NEAR_RESISTANCE / MID_RANGE
  bias: string;                   // BULLISH / BEARISH / NEUTRAL
  volatilityScore: string | null;
  status: string;                 // PENDING / SUCCESS / FAILED / NEUTRAL
  priceAfter: string | null;
  changePercent: string | null;
  maxProfitPercent: string | null;
  maxDrawdownPercent: string | null;
  evaluatedAt: string | null;
  // ...other tracking fields
}
```

---

## Frontend pages

### `/admin/social` — list page

`apps/web/src/app/admin/social/page.tsx`

Shows the day's eligible signals as a table. Layout matches `/admin/tracking`:
- Top: `Back to Admin` link, date picker, `Today` button (when not viewing today)
- Title: "Social Templates" with Camera icon, subtitle showing the date
- Body:
  - Loading skeletons (3 rows)
  - Empty state with "No eligible signals" message
  - Error state with rose-tinted card
  - Signal table with columns: time · symbol · outlook · confidence · bucket · status pill · camera icon
- Auto-refresh every 30 seconds when viewing today's date

Status pill semantics:
| Backend status | Pill label | Color |
|---|---|---|
| `PENDING` | "Outcome Pending" | amber |
| `SUCCESS` | "Played Out" | emerald |
| `FAILED` | "Did Not Play Out" | rose |
| `NEUTRAL` | "No Clear Movement" | zinc |

Each row links to `/admin/social/[id]?view=initial` if the status is `PENDING`, or `?view=outcome` otherwise (smart default — admin usually wants to see whatever's most relevant first).

### `/admin/social/[id]` — template renderer

`apps/web/src/app/admin/social/[id]/page.tsx`

- Reads `?view=initial|outcome` (default: `initial`)
- Top toolbar (NOT included in screenshot):
  - `Back to Social` link
  - Initial / Outcome view toggle
  - Title: symbol + view name + "1080×1080" hint
- Below toolbar: the template card itself, centered
- For `view=outcome` when status is still `PENDING`: shows a waiting card with spinner and ETA
- Polls every 30 seconds while pending

### Nav

Camera icon (Lucide `Camera`) added next to the existing `TrendingUp` link in `apps/web/src/components/global-nav.tsx`. Visible to admin users only.

---

## Template designs

### InitialTemplate (1080×1080)

```
┌───────────────────────────────────────────────────────────────┐
│ ⓘ  EDUCATIONAL · MARKET STUDY                                │
│───────────────────────────────────────────────────────────────│
│                                                               │
│                       S B I N                                 │  ← 148px
│                       ━━━━━━━                                 │  ← gradient bar
│                                                               │
│              Market Behavior Snapshot                         │
│                                                               │
│      ╔══════════════════════════════════════════════╗         │
│      ║   📍  ZONE              Near Support         ║         │
│      ║   📈  MOMENTUM          Building             ║         │
│      ║   💹  PRESSURE          Strong Buying        ║         │
│      ║   🌊  VOLATILITY        High                 ║         │
│      ╚══════════════════════════════════════════════╝         │
│                                                               │
│        ╭──────────────────────────────────────╮              │
│        │  ◆  FACTOR ALIGNMENT · STRONG  ◆     │              │
│        ╰──────────────────────────────────────╯              │
│                                                               │
│───────────────────────────────────────────────────────────────│
│ For educational study only · Not investment advice           │
│ Past patterns do not predict future · Not SEBI registered    │
└───────────────────────────────────────────────────────────────┘
```

**Field derivation** (in `template-shared.tsx`):

| Display field | Source | Example output |
|---|---|---|
| Symbol | `signal.symbol` | `SBIN` |
| Zone | `signal.zone` → `zoneLabel()` | `Near Support` / `Near Resistance` / `Mid Range` |
| Momentum | `signal.outlook + confidence` → `momentumLabel()` | `Strong` / `Building` / `Forming` / `Mixed` |
| Pressure | `signal.bias + confidence` → `pressureLabel()` | `Strong Buying` / `Buying Present` / `Mixed` |
| Volatility | `signal.volatilityScore` → `volatilityLabel()` | Always `High` (filter requires it) |
| Alignment | `signal.confidence` → `alignmentLabel()` | `STRONG` (≥0.9) / `ALIGNED` (≥0.8) / `FORMING` (≥0.75) |

**Direction-based color:**
- Bullish setup (`BREAKOUT_LIKELY`, `BOUNCE_EXPECTED`) → emerald accents on momentum/pressure icons
- Bearish setup (`REJECTION_POSSIBLE`, `BREAKDOWN_RISK`) → rose accents
- Alignment pill glow color matches direction

**Note on derived labels:** momentum and pressure aren't stored as text in `signal_tracking` — only the underlying numeric values feed the schema. We derive presentation labels from `outlook + bias + confidence` in pure helper functions. If we later find this isn't faithful enough, the right fix is to persist the labels in the DB, not to re-engineer the derivation.

### OutcomeTemplate (1080×1080)

```
┌───────────────────────────────────────────────────────────────┐
│ ⓘ  EDUCATIONAL · MARKET STUDY                                │
│───────────────────────────────────────────────────────────────│
│                                                               │
│                       S B I N                                 │  ← 100px
│              10 Minutes Later                                 │
│                                                               │
│        ╭───────────────────────────────────╮                 │
│        │           ↑  +0.55%               │                 │  ← 140px mono
│        │       PRICE MOVEMENT              │                 │     status-tinted glow
│        ╰───────────────────────────────────╯                 │
│                                                               │
│  ╭────────────────────╮      ╭────────────────────╮          │
│  │ ▲ BEST             │      │ ▼ WORST            │          │
│  │   +0.78%           │      │   -0.12%           │          │
│  │   intraday peak    │      │   intraday dip     │          │
│  ╰────────────────────╯      ╰────────────────────╯          │
│                                                               │
│        ╭──────────────────────────────────────╮              │
│        │  ✓  PLAYED OUT AS SYSTEM OBSERVED    │              │
│        ╰──────────────────────────────────────╯              │
│                                                               │
│───────────────────────────────────────────────────────────────│
│ Factual market data · Past data does not predict future      │
│ Not investment advice · Not SEBI registered                  │
└───────────────────────────────────────────────────────────────┘
```

**Status pill variants** (`outcomeVerdict()` in `template-shared.tsx`):

| Status | Pill text | Pill color | Big number color |
|---|---|---|---|
| `SUCCESS` | `PLAYED OUT AS SYSTEM OBSERVED` | emerald | emerald |
| `FAILED` | `DID NOT PLAY OUT THIS TIME` | rose | rose |
| `NEUTRAL` | `NO CLEAR MOVEMENT` | amber | amber |

**Direction icon on the big number:**
- Move > +0.05% → `ArrowUp`
- Move < −0.05% → `ArrowDown`
- Otherwise → `Minus`

**Honest by default.** All three outcome states get fully designed templates. Cherry-picking only SUCCESS posts is what shady channels do — and is one of the things SEBI cites in enforcement orders. Showing losses publicly builds genuine trust.

---

## Design system

| Token | Value |
|---|---|
| Background | `#0A0E1A` with radial gradient overlays from cyan + violet |
| Card surface | `bg-slate-900/60 backdrop-blur-xl border border-slate-700/50 rounded-2xl/3xl` |
| Top banner tint | `bg-amber-500/[0.06]` + `border-b border-amber-500/20` |
| Text hero | `text-white font-extrabold tracking-tight` |
| Text label | `text-slate-500 text-[14px] font-semibold uppercase tracking-[0.3em]` |
| Text value | `text-white text-[26px] font-semibold` |
| Disclaimer | `text-slate-500 text-[15px] tracking-wide` |
| Direction colors | emerald-400 (bullish/win) · rose-400 (bearish/loss) · amber-400 (neutral) |

Hero typography sized for legibility in Instagram feed thumbnails (where the post may render at ~120px wide before tap-to-expand).

---

## SEBI considerations

This feature ships with the explicit understanding that **publicly posting screenshots of these templates carries SEBI risk**. The templates apply mitigations to lower that risk but cannot eliminate it pre-RA-registration:

| Mitigation built into the template | What it lowers |
|---|---|
| Top banner: `EDUCATIONAL · MARKET STUDY` | Establishes framing as the viewer's first impression |
| Bottom disclaimer including `Not SEBI registered` | Removes "regulated authority" inference |
| No `BUY` / `SELL` / `HOLD` / `TARGET` / `SL` anywhere | Removes explicit recommendation vocabulary |
| Neutral language: `Market Behavior Snapshot`, `Played Out`, `No Clear Movement` | Educational tone, not actionable |
| No `%-confidence` label visible | Removes "act on this" cue |
| No red/green direction arrows | Removes visual recommendation cues |
| No entry rupee price shown | Reduces "trade these levels" inference |
| % move only on outcome (not absolute prices) | Same reason |
| Honest outcome reporting (FAILED + NEUTRAL get equal treatment) | Counters "predictive accuracy" inference |

**What the templates do NOT mitigate:** the underlying act of naming live stocks publicly, which is the legal trigger SEBI is currently prosecuting. That residual risk is a business decision, accepted by the operator.

**Operational mitigations** (outside the template — in admin practice):
- Use Telegram private/educational channels before Instagram
- No paid promotion or ads driving traffic
- No DM-based "tips"
- Never reply to "should I buy?" comments
- Don't claim accuracy stats in bio
- Keep audience small until RA registered

---

## What this explicitly does NOT touch

| Area | Status |
|---|---|
| Existing `recordSignal()` dedup logic (NEUTRAL re-tracking, upgrade-only, 200/day cap, market hours, ₹50 floor, NO_CLEAR_EDGE skip) | UNCHANGED |
| Existing `evaluate()` and `evaluateMarketClose()` logic | UNCHANGED |
| `/admin/tracking` page and metrics | UNCHANGED |
| `getMetrics`, `getRecentSignals`, `getTrackingMetricsFromDB`, `getTrackingSignalsFromDB` | UNCHANGED |
| WS server, broadcast service, signal worker, intelligence transformer | UNCHANGED |
| User-facing UI (dashboard, stock detail, watch zone, options) | UNCHANGED |
| Auth middleware, admin guard | REUSED (no change) |

The new columns on `signal_tracking` are additive; existing reads keep working because they don't reference them.

---

## File map

### Backend

| File | Action |
|---|---|
| `apps/server/src/db/schema/signal-tracking.ts` | UPDATE — add `volatilityScore` + `socialEligible` columns |
| `apps/server/src/services/signal-tracking.service.ts` | UPDATE — populate new columns in `recordSignal()`; add `getSocialFeed()` + `getSocialSignal()` helpers; expose both from the service object |
| `apps/server/src/routes/admin.route.ts` | UPDATE — add `GET /api/admin/social` + `GET /api/admin/social/:id` |

### Frontend

| File | Action |
|---|---|
| `apps/web/src/app/admin/social/page.tsx` | NEW — list page with date picker |
| `apps/web/src/app/admin/social/[id]/page.tsx` | NEW — template renderer with view toggle |
| `apps/web/src/components/social/template-shared.tsx` | NEW — types, label helpers, frame, banner, disclaimer |
| `apps/web/src/components/social/initial-template.tsx` | NEW — InitialTemplate component (1080×1080) |
| `apps/web/src/components/social/outcome-template.tsx` | NEW — OutcomeTemplate component (1080×1080) |
| `apps/web/src/components/global-nav.tsx` | UPDATE — Camera icon link to `/admin/social` for admin users |

---

## Verification

```bash
# Apply schema migration
cd apps/server && npx drizzle-kit push

# Server typecheck + tests
cd apps/server && npx tsc --noEmit && bun test
# → 55/55 pass

# Web typecheck + production build
cd apps/web && npx tsc --noEmit && npm run build
# → both /admin/social (static) and /admin/social/[id] (dynamic) appear in route list
```

**Manual smoke** (during market hours):
1. Open `/admin/social` — should render the day's eligible signals (or empty state)
2. Wait for an eligible signal to fire (conf ≥ 0.75 + HIGH vol)
3. Click into it: `?view=initial` renders the InitialTemplate
4. After 10 min: `?view=outcome` renders the OutcomeTemplate (or shows waiting card if not yet evaluated)
5. Set browser viewport to 1080×1080 → take a screenshot of just the template card

**Outcome-state coverage** (verify all three render correctly): browse historical signals across `SUCCESS`, `FAILED`, and `NEUTRAL` statuses by selecting a past date with mixed outcomes.

---

## Future work

- **"Mark as posted" tracking** — let the admin flag which templates have already been screenshotted+posted so they don't show in tomorrow's queue
- **Caption text generator** — auto-suggest a SEBI-safe caption to copy alongside the image
- **Brand mark / logo** — add the `tradescanner.io` footer once decided (deferred per operator)
- **Telegram bot integration** — single-click post to a private Telegram channel (would still keep Instagram manual)
- **Sector/cap anonymization mode** — add a toggle to render the template with the symbol replaced by a sector descriptor (e.g., `MID-CAP IT`) for safer public posting once the operator wants to scale
- **Post history archive** — display previously-posted templates with their actual social engagement stats (manual entry initially)
- **A/B template variants** — let the operator choose between 2-3 layout variants per signal to test what performs best on each platform
