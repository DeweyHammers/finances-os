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
npx prisma generate  # Regenerate the client after a schema change — CLOSE the dev app first
```

- **`nextron.config.js` → `startupDelay: 60000`** is required. Nextron 10 turns it into `retries = startupDelay / 500` for its renderer port check; the default 0 makes `npm run dev` fail instantly ("Failed to start renderer process with port 8888 in 0ms") and orphan `next dev` on port 8888.
- **Every `git push` runs the full test suite first** (`.githooks/pre-push`, enabled by the `prepare` script → `git config core.hooksPath .githooks`; fresh clones get it on `npm install`). It runs with `CI=true`, so missing snapshots fail instead of being written. A failing test cancels the push. Emergency bypass: `git push --no-verify`. `.gitattributes` keeps the hook LF-only, since a CRLF `#!/bin/sh` breaks it. Typecheck isn't gated yet (12 known test-file errors).
- **`dev` passes `--remote-debugging-port=9222`** on purpose. Nextron otherwise appends `--remote-debugging-port=5858` — the API server's port. Chromium DevTools then grabs `127.0.0.1:5858`, and since the API binds loopback only (`main/api-server.ts` → "Network exposure"), the API either fails to start or the renderer's fetches hit DevTools. VS Code's `nextron:renderer` attach config uses 9222 to match.
- **`prisma generate` fails with `EPERM … query_engine-windows.dll.node`** while the dev Electron is running (it holds the engine DLL). Stop the app, generate, relaunch — the main process needs a restart to see new columns anyway.
- **PROD schema changes ship via `db:push`** — there are no migrations; PROD gets new columns only by copying dev.db, and the rebuilt `.exe` carries the matching Prisma client. Always do both.

## PROD Deployment Flow

1. Verify all changes in dev mode (`npm run dev`)
2. Only when user explicitly says to push: `npm run db:push` (copies dev.db to PROD)
3. Then `npm run build` (rebuilds the .exe — required for UI/code changes to take effect)

**NEVER run `npm run db:push` without explicit user instruction.** DEV is for experimentation; PROD changes are deliberate.

## Demo tour (docs/ → GitHub Pages)

`docs/index.html` is a public step-by-step picture tour (served by GitHub Pages from `main` → `/docs`; the README links to it). Its screenshots in `docs/img/tour/` are generated, never hand-made:

```
node scripts/demo/create-db.mjs            # (re)build an EMPTY prisma/demo.db from the schema (resets in place)
npx tsx scripts/demo/serve.ts              # real API server on demo.db (no Electron); port 5858
cd renderer && npx next dev -p 8888        # the UI
node scripts/demo/empty-check.mjs          # smoke test: every route on an empty DB, fails on errors
node scripts/demo/tour.mjs                 # fills the app with FAKE data step by step → docs/img/tour/*.png (1920×1080)
```

- `serve.ts` reuses the `FINANCES_OS_TEST_DB_URL` override, so dev.db and PROD are never opened. Stop `npm run dev` first (same ports).
- `cdp.mjs` drives headless Chrome/Edge with a throwaway profile and a **frozen clock** (`setClock`): the story runs Oct 1–30 2026 with weekly Friday paydays, so the pictures don't depend on today's date. Next's dev overlay is hidden.
- **All tour data is fictional** ("Alex"). The repo is public: never put real names, amounts, payees or employers in `tour.mjs` or the screenshots. Savings is a weekly *personal* item on purpose (a no-cycle Custom Plan item gets a flat amount per Auto-assign, but the ⚠ badge expects it monthly).
- Re-run `tour.mjs` after UI changes, and update the numbers quoted in `docs/index.html` if they move.

## Debugging artifacts (never committed)

When taking pre-change safety snapshots (e.g. before an experimental UI test), drop them in `prisma/` using these naming conventions so `.gitignore` already covers them and they never surface in `git status` / VSCode source control:

- **DB copy** → `prisma/dev.db.<label>.bak` (matches `/prisma/*.db.*.bak`)
- **Readable state dump** (assignments table, txn list, etc.) → `prisma/<name>.snapshot.<ext>` (matches `/prisma/*.snapshot.*`)

