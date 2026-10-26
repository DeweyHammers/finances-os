import { PrismaClient } from "@prisma/client";
import { app } from "electron";
import path from "path";
import fs from "fs";

// Declare global at the top to avoid ReferenceError in bundled code
const globalForPrisma = global as unknown as { prisma: PrismaClient };

const isProd = process.env.NODE_ENV === "production" || (app && app.isPackaged);

// In dev mode, use the local prisma folder. In prod, use userData.
let dbUrl = "file:./prisma/dev.db";

// Logger helper
const logFile = app
  ? path.join(app.getPath("userData"), "prisma-setup.log")
  : null;
function prismaLog(msg: string) {
  console.log(`[PrismaSetup] ${msg}`);
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
    prismaLog(
      `Database not found at ${dbPath}, attempting to copy template...`,
    );
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
        prismaLog("Database template copied from unpacked resources");
      } else if (fs.existsSync(templateDbPathInAsar)) {
        fs.copyFileSync(templateDbPathInAsar, dbPath);
        prismaLog("Database template copied from asar resources");
      } else {
        prismaLog(
          "CRITICAL: Database template not found in any expected location",
        );
      }
    } catch (e: any) {
      prismaLog(`Failed to copy database template: ${e.message}`);
    }
  } else {
    prismaLog(`Using existing database at ${dbPath}`);
  }
  // Use forward slashes for SQLite on Windows and ensure it's absolute
  const absoluteDbPath = path.resolve(dbPath);
  dbUrl = `file:${absoluteDbPath.replace(/\\/g, "/")}`;
  prismaLog(`Production Database URL: ${dbUrl}`);

  // Handle Query Engine path
  const enginePath = path.join(
    actualResourcesPath,
    "prisma/query_engine-windows.dll.node",
  );
  const fallbackEnginePath = path.join(
    actualResourcesPath,
    "app.asar.unpacked/node_modules/.prisma/client/query_engine-windows.dll.node",
  );

  if (fs.existsSync(enginePath)) {
    process.env.PRISMA_QUERY_ENGINE_LIBRARY = enginePath;
  } else if (fs.existsSync(fallbackEnginePath)) {
    process.env.PRISMA_QUERY_ENGINE_LIBRARY = fallbackEnginePath;
  }
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

// ── Swappable client (Sandbox mode, Oct 2026) ─────────────────────────────
// `dbUrl` above is the REAL database (dev.db in dev, %APPDATA%inances-os// database.db in PROD, or the test-only override). Sandbox mode (main/
// sandbox.ts) copies that file and points the API at the copy for a while, so
// the client the routes talk to has to be replaceable at runtime. Every
// consumer keeps importing `prisma` — it is a Proxy that forwards each access
// to whichever client is current, so no call site knows about the swap.

const REAL_DB_URL = dbUrl;

function makeClient(url: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url } } });
}

let currentDbUrl = REAL_DB_URL;
let currentClient: PrismaClient;

try {
  // Dev hot-reload keeps the real client on `global` so a renderer rebuild
  // doesn't leak a new connection each time. Only the real client is cached:
  // a sandbox client lives exactly as long as the sandbox.
  currentClient = globalForPrisma.prisma || makeClient(REAL_DB_URL);
  if (isProd) prismaLog("PrismaClient initialized successfully");
} catch (e: any) {
  prismaLog(`CRITICAL: PrismaClient failed to initialize: ${e.message}`);
  throw e;
}
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = currentClient;

/** The client the API is talking to right now (real or sandbox). */
export function getClient(): PrismaClient {
  return currentClient;
}

/** `file:` URL of the real database — the one Sandbox copies and restores. */
export function getRealDatabaseUrl(): string {
  return REAL_DB_URL;
}

/** `file:` URL of the database currently in use. */
export function getCurrentDatabaseUrl(): string {
  return currentDbUrl;
}

/** Filesystem path behind a Prisma SQLite `file:` URL. */
export function databaseUrlToPath(url: string): string {
  return url.replace(/^file:/, "");
}

/**
 * Point the API at another SQLite file. The previous client is disconnected
 * first so its file handle is released (Windows won't let the sandbox file be
 * deleted or the real file be overwritten while a handle is open), then
 * `beforeConnect` may touch the files, and only then is the new client
 * created. Prisma connects lazily, on the first query, so nothing holds the
 * new file open until a route actually uses it.
 */
export async function switchDatabase(
  url: string,
  beforeConnect?: () => void,
): Promise<void> {
  const previous = currentClient;
  await previous.$disconnect();
  beforeConnect?.();
  currentClient = makeClient(url);
  currentDbUrl = url;
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = currentClient;
}

/**
 * The client every route and test uses. A Proxy over `getClient()` so the
 * import stays a plain `prisma.bill.findMany(...)` while Sandbox swaps the
 * target underneath. Functions are bound to the live client because Prisma's
 * `$transaction` / `$queryRaw` read `this`.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = currentClient as any;
    const value = client[prop];
    return typeof value === "function" ? value.bind(client) : value;
  },
  has(_target, prop) {
    return prop in (currentClient as any);
  },
  ownKeys() {
    return Reflect.ownKeys(currentClient as any);
  },
  getOwnPropertyDescriptor(_target, prop) {
    const desc = Reflect.getOwnPropertyDescriptor(currentClient as any, prop);
    return desc ? { ...desc, configurable: true } : undefined;
  },
});

export function getModel(resource: string) {
  const client = currentClient as any;
  const modelName = resource.charAt(0).toLowerCase() + resource.slice(1);
  let model = client[modelName];

  if (!model) {
    const keys = Object.keys(client);
    const match = keys.find(
      (key) => key.toLowerCase() === resource.toLowerCase(),
    );
    if (match) model = client[match];
  }
  return model;
}
