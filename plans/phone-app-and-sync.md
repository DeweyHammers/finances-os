# Master plan: phone app (APK) + Obsidian-style sync

Settled 2026-10-27 after a day of back and forth. The constraints that
decided it, in the user's words: *"see my budget when at work and add
transactions"*; the PC is **off** during the workday; **no money to spare**;
the phone app should be a **download on GitHub** like the Windows installer;
sync should work **like Obsidian Sync** (automatic, status icon, works when
the other device is off); and other people must be able to use it without
the user hosting anything for them.

## The plan in one paragraph

Finances OS becomes two installable apps that share one data layer: the
existing Windows desktop app and a new Android app (the same renderer wrapped
with Capacitor, built and signed by GitHub Actions and attached to every
Release next to the `.exe`). Each app owns a local SQLite database and works
fully offline, exactly like today's desktop. Sync is opt-in and "bring your
own database": the user creates a free Turso (hosted libsql/SQLite) database
and pastes its URL + token into Settings on each device. The desktop keeps a
local embedded replica of it (offline-capable, syncs when online); the phone
talks to it directly over HTTPS. Because there is one source of truth there
is no merge logic to get wrong. A sync icon in the sider shows connected /
syncing / offline / last synced, like Obsidian's. Nothing is hosted by the
author; a paid "we host it for you" tier can be added later on the same
mechanism by filling in Settings automatically.

## Decisions and why (so they are not re-litigated)

| Decision | Why |
| --- | --- |
| Standalone Android app, not a PWA | A PWA needs a server that is always on; the PC is off and there is no budget. An APK on GitHub is also what the user asked for. |
| Capacitor wrapper around the existing renderer | The renderer uses no Electron APIs (verified) and already renders at 412×915 (fixed 2026-10-27). No second UI. |
| One shared data layer over a tiny SQL interface | The phone cannot run Express + Prisma. Two hand-written layers would drift and the budget would disagree between devices. Write it once, run it everywhere, keep the route tests as the contract. |
| Shared cloud SQLite (Turso) for sync, not a change-log relay | One source of truth = no merge rules in a finance app. Turso has a free tier with no server to run. The encrypted-change-log-through-GitHub design (closest to Obsidian internally) stays documented below as the upgrade if end-to-end encryption is ever wanted. |
| Sync is opt-in, bring your own database | Keeps the free app free of hosting cost and liability. Local-only users see no change. |
| Hosted mode (server/index.ts) shelved | Proven 2026-10-27 and kept in the repo; it becomes the paid tier's server, not the free app's. |
| Export-to-SQLite from the first sync release | Turso's free tier is not under the user's control. The database is plain SQLite, so "export, then go local-only or move" must always be one click. |

Rejected on the way: PC serves the phone over Tailscale (PC is off); paid
cloud machines (no budget); Render/Vercel/Netlify free tiers (no persistent
disk, kill SQLite); Oracle Always Free (card on file, a box to manage, and
still "the author hosts"); Syncthing file sync (only syncs when both devices
are on at the same time — evenings only — and a whole-file conflict on a
database is unrecoverable).

## How it works

```
 Windows app                         Android app
 ┌──────────────────────┐            ┌──────────────────────┐
 │ renderer (Next)      │            │ renderer (Next)      │
 │   Refine data provider ──┐        │   Refine data provider ──┐
 │ main process         │  │        │ WebView (Capacitor)  │  │
 │   data layer (shared) ◄─┘        │   data layer (shared) ◄─┘
 │   libsql: local file │            │   local: SQLite plugin│
 │     + embedded replica│           │   synced: libsql/web  │
 └──────────┬───────────┘            └──────────┬───────────┘
            │ sync (when online)                │ HTTPS (per query)
            └────────────►  Turso DB (user's own, free)  ◄────────┘
```

- **Data layer** (`shared/data/`): resource CRUD with the exact behaviour of
  today's routes (numeric coercion, list filters / sorting / total count, the
  single-primary-income rule, the category-delete name snapshot), plus the
  schema DDL and a `schemaVersion` row. It needs only `exec(sql, params)`.
  Backends: libsql (desktop, local file or embedded replica),
  `@capacitor-community/sqlite` (phone, local), `@libsql/client/web` (phone,
  synced). The Express API becomes a thin wrapper over it; the renderer's
  Refine data provider calls it directly on the phone (no HTTP).
