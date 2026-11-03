# Plan: the phone app (second attempt, Nov 2026)

Agreed with the user on 2026-11-02 after the first attempt (Phase C of
`plans/phone-app-and-sync.md`, branch `android-app`, PR 20) was closed and
deleted: it wrapped the whole desktop renderer in Capacitor and the result
was "the desktop smashed onto a phone" — tables cut off at 412 px, a drawer
as the only navigation, desktop modals. This plan replaces Phase C and the
phone half of Phase D. The desktop renderer is NOT touched by it (one small
main-process change aside, see "Desktop change").

## Decisions (user, 2026-11-02)

| Decision | Choice |
| --- | --- |
| How the app reaches the phone | **APK built on the dev PC**, uploaded to the user's Google Drive, downloaded and installed on the phone. **Nothing on GitHub**: no Pages, no Releases, no workflow artifacts (the releases were removed on 2026-10-30 and stay removed). |
| Where the code lives | `phone/` in this repo (public; it holds UI and the shared maths, never data). |
| What it does | **Transactions are the one writable thing** (add, edit, delete). Everything else is **read-only**: Overview, Plan, account balances, and one Costs page with Bills / Personal / Yearly costs. Purpose: pull out the phone at work or at home to check the plan or show the weekly allowance, and log purchases. |
| Connectivity | **Online only.** The phone reads and writes the user's Turso database directly; no local database, no sync engine, no conflict handling on the phone. Follows from the scope: a read-only app with nothing to show offline. |
| Look | Dark theme and the desktop's palette, fonts and section colours, but a **phone-native UI** (bottom tabs, lists, full-screen forms, 44 px targets). Layout details are Claude's call; keep it plain. |
| Status line | The same bottom status line as the desktop sider, with phone words (see "Connection status"). |
| Start page | **Overview.** |
| Add button | One floating "+" on every tab. Defaults to the Checking account; inside an account's ledger it defaults to that account. |

## Screens

Four bottom tabs + a top bar (title, gear → Settings). MUI `BottomNavigation`,
safe-area aware. Android's back button pops the in-app history.

