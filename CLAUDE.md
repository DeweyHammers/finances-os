# Finances OS — Claude Code Project Guide

## Stack

- **Nextron** (Electron + Next.js 14, `app/` router, static export)
- **SQLite** through the **shared data layer** `shared/data/` (libsql backend; no Prisma client at runtime since Oct 2026). `prisma/schema.prisma` is still the schema's source of truth, dev DB at `prisma/dev.db` — see "Shared data layer"
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
npx prisma db push --skip-generate --accept-data-loss   # Apply schema changes to dev.db …
npx tsx scripts/generate-schema-sql.ts                  # … then regenerate shared/data/schema.sql (+ edit MODELS in shared/data/schema.ts)
npx prisma generate  # Only for the Prisma-client scripts (prisma/seed.ts, scripts/balance-bills.cjs); the app itself no longer loads it
```

- **`nextron.config.js` → `startupDelay: 60000`** is required. Nextron 10 turns it into `retries = startupDelay / 500` for its renderer port check; the default 0 makes `npm run dev` fail instantly ("Failed to start renderer process with port 8888 in 0ms") and orphan `next dev` on port 8888.
- **Every `git push` runs the full test suite first** (`.githooks/pre-push`, enabled by the `prepare` script → `git config core.hooksPath .githooks`; fresh clones get it on `npm install`). It runs with `CI=true`, so missing snapshots fail instead of being written. A failing test cancels the push. Emergency bypass: `git push --no-verify`. `.gitattributes` keeps the hook LF-only, since a CRLF `#!/bin/sh` breaks it. Typecheck isn't gated yet (12 known test-file errors).
- **`dev` passes `--remote-debugging-port=9222`** on purpose. Nextron otherwise appends `--remote-debugging-port=5858` — the API server's port. Chromium DevTools then grabs `127.0.0.1:5858`, and since the API binds loopback only (`main/api-server.ts` → "Network exposure"), the API either fails to start or the renderer's fetches hit DevTools. VS Code's `nextron:renderer` attach config uses 9222 to match.
- **After a schema change, restart the dev app** — the main process reads `shared/data/schema.ts` at startup. (`prisma generate` used to fail with `EPERM … query_engine-windows.dll.node` while the app ran because it held the engine DLL; the app no longer loads Prisma, so that is gone.)
- **PROD schema changes ship via `db:push`** — there are no migrations yet; PROD gets new columns only by copying dev.db, and the rebuilt `.exe` carries the matching data layer (`shared/data/schema.ts` + `schema.sql`). Always do both. The `SchemaVersion` table (see "Shared data layer") is where real migrations will go.
- **The installer ships an EMPTY database, never dev.db.** `npm run build` first runs `prebuild` → `scripts/build-template-db.mjs`, which rebuilds `prisma/template.db` from the schema with zero rows and refuses to continue otherwise; `electron-builder.yml` packages that file and `shared/prisma.ts` copies it to `%APPDATA%` on a fresh install only. Until Oct 24 2026 the build bundled `prisma/dev.db` (real bills and transactions) — an installer built before that must not be shared. Existing installs are unaffected (their `database.db` already exists).

## PROD Deployment Flow

1. Verify all changes in dev mode (`npm run dev`)
2. Only when user explicitly says to push: `npm run db:push` (copies dev.db to PROD)
3. Then `npm run build` (rebuilds the .exe — required for UI/code changes to take effect)

**NEVER run `npm run db:push` without explicit user instruction.** DEV is for experimentation; PROD changes are deliberate.

**Releases are built by GitHub Actions, not on this PC.** `.github/workflows/release.yml` runs on a hosted Windows runner when a `v*` tag is pushed: `npm ci` → `npm test` → `npm run build` → GitHub Release with the installer attached; it fails fast if the tag doesn't match `package.json`'s version. Reason (Oct 26 2026): Windows Smart App Control is enforced on the dev PC and blocks electron-builder from executing its fresh unsigned NSIS stub (`spawn UNKNOWN` during `computeScriptAndSignUninstaller`; Code Integrity event 3077), so `npm run build` dies after the renderer/main build. The installed app itself still runs. Don't try to turn Smart App Control off from here — it's one-way on Windows 11 and the user's call. To release: bump the version, merge to main, `git tag vX.Y.Z && git push origin vX.Y.Z`, then install the exe from the Release page.

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

