# Finances OS — Claude Code Project Guide

## Stack

- **Nextron** (Electron + Next.js 14, `app/` router, static export)
- **SQLite** via **Prisma** (`prisma/schema.prisma`, dev DB at `prisma/dev.db`)
- **Refine.dev** (`@refinedev/core`) for data operations (`useList`, `useOne`, `useCreate`, `useUpdate`, `useDelete`)
- **MUI v9** (`@mui/material`, `@mui/icons-material`) — all components use `slots`/`slotProps`, NOT `component`/`sx` overrides on deprecated APIs
- **Vitest** for unit tests

## Commands

```
npm run dev          # Start Nextron dev server (hot-reload renderer)
npm run build        # Build distributable → dist/Finances OS Setup X.x.x.exe
npm run test         # Run Vitest test suite
npm run db:push      # Copy prisma/dev.db → %APPDATA%\finances-os\database.db (PROD)
npm run db:pull      # Copy PROD → dev.db
npx prisma db push --skip-generate --accept-data-loss   # Apply schema changes to dev.db
```

## PROD Deployment Flow

1. Verify all changes in dev mode (`npm run dev`)
2. Only when user explicitly says to push: `npm run db:push` (copies dev.db to PROD)
3. Then `npm run build` (rebuilds the .exe — required for UI/code changes to take effect)

**NEVER run `npm run db:push` without explicit user instruction.** DEV is for experimentation; PROD changes are deliberate.

## Architecture

**Route wrapper convention.** Every `app/<Route>/page.tsx` is a thin (~7-line) wrapper that only imports and renders the real component from `components/<domain>/`. This keeps routing concerns separate from view logic. The two exceptions are `Cash/page.tsx` (legitimate `useSearchParams` routing) and `layout.tsx`/`page.tsx` root files. When adding a new route, follow this pattern — do NOT put logic in `page.tsx` even if it starts small.

```
renderer/
  app/                    # Next.js routes — thin wrappers only
    Overview/page.tsx     → components/dashboard/OverviewPage.tsx
    Plan/page.tsx         → components/budget/BudgetPage.tsx
    Statistics/page.tsx   → components/budget/statistics/StatisticsPage.tsx
    YearlyCosts/page.tsx  → components/yearly-costs/list.tsx
    Income/page.tsx       → components/app-settings/sections/IncomePage.tsx
    Bill, Personal, Payees → components/<domain>/list.tsx
    Cash/page.tsx         # exception: reads ?id= and delegates to AccountLedger
    providers.tsx         # Refine + MUI theme + IPC data provider
  components/
    budget/
      BudgetPage.tsx      # YNAB-style monthly budget (groups → items, auto/manual assign)
      BudgetTable.tsx     # Renders groups + subsections + items
      AssignMoneyPopover  # Manual + Auto-assign tabs (auto shows only current pay week)
    dashboard/
      OverviewPage.tsx    # Main dashboard host (pay-period view + Optimize action)
      BillsOverview       # Bill cards per pay week
      CashFlowOverview    # Income/expense bars per pay week
      PersonalOverview    # Personal expense cards
      SurplusTargetPill   # Weekly surplus target display (Optimize moved to stale-data alert)
  lib/
    budget-utils.ts       # computeActivity, computeAvailable, computeReadyToAssign, resolveAutoAssign*
    pay-period-utils.ts   # getPayPeriodsForMonth, balancePayWeeks, getBillPeriodKey, BillSplit
    date-utils.ts         # getOrdinal, formatDate, parseISOAsLocal — DO NOT duplicate inline
    tooltip-styles.tsx    # shared MUI Tooltip styling (dark bg + section-colored border + Fade)
    pay-period-utils.test.ts
    budget-utils.test.ts
```

## Key Patterns

### Auto-assign amounts
- `repeatWeekly` Personal items (Gas, Spending, etc.) → **always add a flat per-period amount** (never cumulative top-up). This is intentional — each pay week gets a fresh allowance regardless of prior assigned state.
- `splitAcrossWeeks` Personal items → cumulative top-up. Target = sum of per-period slices (from `computeSplitPersonalAllocations`) through the clicked pay week; caller subtracts current `available` so already-funded prior weeks aren't double-counted.
- Bills with a `BillSplit` row per pay week → cumulative top-up (same shape as split personals). Prevents prior-week funding from masking later weeks' slices when the user hits Auto for P3 expecting P3's share to be added on top.
- Single-week bills (no split, or one `BillSplit` row) → full amount only in the natural pay week (via `getBillPeriodKey` forward-extension logic).

