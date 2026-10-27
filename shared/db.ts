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
 *      the real file and points the API at the copy for a while; every route
 *      reaches whichever file is current through `getStore()`.
 *   3. `switchDatabase(url, beforeConnect)`: close the current file, let the
 *      caller copy / overwrite / delete files while nothing holds them, then
 *      open the next one lazily (on its first query).
 */
import { app } from "electron";
import path from "path";
import fs from "fs";
import { DataStore } from "./data";
import { openLibsql } from "./data/backends/libsql";

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

// ── Swappable store (Sandbox mode, Oct 2026) ──────────────────────────────
// `dbUrl` above is the REAL database. Sandbox mode copies that file and
// points the API at the copy for a while, so the store the routes talk to
// has to be replaceable at runtime.

const REAL_DB_URL = dbUrl;

/** `file:` URL → filesystem path (the URL always uses forward slashes). */
export function databaseUrlToPath(url: string): string {
  return url.replace(/^file:/, "");
}

function makeStore(url: string): DataStore {
  return new DataStore(openLibsql(databaseUrlToPath(url)));
}

let currentDbUrl = REAL_DB_URL;
let currentStore: DataStore = makeStore(REAL_DB_URL);
if (isProd) dbLog("Data layer initialized (libsql)");

/** The store the API is talking to right now (real or sandbox). */
export function getStore(): DataStore {
  return currentStore;
}

/** `file:` URL of the real database — the one Sandbox copies and restores. */
export function getRealDatabaseUrl(): string {
  return REAL_DB_URL;
}

/** `file:` URL of the database currently in use. */
export function getCurrentDatabaseUrl(): string {
  return currentDbUrl;
}

/**
 * Point the API at another SQLite file. The current store is closed first so
 * its file handle is released (Windows won't let the sandbox file be deleted
 * or the real file be overwritten while a handle is open), then
 * `beforeConnect` may touch the files, and only then is the new store
 * created. The libsql backend opens its file lazily, on the first query, so
 * nothing holds the new file open until a route actually uses it.
 */
export async function switchDatabase(
  url: string,
  beforeConnect?: () => void,
): Promise<void> {
  await currentStore.close();
  beforeConnect?.();
  currentStore = makeStore(url);
  currentDbUrl = url;
}

/**
 * Raw-SQL escape hatch with the three PrismaClient methods the route tests
 * use to wipe tables and release the file. Application code uses
 * `getStore()`; this exists so main/api-server.routes.test.ts — the data
 * layer's behavioural contract — runs unchanged.
 */
export const prisma = {
  $queryRawUnsafe: <T = any>(sql: string): Promise<T> =>
    currentStore.raw(sql) as Promise<T>,
  $executeRawUnsafe: async (sql: string): Promise<number> => {
    await currentStore.raw(sql);
    return 0;
  },
  $disconnect: (): Promise<void> => currentStore.close(),
};