## Sandbox mode (Oct 2026)

"Try a sandbox" (Overview toolbar, left of Optimize) lets the user experiment on a COPY of the database and then throw it away or keep it. `main/sandbox.ts` owns it; `shared/db.ts` makes it possible.

- **`getStore()` (shared/db.ts) is the swappable connection.** `switchDatabase(url, beforeConnect?)` closes the current store's file, runs the file operation while nothing holds either file, then creates the next store (the libsql backend opens its file lazily, on the first query). Routes call `getStore()` on every request — never cache the store in a module variable. The libsql close quirk that makes this work is described under "Shared data layer".
- **Files.** The copy is `sandbox.db` beside the real file (`prisma/sandbox.db` in dev, `%APPDATA%\finances-os\sandbox.db` in PROD; both gitignored by `*.db`). `enter` copies real → sandbox and switches; `discard` switches back and deletes the copy; `keep` writes `database.db.<stamp>.bak` (same naming as `db-sync.cjs`), overwrites the real file with the copy, switches back, deletes the copy. A sandbox never survives a restart: `cleanupStaleSandbox()` runs before the API starts and deletes any leftover copy, so the app always opens on real data.
- **Routes.** `GET /api/sandbox` → `{ active, enteredAt, transactionsAdded }`; `POST /api/sandbox/{enter|discard|keep}`. Wrong-state calls (enter twice, discard when inactive) are `409` via `SandboxError`. Registered BEFORE the generic `/api/:resource` routes.
- **Renderer.** `SandboxProvider` (app/providers.tsx) fetches the status once; `SandboxBanner` is the sticky amber strip above every page while active, with confirmed Discard (shows how many transactions were recorded in the sandbox — those are what Discard loses) and Keep; `SandboxButton` is the entry point (renders nothing while a sandbox is active). It lives in **Settings → Data** since Oct 27 2026 (it sat in the Overview toolbar before; the user moved the rarely-used controls out of that toolbar, together with the surplus target editor — see "Settings page"). Every action **reloads the window** on purpose: Refine's query cache, page state and the Overview's stale-alert check all have to restart against the other file. The raw fetches live in `lib/sandbox-api.ts`; `lib/api-url.ts` holds the shared `API_URL`.
- **Tests.** `main/api-server.routes.test.ts` → `sandbox (/api/sandbox)` covers enter/discard/keep against the temp test DB (the copy lands in the temp dir, never near dev.db).

## Shared data layer (Oct 27 2026) — `shared/data/`

Phase A step 1 of `plans/phone-app-and-sync.md`: every read and write goes through ONE data layer that needs nothing but `exec(sql, params) → rows` from its backend, so the desktop (Electron main) and, later, the Android app run the same code against the same rules. The Express routes in `main/api-server.ts` are thin HTTP wrappers over it; `main/api-server.routes.test.ts` is the contract that pins its behaviour (unchanged by the switch).

