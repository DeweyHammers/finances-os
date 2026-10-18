// @vitest-environment node
/**
 * API server — route tests against a REAL SQLite database (a throwaway copy).
 *
 * Every save in the app goes through these routes, so they pin today's
 * behavior: CRUD shape, numeric coercion, list filters/sorting/x-total-count,
 * the Income single-primary rule, the category-delete name snapshot, and the
 * loopback/Origin/Host gate.
 *
 * Safety: shared/prisma.ts reads FINANCES_OS_TEST_DB_URL (test-only) before
 * falling back to prisma/dev.db. We copy dev.db's SCHEMA to a temp file, wipe
 * every row, and set that env var BEFORE importing the server, so these tests
 * can never read or write the real dev database.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import type { Server } from "http";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "finances-os-api-test-"));
const tmpDb = path.join(tmpDir, "test.db");

let server: Server;
let prisma: any;
// Every request must look like it came from the app's own renderer.
const HOST = "127.0.0.1:5858";
const APP_ORIGIN = "http://localhost:8888";

// Wraps supertest so each call carries the loopback Host header (the server
// listens on a random port here, but only accepts Host 127.0.0.1:5858).
const api = () => {
  const agent = request(server);
  return {
    get: (url: string) => agent.get(url).set("Host", HOST),
    post: (url: string) => agent.post(url).set("Host", HOST),
    patch: (url: string) => agent.patch(url).set("Host", HOST),
    delete: (url: string) => agent.delete(url).set("Host", HOST),
  };
};

beforeAll(async () => {
  // Schema-accurate empty DB: copy dev.db, then delete every row below.
  fs.copyFileSync(path.join(process.cwd(), "prisma/dev.db"), tmpDb);
  process.env.FINANCES_OS_TEST_DB_URL = `file:${tmpDb.replace(/\\/g, "/")}`;

  const mod = await import("./api-server");
  ({ prisma } = await import("../shared/prisma"));
  server = mod.startServer(0); // random free port on 127.0.0.1
});

afterAll(async () => {
  server?.close();
  await prisma?.$disconnect();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Fresh, empty tables for every test.
beforeEach(async () => {
  const tables: { name: string }[] = await prisma.$queryRawUnsafe(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'",
  );
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
  for (const t of tables) await prisma.$executeRawUnsafe(`DELETE FROM "${t.name}"`);
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
});

describe("test database isolation", () => {
  it("is pointed at the temp copy, not dev.db", () => {
    expect(process.env.FINANCES_OS_TEST_DB_URL).toContain("finances-os-api-test-");
  });
});

describe("generic CRUD (/api/:resource)", () => {
  it("create → list → show → update → delete a Bill", async () => {
    // Form-style string values are coerced for known numeric fields.
    const created = await api().post("/api/Bill").send({ name: "Sample Streaming", amount: "12.50", dueDate: "15" });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ name: "Sample Streaming", amount: 12.5, dueDate: 15, isAutoPay: true, neverSplit: false });
    const id = created.body.id;

    const list = await api().get("/api/Bill");
    expect(list.status).toBe(200);
    expect(list.headers["x-total-count"]).toBe("1");
    expect(list.body.map((b: any) => b.id)).toEqual([id]);

    const shown = await api().get(`/api/Bill/${id}`);
    expect(shown.body).toMatchObject({ id, name: "Sample Streaming" });

    // `id` in the body is ignored on PATCH; the URL id wins.
    const updated = await api().patch(`/api/Bill/${id}`).send({ id: "hijack", amount: 29.99 });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ id, amount: 29.99 });

    const deleted = await api().delete(`/api/Bill/${id}`);
    expect(deleted.body).toEqual({ success: true });
    expect((await api().get(`/api/Bill/${id}`)).status).toBe(404);
  });

  it("ignores a client-sent id on create", async () => {
    const res = await api().post("/api/Payee").send({ id: "chosen-by-client", name: "Corner Market" });
    expect(res.status).toBe(200);
    expect(res.body.id).not.toBe("chosen-by-client");
  });

  it("filters by field, *_like, and sorts with _sort/_order", async () => {
    for (const [name, dueDate] of [["Zeta", 25], ["Sample Alpha", 3], ["Sample Beta", 12]] as const) {
      await api().post("/api/Bill").send({ name, amount: 10, dueDate });
    }
    const sorted = await api().get("/api/Bill?_sort=dueDate&_order=desc");
    expect(sorted.body.map((b: any) => b.name)).toEqual(["Zeta", "Sample Beta", "Sample Alpha"]);

    const like = await api().get("/api/Bill?name_like=Alph");
    expect(like.body.map((b: any) => b.name).sort()).toEqual(["Sample Alpha"]);
    expect(like.headers["x-total-count"]).toBe("1");

    // Pagination params are accepted but not applied (the app lists with mode "off").
    const paged = await api().get("/api/Bill?_start=0&_end=1&name=Sample%20Beta");
    expect(paged.body.map((b: any) => b.name)).toEqual(["Sample Beta"]);
  });

  it("filters BillSplit rows by monthKey", async () => {
    const bill = (await api().post("/api/Bill").send({ name: "Sample Loan", amount: 100, dueDate: 1 })).body;
    await api().post("/api/BillSplit").send({ billId: bill.id, monthKey: "2026-10", weekIndex: 0, amountCents: 6000, occurrenceCoord: 32 });
    await api().post("/api/BillSplit").send({ billId: bill.id, monthKey: "2026-11", weekIndex: 1, amountCents: 100, occurrenceCoord: 31 });
    const oct = await api().get("/api/BillSplit?monthKey=2026-10");
    expect(oct.body).toHaveLength(1);
    expect(oct.body[0]).toMatchObject({ monthKey: "2026-10", amountCents: 6000, occurrenceCoord: 32 });
  });

  it("rejects a duplicate BillSplit key with a 500 (the unique constraint)", async () => {
    const bill = (await api().post("/api/Bill").send({ name: "Sample Insurance", amount: 90, dueDate: 31 })).body;
    const row = { billId: bill.id, monthKey: "2026-10", weekIndex: 0, amountCents: 3000, occurrenceCoord: 31 };
    expect((await api().post("/api/BillSplit").send(row)).status).toBe(200);
    expect((await api().post("/api/BillSplit").send(row)).status).toBe(500);
  });

  it("404s an unknown resource or id", async () => {
    expect((await api().get("/api/NotAModel")).status).toBe(404);
    expect((await api().get("/api/Bill/does-not-exist")).status).toBe(404);
  });

  it("parses date-only strings as UTC midnight", async () => {
    const acct = (await api().post("/api/Account").send({ name: "Checking" })).body;
    const txn = await api().post("/api/AccountTransaction").send({ accountId: acct.id, date: "2026-10-21", inflowCents: "70000", memo: "Income" });
    expect(txn.status).toBe(200);
    expect(txn.body.date).toBe("2026-10-21T00:00:00.000Z");
    expect(txn.body.inflowCents).toBe(70000);
  });
});

describe("Income single-primary rule", () => {
  it("creating or patching a primary income demotes the others", async () => {
    const a = (await api().post("/api/Income").send({ name: "Day job", amount: 700, isPrimary: true })).body;
    expect(a.isPrimary).toBe(true);

    const b = (await api().post("/api/Income").send({ name: "Side gig", amount: 100, isPrimary: "true" })).body;
    expect(b.isPrimary).toBe(true);
    expect((await api().get(`/api/Income/${a.id}`)).body.isPrimary).toBe(false);

    await api().patch(`/api/Income/${a.id}`).send({ isPrimary: true });
    expect((await api().get(`/api/Income/${a.id}`)).body.isPrimary).toBe(true);
    expect((await api().get(`/api/Income/${b.id}`)).body.isPrimary).toBe(false);
  });
});

describe("BudgetCategoryItem delete", () => {
  it("snapshots the item name onto its transactions before deleting", async () => {
    const group = (await api().post("/api/BudgetCategoryGroup").send({ name: "Checking" })).body;
    const item = (await api().post("/api/BudgetCategoryItem").send({ groupId: group.id, name: "Gas", sourceType: "CUSTOM" })).body;
    const acct = (await api().post("/api/Account").send({ name: "Checking" })).body;
    const txn = (await api().post("/api/AccountTransaction").send({ accountId: acct.id, categoryItemId: item.id, outflowCents: 4500 })).body;

    expect((await api().delete(`/api/BudgetCategoryItem/${item.id}`)).body).toEqual({ success: true });
    const after = (await api().get(`/api/AccountTransaction/${txn.id}`)).body;
    expect(after.categoryItemId).toBeNull(); // relation severed (onDelete: SetNull)
    expect(after.categoryName).toBe("Gas"); // history keeps the label
  });
});

describe("network gate (real HTTP)", () => {
  it("serves the app's renderer and local tools", async () => {
    expect((await api().get("/api/Bill")).status).toBe(200); // no Origin
    const dev = await api().get("/api/Bill").set("Origin", APP_ORIGIN);
    expect(dev.status).toBe(200);
    expect(dev.headers["access-control-allow-origin"]).toBe(APP_ORIGIN);
    expect(dev.headers["vary"]).toContain("Origin");
  });

  it("answers the app's CORS preflight", async () => {
    const res = await request(server)
      .options("/api/Bill/x")
      .set("Host", HOST)
      .set("Origin", APP_ORIGIN)
      .set("Access-Control-Request-Method", "PATCH");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-methods"]).toContain("PATCH");
  });

  it("403s foreign origins before touching the DB", async () => {
    const res = await api().post("/api/Payee").set("Origin", "https://evil.example").send({ name: "x" });
    expect(res.status).toBe(403);
    expect((await api().get("/api/Payee")).body).toEqual([]);
  });

  it("403s a rebinding Host header", async () => {
    const res = await request(server).get("/api/Bill").set("Host", "evil.example:5858");
    expect(res.status).toBe(403);
  });
});
