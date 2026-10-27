import express, { Request, Response, NextFunction } from "express";
import { getModel, prisma } from "../shared/prisma";
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
// handling), so a rejected caller never reaches Prisma.
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

export function transformBody(body: any) {
  const transformed = { ...body };
  Object.keys(transformed).forEach((key) => {
    const value = transformed[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        transformed[key] = new Date(`${trimmed}T00:00:00Z`);
      } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
        transformed[key] = new Date(`${trimmed}:00Z`);
      } else if (
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(trimmed)
      ) {
        transformed[key] = new Date(trimmed);
      } else if (
        (trimmed !== "" &&
          !isNaN(Number(trimmed)) &&
          !trimmed.startsWith("0")) ||
        trimmed === "0"
      ) {
        // Only convert to number if it's a valid number and doesn't have leading zeros (unless it's just "0")
        // This avoids converting IDs that might be numeric strings
        if (
          key === "amount" ||
          key === "dueDate" ||
          key === "grossPay" ||
          key === "netPay" ||
          key === "hours" ||
          key === "weeklyHours" ||
          key === "month" ||
          key === "day" ||
          key === "inflowCents" ||
          key === "outflowCents" ||
          key === "customAmountCents" ||
          key === "assignedCents" ||
          key === "sortOrder" ||
          key === "payDay" ||
          key === "payWeekOffset" ||
          key === "weekOfMonth"
        ) {
          const num = Number(trimmed);
          if (!isNaN(num)) {
            transformed[key] = num;
          }
        } else {
          transformed[key] = trimmed;
        }
      } else {
        transformed[key] = trimmed;
      }
    }
  });
  return transformed;
}

// ── Income: special routes to enforce single-primary constraint ──────────────
app.post("/api/Income", async (req: Request, res: Response) => {
  const data = transformBody(req.body);
  const { id: _id, ...createData } = data;
  const isPrimary = createData.isPrimary === true || createData.isPrimary === "true";
  try {
    const item = await prisma.$transaction(async (tx) => {
      if (isPrimary) {
        await tx.income.updateMany({ where: {}, data: { isPrimary: false } });
      }
      return tx.income.create({ data: { ...createData, isPrimary } });
    });
    res.json(item);
  } catch (error: any) {
    console.error("API Error POST /api/Income:", error);
    res.status(500).json({ error: error.message });
  }
});

app.patch("/api/Income/:id", async (req: Request, res: Response) => {
  const id = req.params.id;
  const data = transformBody(req.body);
  const { id: _id, ...updateData } = data;
  const isPrimary = updateData.isPrimary === true || updateData.isPrimary === "true";
  try {
    const item = await prisma.$transaction(async (tx) => {
      if (isPrimary) {
        await tx.income.updateMany({ where: { id: { not: id } }, data: { isPrimary: false } });
      }
      return tx.income.update({ where: { id }, data: { ...updateData, isPrimary } });
    });
    res.json(item);
  } catch (error: any) {
    console.error(`API Error PATCH /api/Income/${id}:`, error);
    res.status(500).json({ error: error.message });
  }
});
// ─────────────────────────────────────────────────────────────────────────────

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
  const searchParams = req.query as any;

  const model = getModel(resource);
  if (!model) {
    res.status(404).json({ error: `Model ${resource} not found` });
    return;
  }

  try {
    const queryOptions: any = { where: {} };

  
    Object.keys(searchParams).forEach((key) => {
      const value = searchParams[key];
      if (["_sort", "_order", "_start", "_end", "q"].includes(key)) return;

      if (key.endsWith("_like")) {
        const fieldName = key.slice(0, -5);
        queryOptions.where[fieldName] = { contains: value };
      } else {
        queryOptions.where[key] = value;
      }
    });

    if (searchParams._sort) {
      const sortStr = searchParams._sort.toString();
      const fields = sortStr.split(",");
      const order = (searchParams._order || "asc").toString().toLowerCase();
      queryOptions.orderBy = fields.map((f: string) => ({ [f.trim()]: order }));
    }

    const items = await model.findMany(queryOptions);
    const count = await model.count({ where: queryOptions.where });

    res.header("x-total-count", count.toString());
    res.json(items);
  } catch (error: any) {
    console.error(`API Error on ${req.method} ${req.url}:`, error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/:resource", async (req: Request, res: Response) => {
  const resource = req.params.resource as string;
  console.log(`POST /api/${resource} - Body:`, JSON.stringify(req.body));
  const data = transformBody(req.body);
  const model = getModel(resource);
  if (!model) {
    res.status(404).json({ error: `Model ${resource} not found` });
    return;
  }

  const { client, contracts, id, ...createData } = data;

  // Strip fields that don't exist in certain models but might be sent by the frontend
  console.log(`Creating ${resource} with data:`, JSON.stringify(createData));

  try {
    const item = await model.create({ data: createData });
    res.json(item);
  } catch (error: any) {
    console.error(`API Error on ${req.method} ${req.url}:`, error);
    res.status(500).json({
      error: error.message,
      stack: error.stack,
      details: error,
    });
  }
});

