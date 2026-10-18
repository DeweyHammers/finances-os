import express, { Request, Response, NextFunction } from "express";
import { getModel, prisma } from "../shared/prisma";

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
  return false;
}

/** Host header must point at the loopback listener (DNS-rebinding guard). */
export function isAllowedHost(host: string | undefined): boolean {
  if (!host) return false;
  return host === `${API_HOST}:${API_PORT}` || host === `localhost:${API_PORT}`;
}

const app = express();
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

export function startServer(port = API_PORT) {
  // Loopback only — see "Network exposure" at the top of this file. Without
  // the host argument Express listens on every interface (LAN-reachable).
  return app.listen(port, API_HOST, () => {
    console.log(`API Server running on http://${API_HOST}:${port}`);
  });
}