If you invent a new artifact kind for a debugging session, extend `.gitignore` FIRST so the file is born ignored — don't leave untracked debug output sitting in the working tree.

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
    pay-period-utils.ts   # getPayPeriodsForMonth, balancePayWeeks, getBillPeriodKey, BillSplit, computeIncomePerPeriodCents
    date-utils.ts         # getOrdinal, formatDate, parseISOAsLocal — DO NOT duplicate inline
    cents.ts              # toCents, fromCents, formatMoney(cents) — use instead of inline toLocaleString currency
    optimize-plan.ts      # planOptimize (Optimize PHASE A, pure) + OPTIMIZE_HORIZON_MONTHS
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
A monthly bill can fire **twice** within a single pay-period view — once as the in-month occurrence, once as the next-month forward-extension. Example: a bill with dueDate=4 in Sept 2026 has coord=4 (Sep 4, P1) AND coord=34 (Oct 4, P5).

- `getBillOccurrencesInView(dueDate, periods)` in `pay-period-utils.ts` returns EVERY occurrence in the view (up to 2). Prefer this over `getBillPeriodKey` (which returns only the primary).
- `BillSplit.occurrenceCoord` tags which occurrence a split funds. Legacy rows (`coord=0`) map to the primary (next-month-preferred) occurrence for backward compat until re-optimized.
- `balancePayWeeks` places per-`(billId, occurrenceCoord)` units, so a bill firing twice gets two independent placement decisions (each may be split further).
- **Plan-page mapping invariant:** anywhere splits are read out of Refine and passed into `getBillAllocationsForBill` / `resolveAutoAssignAmountForPeriod` (currently `BudgetPage.tsx handleAutoAssign`, plus `OverviewPage.tsx`, `BillsOverview.tsx`, `CashFlowOverview.tsx`, `PersonalOverview.tsx`), the mapping MUST include `occurrenceCoord: Number(r.occurrenceCoord ?? 0)`. Dropping this field collapses non-primary occurrences into the primary's legacy-fallback bucket and double-counts the secondary firing (secondary gets natural attribution + primary picks up its splits). Regression pinned by `resolveAutoAssignAmountForPeriod — multi-occurrence bills` tests in `budget-utils.test.ts`.
- **Invariant guard:** `assertNoUnderfundedBills(result, context)` throws when any occurrence's `allocations + locked cents < bill.amount`. The Overview optimizer calls this after every month. Occurrences that can only be funded from locked weeks are exempt — they're reported in `BalanceResult.skipped` instead (see "Locked weeks in balancePayWeeks").

### Income per pay period
Which paychecks land in which pay week is computed ONLY by `computeIncomePerPeriodCents` / `getIncomeSourcesForPeriod` in `pay-period-utils.ts` (plus `withLegacyIncomeFallback` for the first-run AppSettings source). It used to be copy-pasted into OverviewPage, BudgetPage, CashFlowOverview and PersonalOverview. Fallbacks are explicit `IncomeDefaults` per caller: the optimizer falls back to the primary income's cadence, Plan to primary then AppSettings, the dashboard cards to `effectiveSettings`. Never re-inline the payday loop. The parity test `matches the original inline loop across 36 months` pins it.

### Orphan-fallback skip
`getBillOccurrencesInView` would orphan-attribute bills that fire before this view's first payday AND past its forward extension — EXCEPT when the NEXT view's first payday is ≤ the bill's dueDate. In that case the next view naturally covers the firing, so orphaning here would double-count the same real-world payment across two views. See `PayPeriod.nextViewFirstPayday`.

### DueDate > daysInMonth clamping
For a bill due the 31st in a 30-day month, `getBillOccurrencesInView` clamps the in-month coord to `daysInMonth` (so coord=30 for Sept, displayed as "the 30th") instead of leaking into the next-month coord range (which would falsely display as "Oct 1st"). Prevents end-of-month edge-case display bugs (bills due the 29th–31st).

