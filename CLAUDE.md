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

```
renderer/
  app/                    # Next.js routes
    Overview/page.tsx     # Main dashboard (pay-period overview, bill balance, stale-data alert)
    Plan/page.tsx         # Budget page host
    ...
  components/
    budget/
      BudgetPage.tsx      # YNAB-style monthly budget (groups → items, auto/manual assign)
      BudgetTable.tsx     # Renders groups + subsections + items
      AssignMoneyPopover  # Manual + Auto-assign tabs (auto shows only current pay week)
    dashboard/
      BillsOverview       # Bill cards per pay week
      CashFlowOverview    # Income/expense bars per pay week
      PersonalOverview    # Personal expense cards
      WifeTargetPill      # Wife weekly target display (Optimize moved to stale-data alert)
  lib/
    budget-utils.ts       # computeActivity, computeAvailable, computeReadyToAssign, resolveAutoAssign*
    pay-period-utils.ts   # getPayPeriodsForMonth, balancePayWeeks, getBillPeriodKey, BillSplit
    pay-period-utils.test.ts
    budget-utils.test.ts
```

## Key Patterns

### Auto-assign amounts
- `repeatWeekly` Personal items (Gas, Spending, etc.) → **always add a flat per-period amount** (never cumulative top-up). This is intentional — each pay week gets a fresh allowance regardless of prior assigned state.
- `splitAcrossWeeks` Personal items → per-period slice computed by `computeSplitPersonalAllocations` (proportional to leftover room).
- Bills → attributed to the pay week whose payday funds them (via `getBillPeriodKey` forward-extension logic).

### Bill balance schema
`BillSplit(billId, monthKey, weekIndex, amountCents)` with `@@unique([billId, monthKey, weekIndex])` — replaces the old `BillPayWeekOverride` table (removed). The `balancePayWeeks` algorithm writes splits to fine-tune per-week amounts.

### Stale-data alert (Overview)
- When bills / income / personals / wife target change after initial load, an amber banner appears.
- Persisted in `localStorage("overviewOptimizeAlert")` — survives navigation and app restarts.
- Cleared only when user clicks "Optimize Now" (no X dismiss). Triggers `balancePayWeeks` and writes `BillSplit` records.
- Success shown as a Snackbar toast (Fade, 3 s auto-dismiss).

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
- `BudgetMonth.month` is stored as a **Unix timestamp integer** (milliseconds), not an ISO string. Never `WHERE month LIKE 'YYYY-MM%'`.

## Settings

- `wifeWeeklyTargetCents` — minimum surplus per pay week (default $300.00 = 30000 cents)
- `payDay` — payday weekday (0=Sun … 6=Sat)
- `paymentCycle` — `"WEEKLY"` or `"BI_WEEKLY"`
- `w2Amount` — primary income amount

## Tests

```
npm run test          # run all
npm run test:watch    # watch mode
```

MUI Autocomplete has a jsdom quirk: `pointerEvents` may need to be set before `fireEvent.click`. See `reference_test_harness.md` in memory for mock patterns.
