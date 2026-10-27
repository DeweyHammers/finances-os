// server/index.ts — HOSTED MODE entry point (see plans/phone-app-and-sync.md).
//
// Runs the app's real API server (main/api-server.ts) without Electron AND
// serves the renderer's static export from the same origin, so a phone (or
// any browser) can open the whole app at one URL:
//
//   cd renderer && NEXT_PUBLIC_API_URL=/api NODE_ENV=production npx next build
//   npx tsx server/index.ts [--port 5870] [--static app] [--db prisma/demo.db]
//                           [--host 0.0.0.0] [--public-hosts 192.168.1.20:5870]
//
// Same origin means the UI's fetches go to "/api" (baked in at build time via
// NEXT_PUBLIC_API_URL, read by renderer/lib/api-url.ts) and no CORS is needed.
//
// STATUS: spike. There is NO LOGIN yet, so this must only be bound to the
// loopback (the default) or a trusted private network, and only with a demo
// database. Phase 1 of the plan adds the session login before any real
// deployment.
import path from "path";
import fs from "fs";
import express from "express";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const port = Number(arg("port", "5870"));
const host = arg("host", "127.0.0.1")!;
const staticDir = path.resolve(process.cwd(), arg("static", "app")!);
const dbPath = arg("db");
const publicHosts = arg("public-hosts");

if (!Number.isInteger(port) || port <= 0) {
  console.error(`Invalid --port: ${arg("port")}`);
  process.exit(1);
}
if (!fs.existsSync(path.join(staticDir, "index.html"))) {
  console.error(
    `No static export at ${staticDir}. Build it first:\n` +
      `  cd renderer && NEXT_PUBLIC_API_URL=/api NODE_ENV=production npx next build`,
  );
  process.exit(1);
}

// Both must be set BEFORE the server (and thus shared/prisma.ts) is imported.
if (dbPath) {
  const abs = path.resolve(process.cwd(), dbPath);
  if (!fs.existsSync(abs)) {
    console.error(`Database not found: ${abs}`);
    process.exit(1);
  }
  // Reuses the override shared/prisma.ts already honors for tests and the
  // demo server; a proper FINANCES_OS_DB_PATH is Phase 1 work.
  process.env.FINANCES_OS_TEST_DB_URL = `file:${abs.replace(/\\/g, "/")}`;
}
if (publicHosts) process.env.FINANCES_OS_PUBLIC_HOSTS = publicHosts;
// Tells /api/meta (Settings page) that the app is served, not installed.
process.env.FINANCES_OS_MODE = "hosted";

(async () => {
  const { app, startServer } = await import("../main/api-server");

  // The export uses trailing slashes (/Overview/ → Overview/index.html), which
  // express.static serves as directory indexes; a slash-less /Overview is
  // redirected to /Overview/ by its default `redirect: true`.
  app.use(express.static(staticDir, { index: "index.html" }));

  // Anything else that isn't an API route gets Next's exported 404 page.
  const notFound = path.join(staticDir, "404.html");
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    if (fs.existsSync(notFound)) return res.status(404).sendFile(notFound);
    res.status(404).send("Not found");
  });

  startServer(port, host);
  console.log(
    `Hosted mode: UI from ${staticDir}` +
      (dbPath ? `, database ${dbPath}` : ", database = app default") +
      (publicHosts ? `, public hosts ${publicHosts}` : ""),
  );
})();