- **Files.** `sql.ts` the `SqlExecutor` interface (+ `splitStatements`); `schema.ts` the typed model metadata (`MODELS`: columns in Prisma order, scalar type, nullability, `cuid`/`now` generated defaults; `resolveModel()` = the old case-insensitive `getModel`), `SCHEMA_VERSION`; `schema.sql` + `schema-sql.ts` the GENERATED DDL (never edit — `npx tsx scripts/generate-schema-sql.ts` after every `schema.prisma` change; `schema.test.ts` fails when either is stale or `MODELS` disagrees with the DDL); `coerce.ts` `transformBody` (moved from the API, applied inside the store) + strict value validation; `store.ts` the `DataStore`; `backends/libsql.ts` the desktop backend; `cuid.ts`, `errors.ts`.
- **`shared/db.ts`** resolves the real database path (dev.db / `%APPDATA%` / `FINANCES_OS_TEST_DB_URL`), owns the swappable store (`getStore()`, `switchDatabase`) and exports a tiny `prisma` object (`$queryRawUnsafe`, `$executeRawUnsafe`, `$disconnect`) ONLY so the route tests run unchanged. `shared/prisma.ts` is a re-export of it.
- **Behaviour = the old Prisma routes, deliberately.** Lists: `?field=value` equality, `?field_like=` contains (LIKE, wildcards escaped), `_sort`/`_order` (`asc|desc`, several fields), total count; `_start`/`_end`/`q` ignored. Create ignores a client `id` and the legacy `client`/`contracts` keys, generates a cuid, fills `now()`, leaves literal defaults to the DDL. Update: URL id wins; a missing row throws (`NOT_FOUND` → 500) except `AppSettings/global`, which is created on first save. Validation is Prisma-strict (`"5"` for an Int, an unknown column, a null in a NOT NULL column → `VALIDATION` → 500); `transformBody` still coerces the known numeric keys first. The rules live in the store now: Income single-primary (create/update demote the others; a patch WITHOUT `isPrimary` clears it — historic quirk kept), BudgetCategoryItem delete snapshots the name onto `AccountTransaction.categoryName` first. All in one serialised lock; the rules run in BEGIN/COMMIT.
- **Storage is what the Prisma client wrote**, so dev.db / PROD are used in place and Prisma tools still read them: Boolean → 0/1, DateTime → Unix **milliseconds** (reads also accept the ISO text older rows hold and SQLite's `CURRENT_TIMESTAMP` text), cuid v1-shaped ids. Verified Oct 27 2026 against dev.db: all 1510 rows of every model read byte-identically through the old Prisma client and the new API, and rows the API writes read back identically through Prisma.
- **`SchemaVersion`** (`version`, `appliedAt`; a Prisma model too, so `db push` keeps it) — `createDatabase(exec)` applies `schema.sql` to an empty file (template.db, demo.db and the test DB are built from the same statements by `scripts/empty-db.mjs`), `prepareDatabase` runs on a store's first use (empty file → full schema; Prisma-era file → add the table + stamp). Bumping `SCHEMA_VERSION` = add the migration step in `ensureSchemaVersion` + regenerate; Phase D gates sync on it.
- **libsql close quirk (Windows).** libsql 0.5.x finalises prepared statements only when GC collects them, and the file handle stays open until then — so `close()` right before deleting/overwriting the file (Sandbox discard/keep) hit EBUSY. `backends/libsql.ts` runs a full GC (`v8.setFlagsFromString("--expose-gc")` + `vm.runInNewContext("gc")`), waits one macrotask (the finalisers run there — measured 20/20 vs 0/20 without the tick), then closes; `main/sandbox.ts` keeps its retry loop as the safety net. The backend uses `.all()` for every statement (`.run()`/`.get()` leave a statement half-stepped).
- **What still uses Prisma:** `prisma/schema.prisma` (source of truth) + `prisma db push` for dev.db; `prisma migrate diff` inside `scripts/generate-schema-sql.ts` and `schema.test.ts`; the generated client only in `prisma/seed.ts` and `scripts/balance-bills.cjs`. The app, the hosted server, the demo server and the tests no longer load `@prisma/client`. `electron-builder.yml` still packages the query-engine DLL and `release.yml` still runs `prisma generate` — harmless dead weight to remove once a libsql-based release has been installed and trusted (`libsql` is in `dependencies`, so nextron externalises it and electron-builder ships it with its prebuilt `@libsql/win32-x64-msvc` binary; that packaging has not been exercised locally — Smart App Control blocks local builds).
- **Next (Phase B/C):** the embedded-replica options go into `backends/libsql.ts`; the phone gets a `@capacitor-community/sqlite` backend and a Refine data provider that calls `DataStore` in-process with the same `ListQuery` objects simple-rest sends today.

## Settings page + app meta (Oct 27 2026)

`/Settings?tab=<general|budget|data|sync>` (`components/settings/SettingsPage.tsx`) is laid out like Obsidian's / Discord's settings since Oct 27 2026: a tab nav on the left (a horizontal strip below `md`) and ONE section at a time on the right; the open tab is URL state read by the route wrapper (`app/Settings/page.tsx`, the same `useSearchParams` + `Suspense` pattern as Cash) so links can land on a tab. What lives where (user decisions, Oct 27 2026): **Budget** is the ONLY editor of the surplus target — the Overview's `SurplusTargetPill` is read-only and opens `/Settings?tab=budget`; **Data** holds backups and the `SandboxButton` (no longer in the Overview toolbar, which is now just Optimize + the surplus display + month picker); **Phone & sync** shows "Local only" until a sync server exists. The **connection indicator** (`components/layout/ConnectionStatus.tsx` + `lib/use-connection-status.ts`) renders NOTHING while `isSyncConfigured()` is false (every install today — Phase B of the sync plan flips it from the saved sync settings), so nothing claims "Connected" to a server that doesn't exist and nothing nags red about a server that was never set up. Once configured it sits ABOVE Settings in the sider as a plain status line (no hover highlight, not a button; only the dot has a tooltip and click-to-recheck) and pings `GET /api/meta` every 30 s, on tab focus and on online/offline. Both use `lib/meta-api.ts`. Server side is `main/meta.ts` (no Electron imports — runs in the app, the hosted server and tests): `GET /api/meta` (version from package.json, mode `electron|dev|hosted`, platform, real database path, links), `GET /api/meta/updates` (latest GitHub Release vs running version; 502 when GitHub is unreachable), `GET/POST /api/backups` (`<db>.<stamp>.bak` beside the database via SQLite `VACUUM INTO`, plain copy as fallback; 409 while a sandbox is active). Routes are registered BEFORE `/api/:resource`. `main.ts` routes `target="_blank"` links to the system browser via `setWindowOpenHandler`. The "Sync across devices" row is a placeholder until `plans/phone-app-and-sync.md` Phase B lands — the master plan for the Android APK + Turso-based sync lives there; read it before any phone/sync work.

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
    Settings/page.tsx     → components/settings/SettingsPage.tsx
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
      SurplusTargetPill   # Weekly surplus target, READ-ONLY (opens Settings → Budget, the only editor)
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

### Responsive layout (Oct 2026)
The renderer is plain Next.js with no Electron-only APIs, so the same UI is meant to work in a narrow desktop window and, later, in a phone browser (a future PC ↔ phone sync is planned; the API would then need auth and a configurable address instead of the hard-coded loopback).
- **Sider**: `CustomSider` is a permanent 260px column at `SIDER_BREAKPOINT` (`md`, 900px) and wider, and a temporary `Drawer` below it. `MobileTopBar` (the ThemedLayout `Header` slot) renders the hamburger only below that breakpoint; both share Refine's `useThemedLayoutContext().mobileSiderOpen`. The drawer closes on any route change. Neither uses `noSsr` — it caused a hydration mismatch against the static export.
- **Breakpoints, not device sniffing, for layout**: Overview pay-week cards wrap below `lg` (`flex: 1 1 170px`, surplus card takes its own row), Bills/Personal grids go 3-per-row at `md` and only split evenly across pay weeks at `lg`. The Plan toolbar stacks the Ready-to-Assign pill above the buttons below `md`. The Plan table scrolls sideways at `xs` (`minWidth: 440`). Statistics uses `minHeight: 100%` so a short window scrolls instead of squeezing the chart out (`MonthlyStackedBars` keeps `MIN_CHART_HEIGHT`, with the SVG absolutely positioned so it can't ratchet the measured box).
- **`hover: none`, not width, for touch**: hover-revealed controls (Plan drag handles and row actions, sider account pencil) get `"@media (hover: none)": { opacity: 1 }` so a resized PC window keeps its hover behaviour. `tooltipStyleProps` sets `enterTouchDelay: 0` so a tap opens the shared tooltips. Charts toggle highlight on click as the touch fallback.
- Popovers cap at `min(<px>, calc(100vw - 32px))`; dialogs were already `fullWidth` + `maxWidth`. Number fields carry `inputMode` (`decimal` for amounts, `numeric` for day fields). Viewport heights use `100dvh` with a `100vh` fallback. The Electron window has a 720×480 minimum (`main/main.ts`).
- Demo servers for checking layouts without touching dev.db: `.claude/launch.json` has `demo-api` (port 5858, demo.db) and `demo-ui` (port 8888). While the INSTALLED app is running it owns 5858, so use `demo-api-5859` + `demo-ui-5859` instead: `scripts/demo/serve.ts --port 5859` and `next dev` with `NEXT_PUBLIC_API_URL=http://127.0.0.1:5859/api` (read by `renderer/lib/api-url.ts`; unset in the PROD build, so the installed app always uses 5858). `isAllowedHost` in `main/api-server.ts` checks against the port actually passed to `startServer` (port 0, the route tests, keeps 5858).
- Phone check (Oct 27 2026, S25 Ultra = 412×915 CSS px): every sider page was walked at that size and at a 1000×480 desktop window. Rules that came out of it: every header row that holds a title + button wraps (`flexWrap`) with `whiteSpace: nowrap` on the button, so a label never breaks mid-phrase; the sider column's children carry `flexShrink: 0` (MUI `Collapse` has `min-height: 0`, so the Cash list was the only thing that shrank in a short window and its rows painted over Payees/Expenses); grid columns that hold a fixed-size child use `minmax(0, 1fr)` (the Statistics donut forced its 320px onto the legend); the Overview summary tiles need ~280px each.

### Auto-assign amounts
- `repeatWeekly` Personal items (Gas, Spending, etc.) → **always add a flat per-period amount** (never cumulative top-up). This is intentional — each pay week gets a fresh allowance regardless of prior assigned state.
- `splitAcrossWeeks` Personal items → cumulative top-up. Target = sum of per-period slices (from `computeSplitPersonalAllocations`) through the clicked pay week; caller subtracts current `available` so already-funded prior weeks aren't double-counted.
- Bills with a `BillSplit` row per pay week → cumulative top-up (same shape as split personals). Prevents prior-week funding from masking later weeks' slices when the user hits Auto for P3 expecting P3's share to be added on top.
- Single-week bills (no split, or one `BillSplit` row) → full amount only in the natural pay week (via `getBillPeriodKey` forward-extension logic).

### Multi-occurrence bills (Aug 2026)
A monthly bill can fire **twice** within a single pay-period view — once as the in-month occurrence, once as the next-month forward-extension. Example: a bill with dueDate=4 in Sept 2026 has coord=4 (Sep 4, P1) AND coord=34 (Oct 4, P5).

- `getBillOccurrencesInView(dueDate, periods)` in `pay-period-utils.ts` returns EVERY occurrence in the view (up to 2). Prefer this over `getBillPeriodKey` (which returns only the primary). It never includes the next view's first-week firing — that is a pre-save candidate (`getPreSaveOccurrence`), see "Pre-saving".
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

### Pre-saving for next month's first pay week (Oct 2026)
A bill that fires in the NEXT view's FIRST pay week has no earlier week in that view to level into: when a month's first payday is the 4th, bills due the 4th–6th all land on that one paycheck (Nov and Dec 2026 showed ~$85 surplus in P1 vs $160–$220 elsewhere). Optimize now saves ahead for them from the current month's unlocked weeks.
- **Attribution is unchanged** — still no backward extension. `getBillOccurrencesInView` never returns the next view's firing; the full-year coverage test still counts every firing in exactly one view. Pre-saving only adds optional `BillSplit` slices in the prior month.
- **Candidate** = `getPreSaveOccurrence(dueDate, periods)`: the bill's day (clamped to the next month) lies in `[nextViewFirstPayday, nextViewFirstWeekEndDay]` (both on `PayPeriod`, with `daysInNextMonth`). Its coord in the prior view is `day + daysInMonth` — the forward-extension convention — which is always PAST the view's last period end (`isPreSaveCoord`). That is how display code recognises a pre-save row; there is no natural fallback for one.
- **Balance**: `balancePayWeeks` takes `nextViewFirstWeek` (that week's income + optimizer personal expenses) and adds it as one VIRTUAL week (index `periods.length`) that only pre-save units may use; this view's own bills never move into it. Phase 2 levels the cluster across the unlocked weeks + the virtual week until no week is over budget. Virtual-week rows are NOT returned (`nextViewFirstWeekBillCents` reports the total) — the next month plans its own first week. Locked weeks still never receive new cents; a pre-save row already in a locked week is committed (`lockedAllocations`) and only the remainder is leveled.
- **Next month** gets `priorViewAllocations` (prior-month rows with `isPreSaveCoord`, re-keyed to its in-month coord by subtracting the prior month's length): committed funding that reduces the occurrence's remainder and counts in `assertNoUnderfundedBills`, but never enters that month's `perWeek` and never counts as a row (`hasLockedRows`). `planOptimize` carries each month's freshly planned rows forward in `effectiveRows` so month M reads M-1's pre-saves from the same run; the fast path and idempotency hold across the pair.
- **Display / Plan**: `getBillAllocationsForBill` returns pre-save rows with `isPreSave: true, isSplit: true` (BillsOverview: "Split · Dec 4th" in November with cumulative Saved) and puts `priorViewSavedCents` on the first row of a first-week occurrence (capped at what its own rows leave uncovered, which neutralises leftover orphan-era rows in locked history). The natural fallback for such an occurrence is the remainder, not a second full amount. `resolveAutoAssignAmountForPeriod` treats either flag as cumulative and adds `priorViewSavedCents`, so in the firing month the P1 target is the FULL bill (the pre-saved cents sit in the same envelope) and the ⚠ badge never reads them as over-funding; BudgetPage's paid-occurrence credit includes them too. All split mappings keep `occurrenceCoord` (see the Plan-page mapping invariant).
- Pinned by the `Pre-saving` describes in `pay-period-utils.test.ts` (helper, balance, locked weeks, prior-view funding, display, `planOptimize` end to end + idempotency) and `budget-utils.test.ts` (Auto-assign / badge agree with the Overview).

### Bill balance schema
`BillSplit(billId, monthKey, weekIndex, amountCents, occurrenceCoord)` with `@@unique([billId, monthKey, weekIndex, occurrenceCoord])` — replaces the old `BillPayWeekOverride` table (removed). `occurrenceCoord` distinguishes multiple firings of the same bill in one view. The `balancePayWeeks` algorithm writes splits to fine-tune per-week amounts.

### Overview optimizer — locked-week semantics
`planOptimize` (`renderer/lib/optimize-plan.ts`) treats every split row in a locked past week as "already committed" (`lockedAllocations`), regardless of whether it matches the algorithm's natural attribution. Only splits in NON-locked weeks get deleted and recomputed on Optimize. Legacy `coord=0` rows are resolved to the primary occurrence via `getBillOccurrencesInView`. Deleting locked history was the bug that caused P3/P4 to inherit the full two split bills amounts and crush the weekly surplus.

`handleOptimize` (OverviewPage) is two-phase: **Phase A = `planOptimize`**, a pure function that plans all 36 months (balance + `assertNoUnderfundedBills`) with zero DB writes, **Phase B applies** deletes → creates (unlocked allocations + $0 skipped markers). A planning failure leaves the DB untouched. The old single loop deleted a month's rows and then died mid-create, silently dropping two split bills from Oct 2026. Failures show an error toast and keep the stale alert; success alone clears it. Since Oct 2026 each month is balanced together with the NEXT month's first pay week (see "Pre-saving"), so consecutive months are linked through `effectiveRows`; everything else about a month is still independent.

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
npm run test          # run all (348 tests as of Oct 27 2026, incl. the local lock-ins)
npm run test:watch    # watch mode
```

Key invariants covered by `pay-period-utils.test.ts`:
- **Full-year coverage** — for every bill in the user's actual bill set, every real-world firing (Aug 2026 → Jul 2027) is attributed to exactly one view. Guards against orphan double-counting AND dropped bills.
- **Multi-occurrence bills** — Sept 2026 dueDate=5 returns 2 occurrences; balance places both; underfunded stays empty.
- **Locked-allocation preservation** — a bill with half its amount locked in P2 has only the remaining half placed in unlocked weeks (not the full amount again).
- **Assertion helper** — `assertNoUnderfundedBills` throws on any short-funded occurrence; the Overview optimizer calls it after every month's balance.
- **Oct 2026 regression (modeled on real data, anonymized)** — locked weeks (incl. the current, started week) never receive new cents; the exact 500 setup emits nothing into locked P1; a bill moved into the current week (31st → 18th) or a price bump there lands in `skipped`; the $0 marker makes the skip idempotent; the next month plans it normally.
- **Pre-saving (generic $325 cluster due the 4th–6th, Oct → Nov 2026)** — Oct's open week saves ahead for Nov P1, each firing is funded exactly once across the two views, locked weeks stay untouched, the next view plans only the remainder, `planOptimize` is idempotent once applied.

Key invariants covered by `budget-utils.test.ts`:
- **Plan ↔ Overview alignment (multi-occurrence)** — `resolveAutoAssignAmountForPeriod` returns the correct cumulative envelope amount when splits carry proper `occurrenceCoord`. Regression guard for the BudgetPage mapping — if occurrenceCoord is ever stripped upstream, cumulative totals inflate (e.g. P5 → 3× instead of 2× the bill on the multi-occurrence case).
- **Plan ↔ Overview alignment (pre-saving)** — the prior month's Auto-assign targets its pre-save slice in the week it was saved; in the firing month the P1 target is the full bill (pre-saved cents included) and `evaluatePlanSync` neither flags them as over-funding nor asks Sync Plan to pull them back.

### Lock-in tests (refactor safety net, Oct 2026)
The user's rule for cleanup work is **no change in how the app functions**. These tests pin today's behavior so a refactor that changes anything fails.

**They are LOCAL-ONLY (gitignored).** They run on real personal data (bill names, costs, balances) and the GitHub repo is public. `.gitignore` covers `tests/fixtures/`, `tests/helpers/refine-fixture-mock.ts`, `*.lockin.test.ts(x)` and their `__snapshots__`. They still run locally and in the pre-push hook; fresh clones just don't have them, and they aren't backed up by git. Committed tests must use generic sample data, never real bill names or amounts.
- **Fixture** `tests/fixtures/finance-snapshot-2026-10-18.json`: a frozen copy of the DEV DB on Oct 18 2026. **Income is FAKE** ($700/wk "Paycheck"; every paycheck is $700, with the difference folded into the Checking opening balance so balances and Ready to Assign are unchanged; bill splits re-planned for that income). Payees are dropped and memos blanked except "Income". The user does not want real income data in the GitHub repo, so never put real income, paycheck amounts or employer names in fixtures, tests, snapshots or docs.
- **`tests/helpers/refine-fixture-mock.ts`**: a fake `@refinedev/core` backed by that fixture, with stable query results, mutation spies and `overrideRows()` for per-test scenarios. The tests pin the clock with `vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime(new Date(2026, 9, 18, 12))`, and stub `localStorage` (Node's own global shadows jsdom's).
- `OverviewPage.lockin.test.tsx`: Overview numbers + whole-page text snapshots for Sep/Oct/Nov.
- `OverviewPage.optimize.lockin.test.tsx`: the exact BillSplit writes for four Optimize scenarios. `optimize-plan.lockin.test.ts`: planner invariants (a fresh re-plan rebuilds the fixture's rows exactly, locked weeks are never touched, runs are idempotent).
- `BudgetPage.lockin.test.tsx`: Plan amounts, ⚠ badges / Sync Plan state, and the exact Auto-assign P3 writes after the Oct 21 paycheck.
- `main/api-server.routes.test.ts`: real HTTP + the data layer against an EMPTY temp database built from `shared/data/schema.sql` by `scripts/empty-db.mjs` (shared with the template-db and demo-db builders), via the test-only `FINANCES_OS_TEST_DB_URL` (read in `shared/db.ts`). It never touches dev.db, so it runs on a clean checkout (GitHub Actions). It is the **behavioural contract of `shared/data/`**: it must pass unchanged after any change there.

A snapshot diff means the app would show or write something different. Only re-record (`npx vitest run -u`) for a behavior change the user asked for, and say so in the commit. Run with `CI=true` to fail on missing snapshots instead of writing them.

MUI Autocomplete has a jsdom quirk: `pointerEvents` may need to be set before `fireEvent.click`. See `reference_test_harness.md` in memory for mock patterns.
