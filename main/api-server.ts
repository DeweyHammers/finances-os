import express, { Request, Response, NextFunction } from "express";
import { getStore } from "../shared/db";
import { transformBody } from "../shared/data";
import {
  BackupError,
  checkForUpdates,
  createBackup,
  getAppMeta,
  listBackups,
} from "./meta";
import {
  SandboxError,
  discardSandbox,
  enterSandbox,
  getSandboxStatus,
  keepSandbox,
} from "./sandbox";

// ── Network exposure ──
// This server fronts the whole finance database with no auth, so it must only
// be reachable by the app's own renderer:
//   1. It listens on the IPv4 loopback only (see startServer) — never on the
//      LAN. The renderer calls http://127.0.0.1:5858 explicitly (providers.tsx)
//      so `localhost` resolving to ::1 can't miss the listener.
//   2. Browser requests must come from an allowed Origin (isAllowedOrigin).
//      CORS headers alone aren't enough: a random website could still fire
//      "simple" POSTs blind, so disallowed origins get a 403 before any route.
//   3. The Host header must name the loopback (isAllowedHost) — blocks DNS
//      rebinding, where a hostile domain re-resolves to 127.0.0.1 and reads
//      data with same-origin GETs (which carry no Origin header).
// Requests with NO Origin header (curl, scripts, same-origin GETs) are allowed:
// they can only come from this machine since we're bound to loopback.
export const API_HOST = "127.0.0.1";
export const API_PORT = 5858;

/**
 * Origins allowed to call the API from a browser context.
 *  - `app://…` — the PROD renderer, served by electron-serve on the privileged
 *    `app` scheme (main.ts loads `app://./`, serialized origin `app://.`).
 *  - `http://localhost:<port>` / `http://127.0.0.1:<port>` — the Nextron dev
 *    renderer (`next dev`, port 8888 by default but overridable via argv).
 *    Only honored outside production.
 */