### Multi-occurrence bills (Aug 2026)
A monthly bill can fire **twice** within a single pay-period view — once as the in-month occurrence, once as the next-month forward-extension. Example: Starlink (dueDate=4) in Sept 2026 has coord=4 (Sep 4, P1) AND coord=34 (Oct 4, P5).

- `getBillOccurrencesInView(dueDate, periods)` in `pay-period-utils.ts` returns EVERY occurrence in the view (up to 2). Prefer this over `getBillPeriodKey` (which returns only the primary).
- `BillSplit.occurrenceCoord` tags which occurrence a split funds. Legacy rows (`coord=0`) map to the primary (next-month-preferred) occurrence for backward compat until re-optimized.
- `balancePayWeeks` places per-`(billId, occurrenceCoord)` units, so a bill firing twice gets two independent placement decisions (each may be split further).
- **Plan-page mapping invariant:** anywhere splits are read out of Refine and passed into `getBillAllocationsForBill` / `resolveAutoAssignAmountForPeriod` (currently `BudgetPage.tsx handleAutoAssign`, plus `OverviewPage.tsx`, `BillsOverview.tsx`, `CashFlowOverview.tsx`, `PersonalOverview.tsx`), the mapping MUST include `occurrenceCoord: Number(r.occurrenceCoord ?? 0)`. Dropping this field collapses non-primary occurrences into the primary's legacy-fallback bucket and double-counts the secondary firing (secondary gets natural attribution + primary picks up its splits). Regression pinned by `resolveAutoAssignAmountForPeriod — multi-occurrence bills` tests in `budget-utils.test.ts`.
- **Invariant guard:** `assertNoUnderfundedBills(result, context)` throws when any occurrence's `allocations + locked cents < bill.amount`. The Overview optimizer calls this after every month. Past-window occurrences (natural home is in a locked past week with no locked allocation) are silently skipped — the algorithm can't retroactively fund a paycheck that already came and went.

### Orphan-fallback skip
`getBillOccurrencesInView` would orphan-attribute bills that fire before this view's first payday AND past its forward extension — EXCEPT when the NEXT view's first payday is ≤ the bill's dueDate. In that case the next view naturally covers the firing, so orphaning here would double-count the same real-world payment across two views. See `PayPeriod.nextViewFirstPayday`.

### DueDate > daysInMonth clamping
For a bill due the 31st in a 30-day month, `getBillOccurrencesInView` clamps the in-month coord to `daysInMonth` (so coord=30 for Sept, displayed as "the 30th") instead of leaking into the next-month coord range (which would falsely display as "Oct 1st"). Prevents Bill Shield / Claude / Spotify edge-case display bugs.

### Retroactive planning in balancePayWeeks
The algorithm ALLOWS placement in locked (past) weeks — locked only means "preserve existing splits via `lockedAllocations`", NOT "refuse to plan there". This lets the leveler suggest prefunding from past paychecks when unlocked weeks would otherwise be overloaded (e.g., Sept 4-6 bills eating all of Sept P1's budget can be relieved by "having saved" from Aug's P4). Callers who don't want retroactive suggestions can filter emitted allocations by week index.

### Bill balance schema
`BillSplit(billId, monthKey, weekIndex, amountCents, occurrenceCoord)` with `@@unique([billId, monthKey, weekIndex, occurrenceCoord])` — replaces the old `BillPayWeekOverride` table (removed). `occurrenceCoord` distinguishes multiple firings of the same bill in one view. The `balancePayWeeks` algorithm writes splits to fine-tune per-week amounts.

### Overview optimizer — locked-week semantics
`renderer/app/Overview/page.tsx` treats every split row in a locked past week as "already committed" (`lockedAllocations`), regardless of whether it matches the algorithm's natural attribution. Only splits in NON-locked weeks get deleted and recomputed on Optimize. Legacy `coord=0` rows are resolved to the primary occurrence via `getBillOccurrencesInView`. Deleting locked history was the bug that caused P3/P4 to inherit the full BillShield/Climb amounts and crush the weekly surplus.

