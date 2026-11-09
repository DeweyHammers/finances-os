# Plan: the phone app (second attempt, Nov 2026)

Agreed with the user on 2026-11-02 after the first attempt (Phase C of
`plans/phone-app-and-sync.md`, branch `android-app`, PR 20) was closed and
deleted: it wrapped the whole desktop renderer in Capacitor and the result
was "the desktop smashed onto a phone" — tables cut off at 412 px, a drawer
as the only navigation, desktop modals. This plan replaces Phase C and the
phone half of Phase D. The desktop renderer is NOT touched by it (one small
main-process change aside, see "Desktop change").

**Revised 2026-11-09** against the desktop work of Nov 6 2026 (version
0.5.0: `DataStore.batch` + `POST /api/batch`, Optimize running by itself
after every input change, the sync timer standing down while writes land,
and the version-bump rule). Nothing in the user's decisions moved. What
changed here: the spike gained a second go/no-go check (see step 1 — it is
now the most important line in this plan), "Data freshness" was rewritten
for the automatic Optimize, the APK follows the version rule, and two risks
were added.

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
   (Since Nov 6 2026 the desktop re-plans by itself ~1 s after any bill /
   personal / income / settings change, so the `BillSplit` rows the phone
   reads are normally current; the phone never writes one of those inputs,
   so it can never make the plan stale itself.)
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
  present). The store's write rules are now `applyCreate` / `applyUpdate` /
  `applyRemove`, shared by the single calls and `DataStore.batch`: a plain
  create or update is ONE autocommitted statement (`client.execute`), while
  `remove`, `batch`, an Income write and the AppSettings upsert run inside
  `BEGIN … COMMIT` — so on the phone, Add and Edit are one round trip and
  Delete is the interactive-transaction path (the spike must exercise both).
  The phone has no bulk write, so it does not need `batch`; if one ever
  appears it goes through `store.batch`, never a loop.
  Reads for a screen are bundled into one `client.batch` where it
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
The desktop pushes 3 s after the LAST write of a burst (`noteLocalWrite`;
the 60 s timer stands down while writes are landing) and every 60 s while it
is idle (`main/sync.ts`).

**The rule that makes a phone safe (and the one way it breaks).** libsql
refuses a push when the cloud moved on while this PC had unpushed frames —
that is the desktop's "Needs your choice" conflict, and neither answer
merges: "Use the cloud's copy" drops the PC's unpushed rows into a `.bak`,
"Keep this PC's changes" REPLACES the cloud's rows, which would erase the
transactions the phone logged (they survive only in the `.bak` it names).
So: a phone write is harmless whenever the desktop has nothing unpushed (its
next sync just pulls the row), and a conflict whenever it does. The phone
cannot avoid it from its side; the desktop must not leave unpushed frames
behind. Since Nov 6 2026 there are more of those than "a save in the last
3 s":

- An edit to a bill / personal / income / setting is followed ~1 s later by
  the automatic Optimize (one batch, ~2 s), then the 3 s pause, then the
  push — the PC is "dirty" for roughly 6 s after such an edit, not 3.
- The runner's start-up check (1.5 s after the window opens) may write a
  re-plan nobody asked for: an edit whose run did not finish last time, or
  the horizon's new last month at a month rollover. It runs AFTER
  `initSync()`'s first sync, so it never conflicts with what the phone
  wrote while the PC was off — only with a phone write in the few seconds
  between that re-plan and its push.
- Closing the app inside either window, or working offline, leaves the
  frames unpushed until the next start, whose first sync pushes them — the
  conflict, if the phone wrote in between.

**Desktop change (small, in `main/main.ts` + `main/sync.ts`; its own PR with
piece 4):** on `before-quit`, when sync is configured and
`pendingChanges > 0`, hold the quit (`event.preventDefault()`), run one
`syncNow()` bounded by ~5 s, then quit. Pinned by a test in
`main/sync.routes.test.ts`. A re-plan the runner had not started yet is not
lost: the next start's check finds the baseline differs and plans it, after
the pull. Until then the phone shows the edited bill with the previous plan
— stale by one re-plan, never wrong data. What remains is "the PC was
offline when it closed and the phone wrote before it came back": the
existing conflict screen, where **"Use the cloud's copy" is the answer that
keeps the phone's transactions** (piece 4 adds that sentence to the dialog
once a phone exists).

