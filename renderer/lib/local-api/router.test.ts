// @vitest-environment node
/**
 * The Android app's in-process API, pinned the way main/api-server.routes.test.ts
 * pins the desktop: the same scenarios (CRUD shape, coercion, filters +
 * sorting + total count, the AppSettings upsert, the Income rule, the
 * category-delete snapshot, the status codes) run against LocalApi with a
 * supertest-shaped helper, so the phone can never answer differently from
 * the server. Then the phone-only answers (meta, sandbox, sync, backups,
 * updates) and the @refinedev/simple-rest provider over the in-process client.
 *
 * The store runs on the desktop libsql backend here (the Capacitor executor
 * has its own test on a fake plugin); no Android, no network.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import dataProvider from "@refinedev/simple-rest";
import { DataStore } from "../../../shared/data";
import { openLibsql } from "../../../shared/data/backends/libsql";
import type { AppMeta } from "../meta-api";
import { LocalApi, NOT_ON_PHONE, PHONE_MESSAGES } from "./router";
import { createLocalHttpClient } from "./index";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "finances-os-local-api-test-"));
const BASE = "http://127.0.0.1:5858/api";

const meta: AppMeta = {
  version: "1.3.2",
  mode: "android",
  platform: "android",
  databasePath: "finances-osSQLite.db (this app's private storage)",
  repoUrl: "https://github.com/DeweyHammers/finances-os",
  releasesUrl: "https://github.com/DeweyHammers/finances-os/releases",
  issuesUrl: "https://github.com/DeweyHammers/finances-os/issues",
  docsUrl: "https://deweyhammers.github.io/finances-os/",
};

let store: DataStore;
let local: LocalApi;
let githubAnswer: () => Promise<Response>;

beforeAll(async () => {
  store = new DataStore(openLibsql(path.join(tmpDir, "phone.db")));
  local = new LocalApi({
    store: async () => store,
    meta: () => meta,
    fetchImpl: (() => githubAnswer()) as unknown as typeof fetch,
  });
});

afterAll(async () => {
  await store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Fresh, empty tables for every test (same wipe as the route tests).
beforeEach(async () => {
  const tables = (await store.raw("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")) as {
    name: string;
  }[];
  await store.raw("PRAGMA foreign_keys = OFF");
  for (const t of tables) await store.raw(`DELETE FROM "${t.name}"`);
  await store.raw("PRAGMA foreign_keys = ON");
});

interface Answer {
  status: number;
  body: any;
  headers: Record<string, string>;
}

/** supertest's shape over LocalApi: `await api().get(url)` / `api().post(url).send(body)`. */
function api() {
  const call = (method: string, url: string) => {
    const go = (body?: unknown): Promise<Answer> =>
      local.handle(method, `${BASE}${url}`, body).then((r) => ({ status: r.status, body: r.body, headers: r.headers }));
    return {
      send: (body: unknown) => go(body),
      then: <T>(onOk: (a: Answer) => T, onErr?: (e: unknown) => T) => go().then(onOk, onErr),
    };
  };
  return {
    get: (url: string) => call("GET", url),
    post: (url: string) => call("POST", url),
    patch: (url: string) => call("PATCH", url),
    delete: (url: string) => call("DELETE", url),
  };
}

// ── The route tests' scenarios ──────────────────────────────────────────────