### Optimize horizon
The Optimize loop runs `OPTIMIZE_HORIZON_MONTHS` (currently **36** = 3 years) forward from today. Bumped up from 12 so users scrolling to future months always see properly-planned `BillSplit` rows instead of raw un-optimized amounts. Iterations are independent (each month reads only its own state), so the cost scales linearly — first run writes ~50 splits/month × 36 months; subsequent runs hit the identical-signature fast-path early-exit and skip untouched months entirely. If you change the horizon, update this constant AND the toast text (`Pay weeks optimized across the next N months!`) AND the doc comments.

### Stale-data alert + always-visible Optimize (Overview)
- Auto-fires when bills / income / personals / surplus target change after initial load, OR when any `BillSplit` row still has `occurrenceCoord=0` (schema migration signal).
- Persisted in `localStorage("overviewOptimizeAlert")` — survives navigation and app restarts.
- Cleared only when user clicks Optimize Now. Triggers `balancePayWeeks` + `assertNoUnderfundedBills`, writes `BillSplit` records with proper `occurrenceCoord`.
- A **permanent "Optimize" button** also sits next to `SurplusTargetPill` in the Overview toolbar — always available regardless of alert state.
- Success shown as a Snackbar toast (Fade, 3 s auto-dismiss).

### BillsOverview subtitle format
- **In-month** occurrence: `Due 5th` (no month prefix — current view's month is implicit).
- **Next-month** occurrence (forward-extended): `Due Oct 4th` (explicit month so a bill firing twice reads as `5th` vs `Oct 5th`).
- **Split** allocations render via a JSX subtitle (DashboardCard's `subtitle` prop accepts `ReactNode`):
  - Line 1: `Split · Oct 4th`
  - Line 2 (0.85 opacity, only when NOT the first slice): `Saved $99.43`. First-slice cards omit this — the card's headline amount IS the saved number.
  - The bill's TOTAL lives in the CallSplit badge tooltip, not on the card face — keeps split cards compact on narrow 5-week grids.
- Cumulative-saved counts only the current occurrence's splits — a bill's other occurrence (e.g., Sep 4 vs Oct 4 Starlink) doesn't inflate the progress.

### Overview page top summary tiles
Three side-by-side tiles at the very top of the Overview page (`OverviewPage.tsx` right after the "Cash Flow & Allowance" title): **Bills** ($/month, rose #f43f5e), **Personal** ($/month, indigo #818cf8), **Yearly Costs** ($/year, green #3DBC83). Personal monthly total scales `repeatWeekly` items by the current view's pay-week count so it matches the Personal section header. `SummarySection` totals pills on Bills/Personal/Yearly sections were removed once these tiles took over the aggregate-total role — one number, one place.

### Plan page out-of-sync badge + Sync Plan button
- Amber ⚠ (`WarningAmberIcon`, `#fbbf24`) appears next to a Bill envelope's name in `BudgetItemRow` when funded ≠ expected-through-current-pay-week beyond a $1 tolerance (fires OVER **and** UNDER).
- For BILL items the tooltip surfaces "still-to-save" numbers, not month-aggregates — subtracts already-consumed grace-window activity from both `expected` and `funded`. Same diff, more intuitive values. (Starlink Sept view example: instead of "expects $176.46, currently $178.95", tooltip reads "expects $46.46, currently $48.95" — the Sep 4 firing was paid, so what's left is the Oct 4 slice through P2.)
- **Payday suppression**: when the PREVIOUS pay week's target was already met (`fundedCents >= expectedThroughPreviousPeriod - tolerance`), under-fund shortfalls against the current period are silenced — treated as "the new pay week just started and hasn't been assigned yet" rather than real drift. Overview-change drift naturally breaks previousMet (splits redistribute) so warnings return on real drift. At `currentPayWeekIdx = 0` (first pay week of month), previous returns 0 → previousMet always true → silent. Over-fund always fires (no payday-timing ambiguity).
- **Sync Plan button** (amber outlined, `AutoFixHighIcon`) sits on the left of the top row (mirroring "Add Group" on the right, RTA pill centered). Only appears when at least one item is out of sync (post-suppression). Disabled when `readyToAssign + overTotalCents < underTotalCents` — tooltip explains the shortfall. Clicking applies every per-item delta in one batch (over-funded envelopes pull back to RTA, under-funded envelopes fill from RTA). Uses IDENTICAL suppression logic to the badge so the button hides in lockstep — "just haven't done payday assignments yet" state has no work to do.
- **Personal envelopes excluded** — repeatWeekly items (Gas, Spending) fluctuate too much week-to-week to flag meaningfully.

### Shared tooltip styles (`renderer/lib/tooltip-styles.tsx`)
Every hover tooltip across the app pulls its shell from `tooltipStyleProps(borderColor)` — dark navy bg, thin colored border + arrow, 150 ms Fade transition. Border color ties the tooltip to its context: **amber (`TOOLTIP_AMBER`)** for warning surfaces (Out-of-sync badge, Sync Plan button), **pay-period color** for card-owned tooltips (BillsOverview split badge, CashFlowOverview income/expenses breakdown). Content typography via `<TooltipTitle color={...}>` (bold accent-colored) + `<TooltipBody>` (0.85 white). The Statistics `MonthlyStackedBars` custom `<Paper>` tooltip follows the same visual language with its border matching the hovered segment's color.

### Toast pattern (MUI Snackbar)
Split the message string from the open flag to prevent text/width collapse during exit animation:
```typescript
const [toastOpen, setToastOpen] = useState(false);
const [toastMsg, setToastMsg] = useState("");
// show: setToastMsg("..."); setToastOpen(true);
// hide: setToastOpen(false);
// JSX: slotProps={{ transition: { onExited: () => setToastMsg("") } }}
```

### MUI icon gotcha
`ChevronLeft` / `ChevronRight` icons are hidden globally via CSS (`data-testid="Chevron*Icon"`). Use `NavigateBefore` / `NavigateNext` instead.

### Refine notifications
Add `successNotification: false, errorNotification: false` to any `useList`/`useOne` call on pages that share a resource with another mounted page — duplicate notification keys cause React key warnings.

## Database

- Dev DB: `prisma/dev.db` (SQLite)
- PROD DB: `%APPDATA%\finances-os\database.db`
- `BudgetMonth.month` is a Prisma `DateTime` field. Serialized as an ISO 8601 string across the IPC boundary — client-side compare with `date.toISOString()`, keyed on the UTC first-of-month (see `startOfThisMonth()` in `BudgetPage.tsx`).

## Settings

- `wifeWeeklyTargetCents` — minimum surplus per pay week (default $300.00 = 30000 cents). Column name kept from original design; UI label is "Surplus Target".
- `payDay` — payday weekday (0=Sun … 6=Sat)
- `paymentCycle` — `"WEEKLY"` or `"BI_WEEKLY"`
- `w2Amount` — primary income amount

## Tests

```
npm run test          # run all (186 tests as of Sept 2026)
npm run test:watch    # watch mode
```

Key invariants covered by `pay-period-utils.test.ts`:
- **Full-year coverage** — for every bill in the user's actual bill set, every real-world firing (Aug 2026 → Jul 2027) is attributed to exactly one view. Guards against orphan double-counting AND dropped bills.
- **Multi-occurrence bills** — Sept 2026 dueDate=5 (Phone Bill) returns 2 occurrences; balance places both; underfunded stays empty.
- **Locked-allocation preservation** — a bill with $78.19 locked in P2 has only its remaining $78.19 placed in unlocked weeks (not the full amount again).
- **Assertion helper** — `assertNoUnderfundedBills` throws on any short-funded occurrence; the Overview optimizer calls it after every month's balance.

Key invariants covered by `budget-utils.test.ts`:
- **Plan ↔ Overview alignment (multi-occurrence)** — `resolveAutoAssignAmountForPeriod` returns the correct cumulative envelope amount when splits carry proper `occurrenceCoord`. Regression guard for the BudgetPage mapping — if occurrenceCoord is ever stripped upstream, cumulative totals inflate (e.g. P5 → $303 instead of $202 on the Starlink case).

MUI Autocomplete has a jsdom quirk: `pointerEvents` may need to be set before `fireEvent.click`. See `reference_test_harness.md` in memory for mock patterns.
