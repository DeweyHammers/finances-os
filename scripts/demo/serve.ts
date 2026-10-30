// serve.ts — runs the app's real API server (main/api-server.ts) against the
// DEMO database instead of dev.db, without Electron.
//
//   npx tsx scripts/demo/serve.ts
//
// Pair it with the renderer (`next dev -p 8888` inside renderer/) and open
// http://localhost:8888 in any browser: that is the full app UI, talking to
// prisma/demo/demo.db. The tour script (tour.mjs) drives it headlessly.
//
// It reuses the FINANCES_OS_TEST_DB_URL override that shared/prisma.ts already
// honors for the route tests, so no app code changes are needed and dev.db /
// PROD are never opened.
import path from "path";
import fs from "fs";

const demoDb = path.join(process.cwd(), "prisma", "demo", "demo.db");
if (!fs.existsSync(demoDb)) {
  console.error("prisma/demo/demo.db not found. Run: node scripts/demo/create-db.mjs");
  process.exit(1);
}

// Must be set BEFORE the server (and thus shared/prisma.ts) is imported.
process.env.FINANCES_OS_TEST_DB_URL = `file:${demoDb.replace(/\\/g, "/")}`;
// The tour's pictures stand for the installed app, so Settings should say
// "Installed app", not "Development" (main/meta.ts → getAppMode). Nothing
// else reads the mode.
process.env.FINANCES_OS_MODE ??= "electron";

// `--port N` (or DEMO_API_PORT) runs the demo API on another port, e.g. while
// the installed app still owns 5858. Point the renderer at it with
// NEXT_PUBLIC_API_URL=http://127.0.0.1:N/api (see renderer/lib/api-url.ts).
const portArgIndex = process.argv.indexOf("--port");
const portArg = portArgIndex >= 0 ? process.argv[portArgIndex + 1] : process.env.DEMO_API_PORT;

(async () => {
  const { startServer, API_PORT } = await import("../../main/api-server");
  const { initSync } = await import("../../main/sync");
  const port = portArg ? Number(portArg) : API_PORT;
  if (!Number.isInteger(port) || port <= 0) {
    console.error(`Invalid port: ${portArg}`);
    process.exit(1);
  }
  // Same startup as the app: a saved sync setup (prisma/demo/sync.json,
  // written by the tour's sync step against the mock cloud) reopens the
  // local copy before the first request. No safeStorage here, so a token
  // saved through this server is stored in plain text (see
  // main/sync-settings.ts); "Forget this device" removes it — the tour does
  // that itself when it ends.
  await initSync();
  startServer(port);
  console.log(`Demo API using ${process.env.FINANCES_OS_TEST_DB_URL}`);
})();