describe("generic CRUD (/api/:resource)", () => {
  it("create → list → show → update → delete a Bill", async () => {
    const created = await api().post("/Bill").send({ name: "Sample Streaming", amount: "12.50", dueDate: "15" });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ name: "Sample Streaming", amount: 12.5, dueDate: 15, isAutoPay: true, neverSplit: false });
    const id = created.body.id;

    const list = await api().get("/Bill");
    expect(list.status).toBe(200);
    expect(list.headers["x-total-count"]).toBe("1");
    expect(list.body.map((b: any) => b.id)).toEqual([id]);

    const shown = await api().get(`/Bill/${id}`);
    expect(shown.body).toMatchObject({ id, name: "Sample Streaming" });

    const updated = await api().patch(`/Bill/${id}`).send({ id: "hijack", amount: 29.99 });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ id, amount: 29.99 });

    const deleted = await api().delete(`/Bill/${id}`);
    expect(deleted.body).toEqual({ success: true });
    expect((await api().get(`/Bill/${id}`)).status).toBe(404);
  });

  it("ignores a client-sent id on create", async () => {
    const res = await api().post("/Payee").send({ id: "chosen-by-client", name: "Corner Market" });
    expect(res.status).toBe(200);
    expect(res.body.id).not.toBe("chosen-by-client");
  });

  it("filters by field, *_like, and sorts with _sort/_order", async () => {
    for (const [name, dueDate] of [["Zeta", 25], ["Sample Alpha", 3], ["Sample Beta", 12]] as const) {
      await api().post("/Bill").send({ name, amount: 10, dueDate });
    }
    const sorted = await api().get("/Bill?_sort=dueDate&_order=desc");
    expect(sorted.body.map((b: any) => b.name)).toEqual(["Zeta", "Sample Beta", "Sample Alpha"]);

    const like = await api().get("/Bill?name_like=Alph");
    expect(like.body.map((b: any) => b.name)).toEqual(["Sample Alpha"]);
    expect(like.headers["x-total-count"]).toBe("1");

    const paged = await api().get("/Bill?_start=0&_end=1&name=Sample%20Beta");
    expect(paged.body.map((b: any) => b.name)).toEqual(["Sample Beta"]);
  });

  it("filters BillSplit rows by monthKey", async () => {
    const bill = (await api().post("/Bill").send({ name: "Sample Loan", amount: 100, dueDate: 1 })).body;
    await api().post("/BillSplit").send({ billId: bill.id, monthKey: "2026-10", weekIndex: 0, amountCents: 6000, occurrenceCoord: 32 });
    await api().post("/BillSplit").send({ billId: bill.id, monthKey: "2026-11", weekIndex: 1, amountCents: 100, occurrenceCoord: 31 });
    const oct = await api().get("/BillSplit?monthKey=2026-10");
    expect(oct.body).toHaveLength(1);
    expect(oct.body[0]).toMatchObject({ monthKey: "2026-10", amountCents: 6000, occurrenceCoord: 32 });
  });

  it("rejects a duplicate BillSplit key with a 500 (the unique constraint) that carries the message", async () => {
    const bill = (await api().post("/Bill").send({ name: "Sample Insurance", amount: 90, dueDate: 31 })).body;
    const row = { billId: bill.id, monthKey: "2026-10", weekIndex: 0, amountCents: 3000, occurrenceCoord: 31 };
    expect((await api().post("/BillSplit").send(row)).status).toBe(200);
    const dup = await api().post("/BillSplit").send(row);
    expect(dup.status).toBe(500);
    expect(dup.body.message).toMatch(/UNIQUE/);
  });

  it("404s an unknown resource or id", async () => {
    expect((await api().get("/NotAModel")).status).toBe(404);
    expect((await api().get("/Bill/does-not-exist")).status).toBe(404);
  });

  it("parses date-only strings as UTC midnight", async () => {
    const acct = (await api().post("/Account").send({ name: "Checking" })).body;
    const txn = await api().post("/AccountTransaction").send({ accountId: acct.id, date: "2026-10-21", inflowCents: "70000", memo: "Income" });
    expect(txn.status).toBe(200);
    // Dates cross as ISO strings, as they do over HTTP (the store hands out Date objects).
    expect(txn.body.date).toBe("2026-10-21T00:00:00.000Z");
    expect(txn.body.inflowCents).toBe(70000);
  });

  it("rejects a repeated query key the way Express + the store do (500, not a crash)", async () => {
    expect((await api().get("/Bill?id=a&id=b")).status).toBe(500);
  });
});