1. **Overview** (start, read-only). The current pay week first and expanded:
   income, bills due (with the desktop's split/skip subtitles), personal
   allowances, surplus. The other weeks of the month collapsed to one line
   each (income · expenses · surplus), tap to expand. Month picker in the
   title row. The three summary numbers (Bills / Personal / Yearly) as one
   compact row. **No Optimize, no stale alert, no surplus-target editor.**
2. **Plan** (read-only). Ready to Assign sticky at the top. Groups as
   collapsible sections; each item one row: name, assigned, available, the
   same ⚠ badge via the shared `evaluatePlanSync`. **No assign, no Auto,
   no Sync Plan, no reorder, no add.**
3. **Cash** (the writable tab). Account list with balances (Checking,
   Savings…; closed accounts hidden). Tap → the ledger as a list, newest
   first: payee + category on the left, amount on the right (outflow red,
   inflow green), memo + date as the secondary line. Tap a row → Edit
   (full-screen form) with Delete behind a confirm. The "+" opens Add as a
   full-screen form: amount with an **outflow / inflow toggle**, payee
   (autocomplete over existing payees; a new name creates a Payee like the
   desktop does), category (the Plan items grouped), memo, date (today),
   account (preselected). **No add/edit/close account, no adjustments UI**
   (`isAdjustment` rows display, are never created here).
4. **Costs** (read-only). Three sections — Bills (name, amount, "Due 15th"),
   Personal (name, amount, cadence), Yearly costs (name, amount, month) —
   each with its total. **No editing.**
5. **Settings** (gear). Connection: paste the Turso URL + token (same two
   values as the desktop), Connect / Forget; app version; link to nothing
   public. That is all of Settings.

Loading = skeleton rows, never half a toolbar. Empty states reuse the
desktop's words.

## Architecture

```
phone/
  index.html, vite.config.ts, tsconfig.json, package.json (workspace member)
  src/
    main.tsx            # React root, MUI ThemeProvider (theme from renderer/app/theme)
    App.tsx             # tabs + routes (react-router, hash history)
    data/
      turso-executor.ts # SqlExecutor over @libsql/client/web (Hrana over HTTPS)
      store.ts          # the shared DataStore on that executor + query hooks
      connection.ts     # URL/token storage, connect/forget, status polling
    screens/            # Overview, Plan, Cash (Accounts, Ledger), Costs, Settings
    components/         # BottomTabs, TopBar, StatusLine, AddFab, TransactionForm, …
  android/              # Capacitor project (generated once, committed)
  keystore/             # GITIGNORED — the release key lives only on the dev PC
```

- **Stack.** Vite + React 19 + MUI 9 (same major versions as the renderer),
  react-router (hash history — Capacitor serves files), TanStack Query for
  caching/refetch (Refine is not used: its hooks and simple-rest add weight
  the phone does not need). Capacitor (current major) wraps the `dist/`.
- **Shared code, imported directly, never copied:** `renderer/lib/`
  (`pay-period-utils`, `budget-utils`, `budget-display`, `cycle-utils`,
  `cents`, `date-utils`, `constants` — all pure TypeScript, only `date-fns`
  outside), `shared/data/` (`DataStore`, `schema`, `coerce`, `transfer`'s
  `schemaVersionGate`). The MUI theme object moves from `renderer/app/
  providers.tsx` into `renderer/app/theme.ts` (an extraction, no change) so
  both apps import the same palette. Phone screens do their own layout; the
  numbers come from the same functions the desktop calls.
- **Data path.** `turso-executor.ts` implements `SqlExecutor.exec(sql,
  params)` with `@libsql/client/web`'s `createClient({ url, authToken })`.
  The store's `BEGIN` / `COMMIT` / `ROLLBACK` cannot be sent as statements
  over stateless HTTP, so the executor maps them to a Hrana **interactive
  transaction** (`client.transaction("write")` → `tx.execute` → `tx.commit()`
  / `tx.rollback()`); statements outside a transaction go through
  `client.execute`. `RETURNING` works on Turso as it does on libsql. The
  `DataStore` then runs unchanged: same validation, same cuids, same
  millisecond dates, same Income/Category rules (unused by the phone but
  present). Reads for a screen are bundled into one `client.batch` where it
  matters (the Overview needs settings, incomes, bills, splits, personals,
  yearly costs, budget items, assignments and the month's transactions).
- **CORS.** The Capacitor WebView's origin is `https://localhost`; a fetch
  to `*.turso.io` is cross-origin. If Turso's Hrana endpoint does not send
  permissive CORS headers (unverified — step 1 checks), route the client's
  `fetch` through `@capacitor/core`'s `CapacitorHttp`, which performs the
  request natively and is not subject to CORS. The browser dev check
  (below) runs against the sync mock on `127.0.0.1`, which does send them.
- **Settings storage.** URL + token in `@capacitor/preferences` (app-private
  storage on the phone; the user's own device). The token never appears in
  logs or screens. Forget deletes both and clears the query cache.
- **Schema gate.** On connect and once per app start the phone reads
  `SchemaVersion` and compares it with its own `SCHEMA_VERSION`. Cloud
  newer → read-only with "Update the phone app" (the desktop was updated
  first); cloud older → "Update the desktop" and read-only too. Same rule
  and words as the desktop's `schemaGate`.

## Data freshness, and the one desktop change

The phone shows what the cloud holds, i.e. what the desktop last **pushed**.
The desktop pushes 3 s after every write and every 60 s while it runs
(`main/sync.ts`). Gap: the user closes the desktop less than 3 s after a save,
or while offline, and leaves for work — the phone then shows yesterday's
plan, and when the desktop comes back its push **conflicts** with any
transaction the phone wrote in between ("Needs your choice", one side's
changes end up in a `.bak`).

**Desktop change (small, in `main/main.ts` + `main/sync.ts`):** run one
`syncNow()` in the `before-quit` cleanup when sync is configured and
`pendingChanges > 0`, bounded by a few seconds. Pinned by a test in
`main/sync.routes.test.ts`. With it, the conflict case shrinks to "the PC
was offline when it closed", which the existing conflict UI already handles.
The phone itself never creates a conflict: every phone write is already in
the cloud's frame log, so the desktop's next pull simply receives it.

## Connection status

Same place (bottom of the screen, above the tabs), same dot, same colour
language as `components/layout/ConnectionStatus.tsx`, but the phone has no
local copy, so the states are about the connection, not a sync:

| Phone state | Colour | When |
| --- | --- | --- |
| Not set up | grey | no URL saved (the line is hidden on the desktop; on the phone it is the hint to open Settings) |
| Connecting… | amber | a request is in flight after a cold start or a failure |
| Connected | green | the last request succeeded; detail line: "Checked 12 s ago" |
| Offline | red | the last request failed; writes are disabled, the Add button greys out; retried every 30 s and on `online` |
| Update needed | red | schema gate |

Mechanics: `connection.ts` keeps `lastOkAt` / `lastError` from every query and
pings `SELECT 1` every 30 s while the app is in the foreground (Capacitor's
`appStateChange` pauses it). `GET /api/sync` has no counterpart; the phone
asks the cloud, not a server.

## Building and installing (user + script)

One-time, by the user (both installers are signed, so Smart App Control
allows them; the exact versions come from the Capacitor release used — the
setup step prints them):

1. A JDK (Adoptium Temurin, the LTS Capacitor asks for).
2. Android **command-line tools** (not Android Studio), then
   `sdkmanager "platform-tools" "platforms;android-<N>" "build-tools;<N>.0.0"`
   and accepting the licences. `ANDROID_HOME` + `JAVA_HOME` set for the user.

By the script (`npm run phone:build` → `scripts/phone-build.mjs`):

1. `vite build` → `phone/dist`; `npx cap sync android`.
2. First run: create `phone/keystore/finances-os-phone.jks` with a generated
   password stored beside it (both gitignored; `.gitignore` extended FIRST)
   and print a loud note: back this folder up privately — a lost key means
   the next APK cannot update the installed one (uninstall = the phone's
   settings are lost; no data lives on the phone).
3. `gradlew assembleRelease` signed with that key →
   `dist/Finances-OS-phone-<version>.apk` (the version from the root
   `package.json`; `versionCode` derived from it so Android accepts it as an
   update).
4. Refuse if the keystore fingerprint differs from the one recorded in
   `phone/keystore/fingerprint.txt` (a rebuilt key would not install over
   the existing app).

By the user, each time: upload the APK to Google Drive, open it on the phone,
Install. First time only: allow installs from Drive ("Install unknown apps"),
and Play Protect may ask once ("Install anyway"). Later builds install as
updates with one tap. `adb` is NOT needed; it is only useful for reading the
app's logs over USB if something crashes (`adb logcat`), and Claude walks the
user through it if that day comes.

## Checking it without a phone

- **`npm run phone:dev`** — Vite on port 8890 at 412×915 in the browser,
  connected to the sync mock (`npx tsx tests/helpers/libsql-sync-server-child.ts
  --port 18081`, which speaks Hrana) filled with the demo tour's FAKE data
  (`scripts/demo/`). dev.db and PROD are never opened. Every screen is
  walked here before an APK is built. **Never type the user's real Turso URL
  or token into the browser check**; the real database is for the phone.
- **Parity tests** (`phone/src/**/*.test.tsx`, Vitest, generic data): for a
  fixture month the Overview screen shows the same income / bills / surplus
  per week as `OverviewPage`'s numbers from the same functions; the Plan
  screen the same available per item and the same ⚠ set as
  `evaluatePlanSync`; Add writes exactly the row `AddTransactionModal` would
  (same keys, same cents, same date encoding). Run in the root suite and the
  pre-push hook. The desktop's existing tests and the local lock-ins guard
  that the desktop is unchanged (the theme extraction is the only shared
  edit).
- A trial APK on the user's phone before each PR merges, from the first PR
  on, since the Gradle build and the WebView are the two things the browser
  cannot prove.

## Order of work

| # | Piece | Done when |
| --- | --- | --- |
| 1 | **Spike** (½ day, throwaway): `@libsql/client/web` from a Vite page against the sync mock and, once, against the user's own Turso database (the user pastes the values into the running page, never into a file): `SELECT count(*)` works, an interactive transaction with `RETURNING` works, CORS headers observed and recorded here. | The data path is proven or the CapacitorHttp route is chosen. |
| 2 | Toolchain: the user installs JDK + command-line tools; `phone/` created with Capacitor; `npm run phone:build` produces a signed APK of a hello-world page; installed from Drive on the phone. | An app icon on the phone that opens. Keystore backed up by the user. |
| 3 | Shell: theme extraction (`renderer/app/theme.ts`, desktop unchanged), bottom tabs, top bar, status line, Settings (connect / forget), schema gate, the executor + store + hooks. | Connected to the mock in the browser check and to Turso on the phone; status line green. |
| 4 | Cash: accounts with balances, ledger list, Add / Edit / Delete transaction (full-screen forms), the FAB on every tab. **Desktop change: sync on quit** (own small PR). | A purchase logged on the phone appears in the desktop ledger after its next sync; parity test for the written row. |
| 5 | Overview (read-only), month picker. | Parity test per pay week. |
| 6 | Plan (read-only) with ⚠. | Parity test for available + badges. |
| 7 | Costs page; icon + splash from the logo (`@capacitor/assets`); status-bar colour = canvas. | First "real" APK the user keeps. |

Each piece is its own PR, checked in the browser at 412×915 and with a trial
APK on the phone before it merges. CLAUDE.md gets a "Phone app" section with
piece 3; `docs/index.html`'s "phone app coming soon" note stays until the
user decides what, if anything, to say publicly.

## Not in this plan

Offline use or a local database on the phone; editing bills, personals,
yearly costs, income, settings or the plan from the phone; Optimize;
Statistics; Sandbox; backups/export; a Play Store listing; an iOS build;
distributing the APK to anyone else.

## Risks

- **Turso CORS / Hrana from a WebView** — unverified until the spike.
- **Capacitor + JDK + SDK versions** — fixed by the Capacitor major chosen in
  step 2; Gradle downloads ~1 GB on the first build.
- **Read volume** — the Overview reads ~9 tables per month; one `batch`
  round trip (~100–300 ms on mobile data) is the target, not nine.
- **Turso free tier** — the same database the desktop uses; the phone adds a
  handful of requests per open. Well inside the free row-read allowance.
- **Lost keystore** — covered by the fingerprint check and the backup note.
