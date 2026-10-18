// serve.ts — runs the app's real API server (main/api-server.ts) against the
// DEMO database instead of dev.db, without Electron.
//
//   npx tsx scripts/demo/serve.ts
//
// Pair it with the renderer (`next dev -p 8888` inside renderer/) and open
// http://localhost:8888 in any browser: that is the full app UI, talking to
// prisma/demo.db. The capture script (capture.mjs) drives it headlessly.
//
// It reuses the FINANCES_OS_TEST_DB_URL override that shared/prisma.ts already
// honors for the route tests, so no app code changes are needed and dev.db /
// PROD are never opened.
import path from "path";
import fs from "fs";

const demoDb = path.join(process.cwd(), "prisma", "demo.db");
if (!fs.existsSync(demoDb)) {
  console.error("prisma/demo.db not found. Run: node scripts/demo/create-db.mjs");
  process.exit(1);
}

// Must be set BEFORE the server (and thus shared/prisma.ts) is imported.
process.env.FINANCES_OS_TEST_DB_URL = `file:${demoDb.replace(/\\/g, "/")}`;

(async () => {
  const { startServer, API_PORT } = await import("../../main/api-server");
  startServer(API_PORT);
  console.log(`Demo API using ${process.env.FINANCES_OS_TEST_DB_URL}`);
})();
