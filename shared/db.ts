/**
 * db.ts — which database file the app is on, and the DataStore that talks to
 * it. (Until Oct 2026 this was shared/prisma.ts and held a PrismaClient; the
 * old module name still works as a re-export for the route tests.)
 *
 * Three jobs:
 *   1. Resolve the REAL database path: prisma/dev.db in dev, %APPDATA%\
 *      finances-os\database.db in PROD (copied from the empty template.db on
 *      a fresh install), or the test-only FINANCES_OS_TEST_DB_URL override.
 *   2. Hold the swappable connection. Sandbox mode (main/sandbox.ts) copies
 *      the database and points the API at the copy for a while, and sync
 *      (main/sync.ts) points it at an embedded replica of the cloud database;
 *      every route reaches whichever file is current through `getStore()`.
 *   3. `switchDatabase(target, beforeConnect)`: close the current file, let
 *      the caller copy / overwrite / delete files while nothing holds them,
 *      then open the next one lazily (on its first query).
 *
 * "Primary" is the database the app returns to after a sandbox: the real
 * local file, or — once sync is on — the replica. main/sync.ts sets it.
 */
import { app } from "electron";
import path from "path";
import fs from "fs";
import { DataStore } from "./data";
import { openLibsql, type LibsqlConnection, type LibsqlSyncOptions } from "./data/backends/libsql";

const isProd = process.env.NODE_ENV === "production" || (app && app.isPackaged);

// In dev mode, use the local prisma folder. In prod, use userData.
let dbUrl = "file:./prisma/dev.db";

// Logger helper
const logFile = app
  ? path.join(app.getPath("userData"), "prisma-setup.log")
  : null;
function dbLog(msg: string) {
  console.log(`[Database] ${msg}`);
  if (logFile && isProd) {
    try {
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
    } catch (e) {}
  }
}

if (isProd && app) {
  const userDataPath = app.getPath("userData");
  const dbPath = path.join(userDataPath, "database.db");

  const appPath = app.getAppPath();
  const actualResourcesPath = path.dirname(appPath);

  if (!fs.existsSync(dbPath)) {
    dbLog(`Database not found at ${dbPath}, attempting to copy template...`);
    // template.db is an EMPTY database built from the schema by
    // scripts/build-template-db.mjs (the `prebuild` step) and packaged by
    // electron-builder.yml. It used to be prisma/dev.db — the developer's
    // real data — which must never ship in a public installer.
    const templateDbPath = path.join(
      actualResourcesPath,
      "app.asar.unpacked/prisma/template.db",
    );
    const templateDbPathInAsar = path.join(
      actualResourcesPath,
      "prisma/template.db",
    );

    try {
      if (fs.existsSync(templateDbPath)) {
        fs.copyFileSync(templateDbPath, dbPath);
        dbLog("Database template copied from unpacked resources");
      } else if (fs.existsSync(templateDbPathInAsar)) {
        fs.copyFileSync(templateDbPathInAsar, dbPath);
        dbLog("Database template copied from asar resources");
      } else {
        // The data layer creates the schema in the empty file on first use
        // (prepareDatabase), so the app still starts; the log keeps the
        // packaging problem visible.
        dbLog(
          "WARNING: Database template not found in any expected location — an empty database will be created",
        );
      }
    } catch (e: any) {
      dbLog(`Failed to copy database template: ${e.message}`);
    }
  } else {
    dbLog(`Using existing database at ${dbPath}`);
  }
  // Use forward slashes for SQLite on Windows and ensure it's absolute
  const absoluteDbPath = path.resolve(dbPath);
  dbUrl = `file:${absoluteDbPath.replace(/\\/g, "/")}`;
  dbLog(`Production Database URL: ${dbUrl}`);
} else {
  // DEVELOPMENT MODE
  // Ensure the dev DB path is absolute to avoid confusion during dev.
  // FINANCES_OS_TEST_DB_URL is a TEST-ONLY override (main/api-server.routes
  // tests point it at a throwaway copy so they can never write to dev.db).
  // Nothing in the app sets it, so dev/PROD behavior is unchanged.
  dbUrl =
    process.env.FINANCES_OS_TEST_DB_URL ??
    `file:${path.join(process.cwd(), "prisma/dev.db")}`;
}

// ── Swappable store (Sandbox mode, Oct 2026; sync, Phase B) ───────────────
// `dbUrl` above is the REAL database. Sandbox mode copies it and points the
// API at the copy for a while; sync points the API at a replica file. So the
// store the routes talk to has to be replaceable at runtime.