Not assumed, to be PROVEN in step 1: that a row the phone writes over Hrana
(plain SQL to the cloud) reaches the desktop's synced copy through an
ordinary pull. Every Hrana write the desktop makes today (first upload,
Keep, Import, settling a conflict) is followed by throwing the copy away and
bootstrapping it again, and the tests' "second device" is another
frame-pushing libsql copy — so "SQL write on the cloud, then an incremental
pull on the PC" has never run against Turso. The mock harvests a Hrana
write's WAL frames into its frame log, so it will pass there; the Nov 6
single-device conflict is the reminder that Turso's server is not the mock.

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
   update). The desktop and the phone share that ONE version, and the
   version rule of Nov 6 2026 applies to the APK too: bump it
   (`npm version X.Y.Z --no-git-tag-version`) in the same commit as the
   change, before building. The script refuses to build when an APK with
   this version already exists in `dist/` — two different APKs with one
   version cannot be told apart on the phone, and Android would not install
   the second over the first as an update.
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
| 1 | **Spike** (½–1 day, throwaway except the test). **(a) Phone → cloud:** `@libsql/client/web` from a Vite page against the sync mock and, once, against the user's own Turso database (the user pastes the values into the running page, never into a file): `SELECT count(*)` works, a single `INSERT … RETURNING` works, an interactive transaction (`DELETE … RETURNING` inside BEGIN/COMMIT) works, CORS headers observed and recorded here. **(b) Cloud → desktop, the go/no-go:** a new test in `main/sync.routes.test.ts` — a row written to the mock by `@libsql/client` (Hrana) is pulled by `POST /api/sync/now` with no conflict and no re-bootstrap, and the same write while this PC has an unpushed row IS the conflict. Then the same thing live: with the installed desktop app open and showing "Synced", the spike page adds one test transaction to the user's Turso database; the desktop's next sync must show it, stay "Synced", and a save on the desktop afterwards must push cleanly. The test transaction is deleted from the desktop at the end. | (a) proven, or the CapacitorHttp route chosen. (b) proven on Turso — **if the desktop conflicts or cannot pull a Hrana write, stop**: the fallback to discuss is a desktop rule "the cloud moved and this PC has nothing unpushed → fetch the copy again by itself", before any phone UI is built. |
| 2 | Toolchain: the user installs JDK + command-line tools; `phone/` created with Capacitor; `npm run phone:build` produces a signed APK of a hello-world page; installed from Drive on the phone. | An app icon on the phone that opens. Keystore backed up by the user. |
| 3 | Shell: theme extraction (`renderer/app/theme.ts`, desktop unchanged), bottom tabs, top bar, status line, Settings (connect / forget), schema gate, the executor + store + hooks. | Connected to the mock in the browser check and to Turso on the phone; status line green. |
| 4 | Cash: accounts with balances, ledger list, Add / Edit / Delete transaction (full-screen forms), the FAB on every tab. **Desktop change: sync on quit** (own small PR, with the "Use the cloud's copy keeps the phone's transactions" line in the conflict dialog). | A purchase logged on the phone appears in the desktop ledger after its next sync; parity test for the written row; closing the desktop right after an edit leaves `pendingChanges` at 0. |
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

- **A Hrana write pulled by the desktop's synced copy** — unverified against
  Turso until the spike, and the assumption the whole design rests on.
- **Conflicts on the desktop cost phone data if answered wrong.** A conflict
  already happened with ONE device (Nov 6 2026, after a long multi-push
  Optimize; the batch write made pushes small since). With a phone, "Keep
  this PC's changes" erases what the phone logged since the last pull.
  Mitigations: sync on quit, small pushes, the dialog's wording, and the
  `.bak` every resolution writes.
- **Turso CORS / Hrana from a WebView** — unverified until the spike.
- **Capacitor + JDK + SDK versions** — fixed by the Capacitor major chosen in
  step 2; Gradle downloads ~1 GB on the first build.
- **Read volume** — the Overview reads ~9 tables per month; one `batch`
  round trip (~100–300 ms on mobile data) is the target, not nine.
- **Turso free tier** — the same database the desktop uses; the phone adds a
  handful of requests per open. Well inside the free row-read allowance.
- **Lost keystore** — covered by the fingerprint check and the backup note.