// Show, Update, Delete
app.get("/api/:resource/:id", async (req: Request, res: Response) => {
  const resource = req.params.resource as string;
  const id = req.params.id as string;
  const model = getModel(resource);
  if (!model) {
    res.status(404).json({ error: `Model ${resource} not found` });
    return;
  }

  try {
    const queryOptions: any = { where: { id } };

    const item = await model.findUnique(queryOptions);
    if (!item) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(item);
  } catch (error: any) {
    console.error(`API Error on ${req.method} ${req.url}:`, error);
    res.status(500).json({ error: error.message });
  }
});

app.patch("/api/:resource/:id", async (req: Request, res: Response) => {
  const resource = req.params.resource as string;
  const id = req.params.id as string;
  console.log(`PATCH /api/${resource}/${id} - Body:`, JSON.stringify(req.body));
  const data = transformBody(req.body);
  const model = getModel(resource);
  if (!model) {
    res.status(404).json({ error: `Model ${resource} not found` });
    return;
  }

  const { client, contracts, entries, id: _id, ...updateData } = data;

  try {
    // The singleton settings row (`AppSettings/global`) doesn't exist in a
    // brand-new, empty database, so a plain update() 500'd on the first save
    // (Surplus Target, payday, the Optimize baseline). Create it on first write
    // instead; the schema defaults fill every other column. Reads are left
    // alone: GET still 404s until something is saved, and the renderer keeps
    // its existing "no settings yet" fallbacks.
    if (resource.toLowerCase() === "appsettings" && id === "global") {
      const item = await prisma.appSettings.upsert({
        where: { id },
        update: updateData,
        create: { ...updateData, id },
      });
      res.json(item);
      return;
    }

    const item = await model.update({ where: { id }, data: updateData });
    res.json(item);
  } catch (error: any) {
    console.error(`API Error on ${req.method} ${req.url}:`, error);
    res.status(500).json({
      error: error.message,
      stack: error.stack,
      details: error,
    });
  }
});

app.delete("/api/:resource/:id", async (req: Request, res: Response) => {
  const resource = req.params.resource as string;
  const id = req.params.id as string;
  const model = getModel(resource);
  if (!model) {
    res.status(404).json({ error: `Model ${resource} not found` });
    return;
  }

  try {
    if (resource === "BudgetCategoryItem") {
      // Snapshot the item's name onto every transaction that referenced it
      // so the historical category stays visible after the relation is severed.
      const item = await prisma.budgetCategoryItem.findUnique({
        where: { id },
        select: { name: true },
      });
      if (item) {
        await prisma.accountTransaction.updateMany({
          where: { categoryItemId: id },
          data: { categoryName: item.name },
        });
      }
    }

    await model.delete({ where: { id } });
    res.json({ success: true });
  } catch (error: any) {
    console.error(`API Error on ${req.method} ${req.url}:`, error);
    res.status(500).json({ error: error.message });
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