const REAL_DB_URL = dbUrl;

/** Where the API points: a `file:` URL plus how to open it. */
export interface DatabaseTarget {
  url: string;
  /** Open as an embedded replica of this remote (see backends/libsql.ts). */
  sync?: LibsqlSyncOptions;
  /** Refuse writes (the offline fallback for a replica whose cloud is unreachable). */
  readOnly?: boolean;
}

/** `file:` URL → filesystem path (the URL always uses forward slashes). */
export function databaseUrlToPath(url: string): string {
  return url.replace(/^file:/, "");
}

/** Filesystem path → `file:` URL. */
export function pathToDatabaseUrl(p: string): string {
  return `file:${p.split("\\").join("/")}`;
}

/**
 * How a target becomes a connection. Replaceable ONLY by tests (main/sync
 * tests stand in a plain file for the replica so no network is needed);
 * the app always uses openLibsql.
 */
type ConnectionOpener = (target: DatabaseTarget) => LibsqlConnection;
let openConnection: ConnectionOpener = (target) =>
  openLibsql(databaseUrlToPath(target.url), { sync: target.sync, readOnly: target.readOnly });

export function __setConnectionOpenerForTests(opener: ConnectionOpener | null): void {
  openConnection = opener ?? ((target) =>
    openLibsql(databaseUrlToPath(target.url), { sync: target.sync, readOnly: target.readOnly }));
}

function toTarget(target: string | DatabaseTarget): DatabaseTarget {
  return typeof target === "string" ? { url: target } : target;
}

function makeStore(target: DatabaseTarget): { store: DataStore; connection: LibsqlConnection } {
  const connection = openConnection(target);
  return { store: new DataStore(connection), connection };
}

let primary: DatabaseTarget = { url: REAL_DB_URL };
let currentTarget: DatabaseTarget = primary;
let current = makeStore(primary);
if (isProd) dbLog("Data layer initialized (libsql)");

/** The store the API is talking to right now (real, replica or sandbox). */
export function getStore(): DataStore {
  return current.store;
}

/** The connection under the current store (main/sync.ts opens it eagerly). */
export function getCurrentConnection(): LibsqlConnection {
  return current.connection;
}

/** `file:` URL of the real local database file — the one Sandbox copies and sync replaces. */
export function getRealDatabaseUrl(): string {
  return REAL_DB_URL;
}

/** `file:` URL of the database currently in use. */
export function getCurrentDatabaseUrl(): string {
  return currentTarget.url;
}

/** The target currently in use (url + how it was opened). */
export function getCurrentTarget(): DatabaseTarget {
  return currentTarget;
}

/** The database the app returns to after a sandbox: the real file, or the replica once synced. */
export function getPrimaryDatabase(): DatabaseTarget {
  return primary;
}

/** Record the primary without switching to it (main/sync.ts). */
export function setPrimaryDatabase(target: string | DatabaseTarget): void {
  primary = toTarget(target);
}

/**
 * Point the API at another database. The current store is closed first so
 * its file handle is released (Windows won't let the sandbox file be deleted
 * or the real file be overwritten while a handle is open), then
 * `beforeConnect` may touch the files, and only then is the new store
 * created. The libsql backend opens its file lazily, on the first query, so
 * nothing holds the new file open until a route actually uses it — except a
 * replica, which main/sync.ts opens eagerly to learn whether the cloud is
 * reachable.
 */
export async function switchDatabase(
  target: string | DatabaseTarget,
  beforeConnect?: () => void,
): Promise<void> {
  await current.store.close();
  beforeConnect?.();
  const next = toTarget(target);
  current = makeStore(next);
  currentTarget = next;
}

/** `switchDatabase(getPrimaryDatabase())`. */
export function switchToPrimary(beforeConnect?: () => void): Promise<void> {
  return switchDatabase(primary, beforeConnect);
}

/**
 * Raw-SQL escape hatch with the three PrismaClient methods the route tests
 * use to wipe tables and release the file. Application code uses
 * `getStore()`; this exists so main/api-server.routes.test.ts — the data
 * layer's behavioural contract — runs unchanged.
 */
export const prisma = {
  $queryRawUnsafe: <T = any>(sql: string): Promise<T> =>
    current.store.raw(sql) as Promise<T>,
  $executeRawUnsafe: async (sql: string): Promise<number> => {
    await current.store.raw(sql);
    return 0;
  },
  $disconnect: (): Promise<void> => current.store.close(),
};