export function isAllowedOrigin(origin: string, isProd: boolean): boolean {
  if (origin.startsWith("app://")) return true;
  if (!isProd && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return true;
  // Hosted mode (server/index.ts): the UI is served from the same origin as
  // the API, so its requests carry that origin. Only the hosts the operator
  // listed are accepted; https only once NODE_ENV=production.
  for (const host of publicHosts()) {
    if (origin === `https://${host}`) return true;
    if (!isProd && origin === `http://${host}`) return true;
  }
  return false;
}

/**
 * Hosts (host or host:port, exact match) the server may be reached as when it
 * runs in hosted mode — set by server/index.ts from FINANCES_OS_PUBLIC_HOSTS.
 * Empty in the Electron app, where only the loopback is ever allowed.
 */
export function publicHosts(): string[] {
  return (process.env.FINANCES_OS_PUBLIC_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Port the server is actually listening on. `startServer(port)` records it so
 * the Host check below matches a non-default port (the demo server can run on
 * another port while the installed app owns 5858); until then it is API_PORT.
 */
let listeningPort = API_PORT;

/** Host header must point at the loopback listener (DNS-rebinding guard). */
export function isAllowedHost(host: string | undefined, port = listeningPort): boolean {
  if (!host) return false;
  if (host === `${API_HOST}:${port}` || host === `localhost:${port}`) return true;
  return publicHosts().includes(host.toLowerCase());
}

// Exported so server/index.ts (hosted mode) can mount the renderer's static
// export on the same Express app. The Electron app never touches it directly.
export const app = express();
app.use(express.json());

// Origin / Host gate + CORS. Runs before every route (and before preflight
// handling), so a rejected caller never reaches the database.
app.use((req: Request, res: Response, next: NextFunction) => {
  const isProd = process.env.NODE_ENV === "production";
  const origin = req.headers.origin;

  if (!isAllowedHost(req.headers.host)) {
    res.status(403).json({ error: "Forbidden host" });
    return;
  }
  if (origin !== undefined && !isAllowedOrigin(origin, isProd)) {
    res.status(403).json({ error: "Forbidden origin" });
    return;
  }

  // Echo the (allowed) origin back instead of "*", and tell caches the
  // response varies by Origin.
  if (origin !== undefined) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
  }
  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  );
  res.header("Access-Control-Allow-Headers", "Content-Type, x-total-count");
  res.header("Access-Control-Expose-Headers", "x-total-count");
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
});

// Body normalisation moved to shared/data/coerce.ts (the data layer applies
// it itself); re-exported so main/api-server.test.ts keeps its import.
export { transformBody };

// ── Data layer ───────────────────────────────────────────────────────────────
// Every /api/:resource route is a thin HTTP wrapper over shared/data (the
// DataStore behind getStore(), on whichever file is current — real or
// sandbox). The rules that used to live here — Income's single primary, the
// AppSettings/global upsert, the BudgetCategoryItem delete snapshot — are the
// store's now, so the phone app gets them too. Status codes are unchanged:
// 404 for an unknown resource or a missing row on GET, 500 for everything
// the Prisma client used to throw (bad values, missing rows on PATCH/DELETE,
// unique-constraint violations).
function failed(req: Request, res: Response, error: any, withDetails = false) {
  console.error(`API Error on ${req.method} ${req.url}:`, error);
  res.status(500).json(
    withDetails
      ? { error: error.message, stack: error.stack, details: error }
      : { error: error.message },
  );
}
// ─────────────────────────────────────────────────────────────────────────────

// ── App meta for the Settings page (main/meta.ts) ────────────────────────────
// Registered BEFORE /api/:resource so "meta" and "backups" are never treated
// as model names.
app.get("/api/meta", (_req: Request, res: Response) => {
  res.json(getAppMeta());
});

app.get("/api/meta/updates", async (_req: Request, res: Response) => {
  try {
    res.json(await checkForUpdates());
  } catch (error: any) {
    res.status(502).json({ error: `Could not check GitHub: ${error.message}` });
  }
});

app.get("/api/backups", (_req: Request, res: Response) => {
  res.json(listBackups());
});

app.post("/api/backups", async (_req: Request, res: Response) => {
  try {
    res.json(await createBackup());
  } catch (error: any) {
    const status = error instanceof BackupError ? error.status : 500;
    if (status === 500) console.error("API Error POST /api/backups:", error);
    res.status(status).json({ error: error.message });
  }
});

// ── Sandbox: try changes on a copy of the database (main/sandbox.ts) ─────────
// Registered BEFORE the generic /api/:resource routes, which would otherwise
// treat "sandbox" as a model name and 404.
app.get("/api/sandbox", async (_req: Request, res: Response) => {
  try {
    res.json(await getSandboxStatus());
  } catch (error: any) {
    console.error("API Error GET /api/sandbox:", error);
    res.status(500).json({ error: error.message });
  }
});

const sandboxActions = {
  enter: enterSandbox,
  discard: discardSandbox,
  keep: keepSandbox,
} as const;

app.post("/api/sandbox/:action", async (req: Request, res: Response) => {
  const action = req.params.action as keyof typeof sandboxActions;
  const run = sandboxActions[action];
  if (!run) {
    res.status(404).json({ error: `Unknown sandbox action ${String(action)}` });
    return;
  }
  try {
    res.json(await run());
  } catch (error: any) {
    // A wrong-state call (enter twice, discard when inactive) is the caller's
    // mistake, not a server failure.
    const status = error instanceof SandboxError ? 409 : 500;
    console.error(`API Error POST /api/sandbox/${action}:`, error);
    res.status(status).json({ error: error.message });
  }
});
// ─────────────────────────────────────────────────────────────────────────────

// List & Create
app.get("/api/:resource", async (req: Request, res: Response) => {
  const resource = req.params.resource as string;
  const model = getStore().resolveResource(resource);
  if (!model) {
    res.status(404).json({ error: `Model ${resource} not found` });
    return;
  }

  try {
    // The query object is passed through as-is: `field=value` filters,
    // `field_like=`, `_sort` / `_order` (and the ignored `_start`, `_end`,
    // `q`) are interpreted by the store (shared/data/store.ts → list).
    const { items, total } = await getStore().list(model, req.query as any);
    res.header("x-total-count", total.toString());
    res.json(items);
  } catch (error: any) {
    failed(req, res, error);
  }
});

app.post("/api/:resource", async (req: Request, res: Response) => {
  const resource = req.params.resource as string;
  console.log(`POST /api/${resource} - Body:`, JSON.stringify(req.body));
  const model = getStore().resolveResource(resource);
  if (!model) {
    res.status(404).json({ error: `Model ${resource} not found` });
    return;
  }

  try {
    // The store normalises the body, drops a client-sent id and the legacy
    // relation keys, fills defaults and applies the Income primary rule.
    const item = await getStore().create(model, req.body ?? {});
    res.json(item);
  } catch (error: any) {
    failed(req, res, error, true);
  }
});

// Show, Update, Delete
app.get("/api/:resource/:id", async (req: Request, res: Response) => {
  const resource = req.params.resource as string;
  const id = req.params.id as string;
  const model = getStore().resolveResource(resource);
  if (!model) {
    res.status(404).json({ error: `Model ${resource} not found` });
    return;
  }

  try {
    const item = await getStore().getOne(model, id);
    if (!item) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(item);
  } catch (error: any) {
    failed(req, res, error);
  }
});

app.patch("/api/:resource/:id", async (req: Request, res: Response) => {
  const resource = req.params.resource as string;
  const id = req.params.id as string;
  console.log(`PATCH /api/${resource}/${id} - Body:`, JSON.stringify(req.body));
  const model = getStore().resolveResource(resource);
  if (!model) {
    res.status(404).json({ error: `Model ${resource} not found` });
    return;
  }

  try {
    // The URL id wins over a body id. `AppSettings/global` is created on its
    // first save (a brand-new database has no settings row yet); every other
    // missing row is a 500, as under Prisma.
    const item = await getStore().update(model, id, req.body ?? {});
    res.json(item);
  } catch (error: any) {
    failed(req, res, error, true);
  }
});

app.delete("/api/:resource/:id", async (req: Request, res: Response) => {
  const resource = req.params.resource as string;
  const id = req.params.id as string;
  const model = getStore().resolveResource(resource);
  if (!model) {
    res.status(404).json({ error: `Model ${resource} not found` });
    return;
  }

  try {
    // BudgetCategoryItem: the store snapshots the item's name onto its
    // transactions first, so the historical category stays visible.
    await getStore().remove(model, id);
    res.json({ success: true });
  } catch (error: any) {
    failed(req, res, error);
  }
});

export function startServer(port = API_PORT, host = API_HOST) {
  // Port 0 = "any free port" (the route tests). Those callers keep sending
  // Host 127.0.0.1:5858, so the check stays on API_PORT for them.
  if (port > 0) listeningPort = port;
  // Loopback only by default — see "Network exposure" at the top of this
  // file. Only server/index.ts (hosted mode, behind its own login) passes
  // another bind address; the Electron app never does.
  return app.listen(port, host, () => {
    console.log(`API Server running on http://${host}:${port}`);
  });
}