- **Sync modes per device**: *Local only* (default; today's behaviour) or
  *Synced* (Turso URL + token in Settings). Switching local → synced uploads
  the local database once (or, when the cloud already holds data, asks which
  side wins); synced → local keeps the last replica as the local file.
  Export/Import database buttons exist in both modes. The desktop replica is
  libsql's *remote replica*: reads local, writes forwarded to the cloud — so
  the PC is read-only while offline (chosen over libsql's experimental
  offline-writes mode: no conflicts, ever).
- **Status icon** (sider footer + Settings → Sync): connected / syncing /
  offline (phone) or offline-pending-sync (desktop replica), with "last
  synced …". Tapping it forces a sync.
- **Versions**: the database carries `schemaVersion`; an app older than the
  database refuses to sync (shows "update the app on this device") instead
  of writing a shape it doesn't know. Migrations run from the data layer,
  identically on every backend.
- **Sandbox mode**: desktop only, as today, on a local copy; sync is paused
  while active and resumes after Keep/Discard (Keep = the replica is
  overwritten by the copy and pushed). The phone shows the amber banner if
  it sees the desktop's sandbox flag and stays read-only meanwhile.
- **Secrets**: the Turso token lives in Electron's `safeStorage` on the PC
  and in Capacitor secure storage on the phone, never in the database.

## Phases

### Phase A — Foundation (no visible change)
1. **Shared data layer** in `shared/data/` over `exec(sql, params)`, with the
   DDL generated from `prisma/schema.prisma` (`prisma migrate diff`) and a
   `schemaVersion` table. Run the existing `main/api-server.routes.test.ts`
   contract against it, then switch the Express routes to call it. Prisma
   stays only for the schema file and `db push` in dev until the libsql
   backend is in; then it goes. **Done 2026-10-27** (libsql backend included;
   see CLAUDE.md → "Shared data layer"). Prisma is now schema-file + `db push`
   only.
2. **Settings page** (`/Settings`, Obsidian-style): General (version, check
   for updates against GitHub Releases, help, report a problem), Budget
   (surplus target, link to Income), Data (database location, backups via
   `VACUUM INTO`, export / import, sandbox state), Sync (mode, status icon,
   Turso URL + token, "Forget this device"). Backed by `/api/meta`,
   `/api/meta/updates`, `/api/backups`. (Started 2026-10-27, paused.)
3. **Connection / sync status indicator** in the sider footer, shared with
   Settings → Sync.

### Phase B — Desktop sync (proves the loop with the PC alone)
4. libsql backend with embedded replica (`url: file:`, `syncUrl`,
   `authToken`); `@prisma/adapter-libsql` / `libsql` are already installed.
   **Done 2026-10-27** — `shared/data/backends/libsql.ts` (remote replica,
   writes forwarded to the cloud, read-only plain open as the offline
   fallback), `main/sync.ts` + `main/sync-settings.ts`, `/api/sync/*`.
   See CLAUDE.md → "Sync". Decision made on the way: libsql's remote
   replica (mature) rather than its experimental offline-writes mode, so
   there is still exactly one source of truth; offline = read-only.
5. Settings → Sync wiring, first-upload on switch, export/import, the icon
   goes live. **Done 2026-10-27** (`components/settings/SyncSection.tsx`,
   `layout/ConnectionStatus.tsx` + `layout/SyncBanner.tsx`,
   `lib/use-connection-status.ts`). Verified end to end against a local
   libsql-server (Docker); the Turso run is the user's to do with a
   throwaway database (Settings → Phone & sync).
6. Guide: "Set up sync" in `docs/sync.html` — **text done 2026-10-27**,
   screenshots are TODO placeholders.

### Phase C — Android app, local only
7. Capacitor project under `android/` wrapping the renderer's static export;
   local SQLite plugin backend; Refine data provider calling the data layer
   in-process.
8. GitHub Actions job: build + sign the APK on every `v*` tag and attach it
   to the Release beside the installer (signing key as a repo secret).
   README: "Android: download the APK, allow installs from this source".
9. Phone polish: Overview as start screen, floating "Add transaction" on
   Cash, install icon/splash from the logo.

### Phase D — Phone sync
10. `@libsql/client/web` backend; Settings → Sync on the phone; the icon;
    read-only while the desktop is in a sandbox.
11. Schema-version gate on both devices; release notes rule: bump
    `schemaVersion` with every schema change.

### Later, only with demand
- **Paid tier**: the author hosts Turso databases and fills Settings
  automatically on sign-up (same sync code). Needs accounts, billing,
  backups and terms — a product, not a feature.
- **End-to-end encryption**: replace the shared database with an encrypted
  change log relayed through a private GitHub repo (per-row newest-wins,
  git as version history). Most code; only if privacy from the DB vendor
  becomes a requirement.
- **Play Store** listing of the same app.

## What stays true for other users

- Local-only users (installer or APK) see no change; sync is off by default.
- Sync users create their own free Turso database and paste two values;
  their data is in their own account. The author never holds anyone's data.
- A Turso free-tier change hits every sync user at once; export keeps them
  whole. Two devices on different app versions are protected by the
  schema-version gate.

## Hosted mode (shelved, kept working)

`server/index.ts` serves the renderer's static export (built with
`NEXT_PUBLIC_API_URL=/api`) and the API from one origin; proven at phone
size on 2026-10-27 (`.claude/launch.json` → `hosted-demo`, demo data only,
no login). `isAllowedHost` / `isAllowedOrigin` accept
`FINANCES_OS_PUBLIC_HOSTS`; `startServer` takes a bind address. It must not
be exposed with real data until it has a login; it is the server for the
paid tier if that ever comes.