describe("AppSettings on a fresh, empty database", () => {
  it("the first save creates the global row (with schema defaults) instead of 500ing", async () => {
    expect((await api().get("/AppSettings/global")).status).toBe(404);
    const saved = await api().patch("/AppSettings/global").send({ wifeWeeklyTargetCents: 25000 });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ id: "global", wifeWeeklyTargetCents: 25000, paymentCycle: "BI_WEEKLY", payDay: 2 });
    await api().patch("/AppSettings/global").send({ optimizedInputsSig: "{}" });
    const shown = await api().get("/AppSettings/global");
    expect(shown.body).toMatchObject({ wifeWeeklyTargetCents: 25000, optimizedInputsSig: "{}" });
    expect((await api().get("/AppSettings")).headers["x-total-count"]).toBe("1");
  });

  it("other resources still 500 when patching a missing id", async () => {
    expect((await api().patch("/Bill/does-not-exist").send({ amount: 1 })).status).toBe(500);
    expect((await api().patch("/AppSettings/not-global").send({ payDay: 1 })).status).toBe(500);
  });
});

describe("Income single-primary rule", () => {
  it("creating or patching a primary income demotes the others", async () => {
    const a = (await api().post("/Income").send({ name: "Day job", amount: 700, isPrimary: true })).body;
    expect(a.isPrimary).toBe(true);
    const b = (await api().post("/Income").send({ name: "Side gig", amount: 100, isPrimary: "true" })).body;
    expect(b.isPrimary).toBe(true);
    expect((await api().get(`/Income/${a.id}`)).body.isPrimary).toBe(false);
    await api().patch(`/Income/${a.id}`).send({ isPrimary: true });
    expect((await api().get(`/Income/${a.id}`)).body.isPrimary).toBe(true);
    expect((await api().get(`/Income/${b.id}`)).body.isPrimary).toBe(false);
  });
});

describe("BudgetCategoryItem delete", () => {
  it("snapshots the item name onto its transactions before deleting", async () => {
    const group = (await api().post("/BudgetCategoryGroup").send({ name: "Checking" })).body;
    const item = (await api().post("/BudgetCategoryItem").send({ groupId: group.id, name: "Gas", sourceType: "CUSTOM" })).body;
    const acct = (await api().post("/Account").send({ name: "Checking" })).body;
    const txn = (await api().post("/AccountTransaction").send({ accountId: acct.id, categoryItemId: item.id, outflowCents: 4500 })).body;

    expect((await api().delete(`/BudgetCategoryItem/${item.id}`)).status).toBe(200);
    const after = (await api().get(`/AccountTransaction/${txn.id}`)).body;
    expect(after.categoryItemId).toBeNull();
    expect(after.categoryName).toBe("Gas");
  });
});

// ── What only the phone answers ─────────────────────────────────────────────