### Locked weeks in balancePayWeeks (Oct 2026)
- A week **locks once it STARTS** (`isPayWeekLocked`: `startDay <= todayCoord`), so the **current** week is locked — its paycheck is already handed out. (Was `endDay <= todayCoord`, which let Optimize rewrite the in-progress week's surplus.) Shared by `balancePayWeeks` and the Overview optimizer — never re-inline the rule.
- **Phase 2 leveling never spreads cents into locked weeks** (`splitEligible` = unlocked subset of `eligible`). Leveling a few dollars of a bill into locked P1, which already had a row for that bill, was the Oct 2026 unique-constraint 500.
- **Nothing new is ever placed in a locked week.** An occurrence (or uncommitted remainder) whose eligible weeks are ALL locked — a bill moved/added into the current week, a price bump on a bill due this week, a past firing with no row — is returned in `BalanceResult.skipped` instead: not planned this cycle, exempt from `underfunded`. The user covered it outside the plan (e.g. savings); the next occurrence is planned normally. (User decision, Oct 18 2026 — a bill moved 31st → 18th on the 18th.)
- Skipped occurrences with **no** rows get a **$0 marker row** in their home week, planned by `planOptimize` (written by `handleOptimize`). Without it, `getBillAllocationsForBill` falls back to natural attribution and shows the full amount in the current week anyway (and Plan's ⚠ fires). The marker is a locked row on the next run (`hasLockedRows: true`), so the skip is idempotent. `BillsOverview` renders it dimmed as "Skipped · added after payday".
- `planOptimize` throws in Phase A (before any write) if the algorithm ever emits an allocation into a locked week — that insert is what collided with the committed row in the Oct 2026 500.
- Regression pinned by `Oct 2026 regression — locked weeks are never leveled into` in `pay-period-utils.test.ts`.

### Bill balance schema
`BillSplit(billId, monthKey, weekIndex, amountCents, occurrenceCoord)` with `@@unique([billId, monthKey, weekIndex, occurrenceCoord])` — replaces the old `BillPayWeekOverride` table (removed). `occurrenceCoord` distinguishes multiple firings of the same bill in one view. The `balancePayWeeks` algorithm writes splits to fine-tune per-week amounts.

### Overview optimizer — locked-week semantics
`planOptimize` (`renderer/lib/optimize-plan.ts`) treats every split row in a locked past week as "already committed" (`lockedAllocations`), regardless of whether it matches the algorithm's natural attribution. Only splits in NON-locked weeks get deleted and recomputed on Optimize. Legacy `coord=0` rows are resolved to the primary occurrence via `getBillOccurrencesInView`. Deleting locked history was the bug that caused P3/P4 to inherit the full two split bills amounts and crush the weekly surplus.

`handleOptimize` (OverviewPage) is two-phase: **Phase A = `planOptimize`**, a pure function that plans all 36 months (balance + `assertNoUnderfundedBills`) with zero DB writes, **Phase B applies** deletes → creates (unlocked allocations + $0 skipped markers). A planning failure leaves the DB untouched. The old single loop deleted a month's rows and then died mid-create, silently dropping two split bills from Oct 2026. Failures show an error toast and keep the stale alert; success alone clears it.

### Optimize horizon
The Optimize loop runs `OPTIMIZE_HORIZON_MONTHS` (currently **36** = 3 years) forward from today. Bumped up from 12 so users scrolling to future months always see properly-planned `BillSplit` rows instead of raw un-optimized amounts. Iterations are independent (each month reads only its own state), so the cost scales linearly — first run writes ~50 splits/month × 36 months; subsequent runs hit the identical-signature fast-path early-exit and skip untouched months entirely. The constant lives in `lib/optimize-plan.ts`; the success toast reads it. If you change the horizon, update the doc comments and the `36` expectations in the Optimize tests.

### Stale-data alert + always-visible Optimize (Overview)
- Fires when bills / income / personals / surplus target differ from the **baseline saved by the last successful Optimize** (`AppSettings.optimizedInputsSig`, JSON), OR when every `BillSplit` row still has `occurrenceCoord=0` (schema migration signal). Comparing against a persisted baseline (not a per-mount snapshot) is what catches edits made on another page before opening Overview. No baseline yet → adopt current inputs silently. When inputs match the baseline again (edit reverted, or Optimize ran in another window), a leftover input-change alert auto-clears.
- The baseline lives in the **DB, not localStorage** — each window/origin (dev renderer, PROD app, browser tab) has its own localStorage, so a localStorage baseline kept alerting in one window after Optimize ran in another.
- Alert text persisted in `localStorage("overviewOptimizeAlert")` — survives navigation and app restarts.
- Cleared only by a **successful** Optimize, which also rewrites the baseline. Triggers `balancePayWeeks` + `assertNoUnderfundedBills`, writes `BillSplit` records with proper `occurrenceCoord`.
- A **permanent "Optimize" button** also sits next to `SurplusTargetPill` in the Overview toolbar — always available regardless of alert state.
- Result shown as a Snackbar toast (Fade): success auto-dismisses after 3 s, `Optimize failed: …` errors after 8 s.

### BillsOverview subtitle format
- **In-month** occurrence: `Due 5th` (no month prefix — current view's month is implicit).
- **Next-month** occurrence (forward-extended): `Due Oct 4th` (explicit month so a bill firing twice reads as `5th` vs `Oct 5th`).
- **Split** allocations render via a JSX subtitle (DashboardCard's `subtitle` prop accepts `ReactNode`):
  - Line 1: `Split · Oct 4th`
  - Line 2 (0.85 opacity, only when NOT the first slice): `Saved $74.60`. First-slice cards omit this — the card's headline amount IS the saved number.
  - The bill's TOTAL lives in the CallSplit badge tooltip, not on the card face — keeps split cards compact on narrow 5-week grids.
- Cumulative-saved counts only the current occurrence's splits — a bill's other occurrence (e.g., the Sep 4 vs Oct 4 firing of the same bill) doesn't inflate the progress.

### Overview page top summary tiles
Three side-by-side tiles at the very top of the Overview page (`OverviewPage.tsx` right after the "Cash Flow & Allowance" title): **Bills** ($/month, rose #f43f5e), **Personal** ($/month, indigo #818cf8), **Yearly Costs** ($/year, green #3DBC83). Personal monthly total scales `repeatWeekly` items by the current view's pay-week count so it matches the Personal section header. `SummarySection` totals pills on Bills/Personal/Yearly sections were removed once these tiles took over the aggregate-total role — one number, one place.

### Plan page out-of-sync badge + Sync Plan button
- Amber ⚠ (`WarningAmberIcon`, `#fbbf24`) appears next to a Bill envelope's name in `BudgetItemRow` when funded ≠ expected-through-current-pay-week (fires OVER **and** UNDER; zero tolerance since funding is integer cents throughout).
- For BILL items the tooltip surfaces "still-to-save" numbers, not month-aggregates — subtracts already-consumed grace-window activity from both `expected` and `funded`. Same diff, more intuitive values. (Example: a bill firing Sep 4 and Oct 4 in the Sept view — once the Sep 4 firing is paid, the tooltip shows only the Oct 4 slice still to save through the current week, instead of month totals that include the paid firing.)
- **Paid occurrence = settled** — `activityInBillGraceWindowCents` credits each grace window that has ANY net outflow with that occurrence's full PLANNED amount (sum of its `BillSplit` rows via `getBillAllocationsForBill`, or `bill.amount` if unsplit), regardless of the actual charge. Overpay (charged a little more than the plan) doesn't eat into another firing's "still-to-save" target; underpay (planned $X in a locked past week, charged slightly less) doesn't leave a phantom under-fund that re-optimizing can't fix. Leftover change sitting in the envelope flags as OVER-funded — the right nudge to move it. Unpaid windows (0) and refunds (negative) pass through unchanged.
- **Shared evaluator** — badge (`BudgetItemRow`) and Sync Plan button (`BudgetPage.syncPlan`) both call `evaluatePlanSync` in `budget-utils.ts`, so they can never disagree. Don't re-inline the math.
- **Payday gating (paycheck-driven, not calendar-driven)**: `paydayPending` = today's pay week has started but no paycheck is recorded for it. A paycheck = uncategorized inflow with memo **"Income"** (case/whitespace-insensitive), dated from `PAYCHECK_EARLY_DAYS` (2) before the week's start through today (`hasPaycheckForPeriod`). Memo is the signal because "Transfer from Savings" / balance adjustments are also uncategorized inflows. While pending, under-fund is judged only against the PREVIOUS week's target (real drift still warns); once the paycheck lands the badge compares against the current week. Over-fund always compares against current. Replaced the old "previous week met → silence" heuristic.
- **Sync Plan button** (amber outlined, `AutoFixHighIcon`) sits on the left of the top row (mirroring "Add Group" on the right, RTA pill centered). Only counts **over-funding + drift** (short of EARLIER weeks' targets) — a shortfall that exists only because this week's slice isn't assigned yet is Auto-assign's job and never shows the button, even after the paycheck is recorded. Drift fills to the previous-week target; over pulls back to the current target. Disabled when `readyToAssign + overTotalCents < underTotalCents` — tooltip explains the shortfall.
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
- `optimizedInputsSig` — JSON signatures of the Optimize inputs at the last successful Overview Optimize (nullable; added Oct 2026). Baseline for the stale-data alert — see "Stale-data alert".

## Tests

```
npm run test          # run all (251 tests as of Oct 2026)
npm run test:watch    # watch mode
```

Key invariants covered by `pay-period-utils.test.ts`:
- **Full-year coverage** — for every bill in the user's actual bill set, every real-world firing (Aug 2026 → Jul 2027) is attributed to exactly one view. Guards against orphan double-counting AND dropped bills.
- **Multi-occurrence bills** — Sept 2026 dueDate=5 returns 2 occurrences; balance places both; underfunded stays empty.
- **Locked-allocation preservation** — a bill with half its amount locked in P2 has only the remaining half placed in unlocked weeks (not the full amount again).
- **Assertion helper** — `assertNoUnderfundedBills` throws on any short-funded occurrence; the Overview optimizer calls it after every month's balance.
- **Oct 2026 regression (modeled on real data, anonymized)** — locked weeks (incl. the current, started week) never receive new cents; the exact 500 setup emits nothing into locked P1; a bill moved into the current week (31st → 18th) or a price bump there lands in `skipped`; the $0 marker makes the skip idempotent; the next month plans it normally.

Key invariants covered by `budget-utils.test.ts`:
- **Plan ↔ Overview alignment (multi-occurrence)** — `resolveAutoAssignAmountForPeriod` returns the correct cumulative envelope amount when splits carry proper `occurrenceCoord`. Regression guard for the BudgetPage mapping — if occurrenceCoord is ever stripped upstream, cumulative totals inflate (e.g. P5 → 3× instead of 2× the bill on the multi-occurrence case).

### Lock-in tests (refactor safety net, Oct 2026)
The user's rule for cleanup work is **no change in how the app functions**. These tests pin today's behavior so a refactor that changes anything fails.

**They are LOCAL-ONLY (gitignored).** They run on real personal data (bill names, costs, balances) and the GitHub repo is public. `.gitignore` covers `tests/fixtures/`, `tests/helpers/refine-fixture-mock.ts`, `*.lockin.test.ts(x)` and their `__snapshots__`. They still run locally and in the pre-push hook; fresh clones just don't have them, and they aren't backed up by git. Committed tests must use generic sample data, never real bill names or amounts.
- **Fixture** `tests/fixtures/finance-snapshot-2026-10-18.json`: a frozen copy of the DEV DB on Oct 18 2026. **Income is FAKE** ($700/wk "Paycheck"; every paycheck is $700, with the difference folded into the Checking opening balance so balances and Ready to Assign are unchanged; bill splits re-planned for that income). Payees are dropped and memos blanked except "Income". The user does not want real income data in the GitHub repo, so never put real income, paycheck amounts or employer names in fixtures, tests, snapshots or docs.
- **`tests/helpers/refine-fixture-mock.ts`**: a fake `@refinedev/core` backed by that fixture, with stable query results, mutation spies and `overrideRows()` for per-test scenarios. The tests pin the clock with `vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime(new Date(2026, 9, 18, 12))`, and stub `localStorage` (Node's own global shadows jsdom's).
- `OverviewPage.lockin.test.tsx`: Overview numbers + whole-page text snapshots for Sep/Oct/Nov.
- `OverviewPage.optimize.lockin.test.tsx`: the exact BillSplit writes for four Optimize scenarios. `optimize-plan.lockin.test.ts`: planner invariants (a fresh re-plan rebuilds the fixture's rows exactly, locked weeks are never touched, runs are idempotent).
- `BudgetPage.lockin.test.tsx`: Plan amounts, ⚠ badges / Sync Plan state, and the exact Auto-assign P3 writes after the Oct 21 paycheck.
- `main/api-server.routes.test.ts`: real HTTP + Prisma against a wiped temp copy of the DB via the test-only `FINANCES_OS_TEST_DB_URL` (read in `shared/prisma.ts`). Never point it at dev.db.

A snapshot diff means the app would show or write something different. Only re-record (`npx vitest run -u`) for a behavior change the user asked for, and say so in the commit. Run with `CI=true` to fail on missing snapshots instead of writing them.

MUI Autocomplete has a jsdom quirk: `pointerEvents` may need to be set before `fireEvent.click`. See `reference_test_harness.md` in memory for mock patterns.