describe("the non-resource routes on the phone", () => {
  it("meta reports the Android app and is not shadowed by the resource routes", async () => {
    const res = await api().get("/meta");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ version: "1.3.2", mode: "android", platform: "android" });
  });

  it("sandbox is inactive and every action is refused as not on the phone", async () => {
    expect((await api().get("/sandbox")).body).toEqual({ active: false, enteredAt: null, transactionsAdded: 0 });
    const enter = await api().post("/sandbox/enter");
    expect(enter.status).toBe(409);
    expect(enter.body).toEqual({ error: PHONE_MESSAGES.sandbox, message: PHONE_MESSAGES.sandbox, code: NOT_ON_PHONE });
    expect((await api().post("/sandbox/explode")).status).toBe(404);
  });

  it("sync is local only; connect / export / import are refused", async () => {
    const status = await api().get("/sync");
    expect(status.body).toMatchObject({ configured: false, state: "local", writesBlocked: null, appSchemaVersion: 1 });
    expect((await api().post("/sync/connect").send({ url: "x", token: "y" })).status).toBe(409);
    expect((await api().get("/sync/export")).status).toBe(409);
    expect((await api().post("/sync/import").send(new Uint8Array([1, 2, 3]))).body.code).toBe(NOT_ON_PHONE);
  });

  it("backups list empty and refuse to be made", async () => {
    expect((await api().get("/backups")).body).toMatchObject({ count: 0, lastBackupAt: null });
    expect((await api().post("/backups")).status).toBe(409);
  });

  it("updates: unsupported engine, a GitHub check from the WebView, refused download/install", async () => {
    const idle = (await api().get("/updates/status")).body;
    expect(idle).toMatchObject({ supported: false, installBlocked: null, state: "idle", current: "1.3.2" });

    githubAnswer = async () =>
      new Response(JSON.stringify({ tag_name: "v99.0.0", html_url: "https://example.test/rel", published_at: "2026-11-01T00:00:00Z" }), {
        status: 200,
      });
    const available = await api().post("/updates/check");
    expect(available.status).toBe(200);
    expect(available.body).toMatchObject({ state: "available", latest: "99.0.0", releaseUrl: "https://example.test/rel" });

    githubAnswer = async () => new Response(JSON.stringify({ tag_name: "v1.3.2" }), { status: 200 });
    expect((await api().post("/updates/check")).body.state).toBe("up-to-date");

    githubAnswer = async () => new Response("", { status: 503 });
    const failed = await api().post("/updates/check");
    expect(failed.body.state).toBe("error");
    expect(failed.body.error).toMatch(/503/);

    const download = await api().post("/updates/download");
    expect(download.status).toBe(409);
    expect(download.body.code).toBe("UPDATER_UNAVAILABLE");
    expect((await api().post("/updates/install")).status).toBe(409);
    expect((await api().post("/updates/nonsense")).status).toBe(404);
  });
});

// ── Refine's provider over the in-process client ────────────────────────────

describe("@refinedev/simple-rest over the in-process client", () => {
  const provider = () => dataProvider(BASE, createLocalHttpClient(() => local) as any);

  it("getList sends today's query shape (filters, sorters) and reads the total", async () => {
    const acct = (await api().post("/Account").send({ name: "Checking" })).body;
    const other = (await api().post("/Account").send({ name: "Savings" })).body;
    await api().post("/AccountTransaction").send({ accountId: acct.id, date: "2026-10-01", outflowCents: 100 });
    await api().post("/AccountTransaction").send({ accountId: acct.id, date: "2026-10-21", inflowCents: 70000, memo: "Income" });
    await api().post("/AccountTransaction").send({ accountId: other.id, date: "2026-10-15", inflowCents: 5 });

    const result = await provider().getList({
      resource: "AccountTransaction",
      pagination: { mode: "off" },
      filters: [{ field: "accountId", operator: "eq", value: acct.id }],
      sorters: [{ field: "date", order: "desc" }],
    });
    expect(result.total).toBe(2);
    expect(result.data.map((t: any) => t.date)).toEqual(["2026-10-21T00:00:00.000Z", "2026-10-01T00:00:00.000Z"]);
  });

  it("create / getOne / update / deleteOne round-trip and errors carry message + statusCode", async () => {
    const p = provider();
    const created = await p.create({ resource: "Payee", variables: { name: "Corner Market" } });
    expect(created.data).toMatchObject({ name: "Corner Market" });
    const id = created.data.id as string;
    expect((await p.getOne({ resource: "Payee", id })).data).toMatchObject({ id, name: "Corner Market" });
    expect((await p.update({ resource: "Payee", id, variables: { name: "Corner Shop" } })).data).toMatchObject({ name: "Corner Shop" });
    expect((await p.deleteOne({ resource: "Payee", id })).data).toEqual({ success: true });
    await expect(p.getOne({ resource: "Payee", id })).rejects.toMatchObject({ statusCode: 404, message: "Not found" });
    await expect(p.create({ resource: "Bill", variables: { name: "x", amount: "oops" } })).rejects.toMatchObject({
      statusCode: 500,
      message: expect.stringMatching(/amount/),
    });
  });
});
