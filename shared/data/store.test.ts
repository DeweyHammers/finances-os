// @vitest-environment node
/**
 * Data layer unit tests — DataStore over the libsql backend on a throwaway
 * file in a temp dir. Everything here is generic sample data; the route tests
 * (main/api-server.routes.test.ts) are the HTTP-level contract, these pin the
 * store's own behaviour: schema bootstrap + version stamp, defaults, strict
 * value checks, filters/sorting/count, the three business rules, reading
 * every DateTime storage format Prisma ever wrote, and transaction rollback.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { DataStore, MODELS, SCHEMA_VERSION, createDatabase, getModelByName, getSchemaVersion, resolveModel } from "./index";
import { DataError } from "./errors";
import { openLibsql, type LibsqlConnection } from "./backends/libsql";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "finances-os-data-test-"));
const dbFile = path.join(tmpDir, "store.db");

let conn: LibsqlConnection;
let store: DataStore;
const M = (name: string) => getModelByName(name);

beforeAll(async () => {
  conn = openLibsql(dbFile);
  store = new DataStore(conn);
  // First use on an empty file creates the schema (prepareDatabase).
  expect(await store.schemaVersion()).toBe(SCHEMA_VERSION);
});

afterAll(async () => {
  await store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  const tables = (await store.raw(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'SchemaVersion'",
  )) as { name: string }[];
  await store.raw("PRAGMA foreign_keys = OFF");
  for (const t of tables) await store.raw(`DELETE FROM "${t.name}"`);
  await store.raw("PRAGMA foreign_keys = ON");
});

describe("schema bootstrap", () => {
  it("creates every model's table and stamps the version", async () => {
    const tables = (await store.raw(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )) as { name: string }[];
    expect(tables.map((t) => t.name).sort()).toEqual(MODELS.map((m) => m.name).sort());
    const stamp = (await store.raw('SELECT "version", "appliedAt" FROM "SchemaVersion"')) as any[];
    expect(stamp).toHaveLength(1);
    expect(stamp[0].version).toBe(SCHEMA_VERSION);
    expect(typeof stamp[0].appliedAt).toBe("number"); // Unix ms, like Prisma
  });

  it("adds the version bookkeeping to a database that predates the data layer", async () => {
    // A Prisma-era file: all tables, no SchemaVersion.
    const legacy = openLibsql(path.join(tmpDir, "legacy.db"));
    await createDatabase(legacy);
    await legacy.exec('DROP TABLE "SchemaVersion"');
    expect(await getSchemaVersion(legacy)).toBe(0);

    const legacyStore = new DataStore(legacy);
    expect(await legacyStore.schemaVersion()).toBe(SCHEMA_VERSION);
    expect(await legacyStore.schemaVersion()).toBe(SCHEMA_VERSION); // idempotent
    expect((await legacy.exec('SELECT count(*) AS c FROM "SchemaVersion"'))[0].c).toBe(1);
    await legacyStore.close();
  });

  it("releases the file on close so it can be deleted (Sandbox relies on it)", async () => {
    const file = path.join(tmpDir, "closable.db");
    const s = new DataStore(openLibsql(file));
    await s.create(M("Bill"), { name: "Sample", amount: 1, dueDate: 1 });
    await s.close();
    fs.unlinkSync(file); // EBUSY here means a statement handle leaked
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("resources", () => {
  it("resolves model names case-insensitively and hides internal tables", () => {
    expect(resolveModel("Bill")?.name).toBe("Bill");
    expect(resolveModel("bill")?.name).toBe("Bill");
    expect(resolveModel("BUDGETCATEGORYITEM")?.name).toBe("BudgetCategoryItem");
    expect(resolveModel("SchemaVersion")).toBeUndefined();
    expect(resolveModel("NotAModel")).toBeUndefined();
  });
});

describe("create", () => {
  it("generates a cuid-shaped id, fills now() and lets the DDL supply literal defaults", async () => {
    const before = Date.now();
    const txnAccount = await store.create(M("Account"), { name: "Checking" });
    const txn = await store.create(M("AccountTransaction"), { accountId: txnAccount.id, memo: "x" });
    expect(txn.id).toMatch(/^c[a-z0-9]{24}$/);
    expect(txn.date).toBeInstanceOf(Date);
    expect((txn.date as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect(txn).toMatchObject({ inflowCents: 0, outflowCents: 0, isAdjustment: false, cleared: true, payeeId: null });
    // Stored the way Prisma stored it: integer ms + 0/1 booleans.
    const raw = (await store.raw('SELECT typeof("date") AS t, "cleared" FROM "AccountTransaction"')) as any[];
    expect(raw[0]).toEqual({ t: "integer", cleared: 1 });
  });

  it("ignores a client id and the legacy relation keys, and coerces form strings", async () => {
    const bill = await store.create(M("Bill"), {
      id: "mine",
      client: { nested: true },
      contracts: [],
      name: "  Sample Streaming ",
      amount: "12.50",
      dueDate: "15",
    });
    expect(bill.id).not.toBe("mine");
    expect(bill).toMatchObject({ name: "Sample Streaming", amount: 12.5, dueDate: 15, isAutoPay: true });
  });

  it("rejects unknown columns and wrong value types like the Prisma client did", async () => {
    await expect(store.create(M("Bill"), { name: "x", amount: 1, bogus: 1 })).rejects.toThrow(/Unknown argument `bogus`/);
    await expect(store.create(M("Bill"), { name: "x", amount: "lots" })).rejects.toThrow(/Expected Float/);
    await expect(store.create(M("BillSplit"), { billId: "b", monthKey: "2026-10", weekIndex: "0", amountCents: 1 })).rejects.toThrow(/Expected Int/);
    await expect(store.create(M("Bill"), { name: 42, amount: 1 })).rejects.toThrow(/Expected String/);
    await expect(store.create(M("Bill"), { name: null, amount: 1 })).rejects.toThrow(/Expected String, provided null/);
    await expect(store.create(M("Bill"), { amount: 1 })).rejects.toThrow(/NOT NULL/);
  });

  it("surfaces unique-constraint violations as errors", async () => {
    await store.create(M("Payee"), { name: "Corner Market" });
    await expect(store.create(M("Payee"), { name: "Corner Market" })).rejects.toThrow(/UNIQUE/);
  });
});

describe("list", () => {
  beforeEach(async () => {
    for (const [name, dueDate] of [["Zeta", 25], ["Sample Alpha", 3], ["Sample Beta", 12]] as const) {
      await store.create(M("Bill"), { name, amount: 10, dueDate });
    }
  });

  it("returns everything with a total when there is no query", async () => {
    const { items, total } = await store.list(M("Bill"));
    expect(items).toHaveLength(3);
    expect(total).toBe(3);
  });

  it("applies equality and _like filters, counts the filtered set, ignores paging keys", async () => {
    const like = await store.list(M("Bill"), { name_like: "alph", _start: "0", _end: "1", q: "ignored" });
    expect(like.items.map((b) => b.name)).toEqual(["Sample Alpha"]); // LIKE is case-insensitive
    expect(like.total).toBe(1);
    const eq = await store.list(M("Bill"), { name: "Sample Beta" });
    expect(eq.items.map((b) => b.dueDate)).toEqual([12]);
  });

  it("escapes LIKE wildcards in the _like value", async () => {
    await store.create(M("Bill"), { name: "100%", amount: 1, dueDate: 1 });
    expect((await store.list(M("Bill"), { name_like: "%" })).items.map((b) => b.name)).toEqual(["100%"]);
    expect((await store.list(M("Bill"), { name_like: "_eta" })).total).toBe(0);
  });

  it("sorts by _sort/_order, several fields at once", async () => {
    const desc = await store.list(M("Bill"), { _sort: "dueDate", _order: "desc" });
    expect(desc.items.map((b) => b.name)).toEqual(["Zeta", "Sample Beta", "Sample Alpha"]);
    const multi = await store.list(M("Bill"), { _sort: "amount, name", _order: "ASC" });
    expect(multi.items.map((b) => b.name)).toEqual(["Sample Alpha", "Sample Beta", "Zeta"]);
  });

  it("rejects unknown columns, a bad order and a string filter on a non-string column", async () => {
    await expect(store.list(M("Bill"), { nope: "x" })).rejects.toThrow(/Unknown argument `nope`/);
    await expect(store.list(M("Bill"), { _sort: "nope" })).rejects.toThrow(/Unknown argument/);
    await expect(store.list(M("Bill"), { _sort: "name", _order: "sideways" })).rejects.toThrow(/sort order/);
    await expect(store.list(M("Bill"), { dueDate: "3" })).rejects.toThrow(/Expected Int/);
    await expect(store.list(M("Bill"), { dueDate_like: "3" })).rejects.toThrow(/contains/);
  });
});

describe("getOne / update / remove", () => {
  it("reads one row or null, patches with the caller's id, errors on a missing row", async () => {
    const bill = await store.create(M("Bill"), { name: "Sample", amount: 10, dueDate: 1 });
    expect(await store.getOne(M("Bill"), bill.id as string)).toMatchObject({ name: "Sample" });
    expect(await store.getOne(M("Bill"), "missing")).toBeNull();

    const updated = await store.update(M("Bill"), bill.id as string, { id: "hijack", amount: 29.99, entries: [] });
    expect(updated).toMatchObject({ id: bill.id, amount: 29.99 });
    expect(await store.update(M("Bill"), bill.id as string, {})).toMatchObject({ amount: 29.99 }); // empty patch = read

    await expect(store.update(M("Bill"), "missing", { amount: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(store.update(M("Bill"), "missing", {})).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(store.remove(M("Bill"), "missing")).rejects.toMatchObject({ code: "NOT_FOUND" });

    await store.remove(M("Bill"), bill.id as string);
    expect(await store.getOne(M("Bill"), bill.id as string)).toBeNull();
  });

  it("enforces foreign keys: cascade and set-null work as the schema says", async () => {
    const bill = await store.create(M("Bill"), { name: "Sample", amount: 10, dueDate: 1 });
    await store.create(M("BillSplit"), { billId: bill.id, monthKey: "2026-10", weekIndex: 0, amountCents: 500 });
    await store.remove(M("Bill"), bill.id as string);
    expect(await store.count(M("BillSplit"))).toBe(0); // ON DELETE CASCADE

    await expect(
      store.create(M("BillSplit"), { billId: "no-such-bill", monthKey: "2026-10", weekIndex: 0, amountCents: 1 }),
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it("creates AppSettings/global on its first save and updates it afterwards", async () => {
    expect(await store.getOne(M("AppSettings"), "global")).toBeNull();
    const first = await store.update(M("AppSettings"), "global", { wifeWeeklyTargetCents: 25000 });
    expect(first).toMatchObject({ id: "global", wifeWeeklyTargetCents: 25000, paymentCycle: "BI_WEEKLY", payDay: 2, optimizedInputsSig: null });
    await store.update(M("AppSettings"), "global", { optimizedInputsSig: "{}" });
    expect(await store.getOne(M("AppSettings"), "global")).toMatchObject({ wifeWeeklyTargetCents: 25000, optimizedInputsSig: "{}" });
    expect(await store.count(M("AppSettings"))).toBe(1);
    // Only the global row is special.
    await expect(store.update(M("AppSettings"), "other", { payDay: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("Income single-primary rule", () => {
  it("demotes the others on create and on update; a missing flag means not primary", async () => {
    const a = await store.create(M("Income"), { name: "Day job", amount: 700, isPrimary: true });
    const b = await store.create(M("Income"), { name: "Side gig", amount: 100, isPrimary: "true" });
    expect(b.isPrimary).toBe(true);
    expect((await store.getOne(M("Income"), a.id as string))?.isPrimary).toBe(false);

    await store.update(M("Income"), a.id as string, { isPrimary: true });
    expect((await store.getOne(M("Income"), a.id as string))?.isPrimary).toBe(true);
    expect((await store.getOne(M("Income"), b.id as string))?.isPrimary).toBe(false);

    // Historic quirk kept on purpose: a patch without the flag clears it.
    await store.update(M("Income"), a.id as string, { amount: 750 });
    expect((await store.getOne(M("Income"), a.id as string))?.isPrimary).toBe(false);
  });

  it("rolls the demotion back when the create itself fails", async () => {
    const a = await store.create(M("Income"), { name: "Day job", amount: 700, isPrimary: true });
    await expect(store.create(M("Income"), { name: "Bad", amount: "x", isPrimary: true })).rejects.toBeInstanceOf(DataError);
    expect((await store.getOne(M("Income"), a.id as string))?.isPrimary).toBe(true);
  });
});

describe("BudgetCategoryItem delete", () => {
  it("snapshots the item name onto its transactions before the FK sets the id to null", async () => {
    const group = await store.create(M("BudgetCategoryGroup"), { name: "Checking" });
    const item = await store.create(M("BudgetCategoryItem"), { groupId: group.id, name: "Gas", sourceType: "CUSTOM" });
    const acct = await store.create(M("Account"), { name: "Checking" });
    const txn = await store.create(M("AccountTransaction"), { accountId: acct.id, categoryItemId: item.id, outflowCents: 4500 });

    await store.remove(M("BudgetCategoryItem"), item.id as string);
    const after = await store.getOne(M("AccountTransaction"), txn.id as string);
    expect(after?.categoryItemId).toBeNull();
    expect(after?.categoryName).toBe("Gas");
  });
});

describe("DateTime storage formats", () => {
  it("reads integer ms, ISO text and CURRENT_TIMESTAMP text; writes integer ms", async () => {
    await store.raw(
      `INSERT INTO "Earning" ("id", "amount", "date") VALUES
        ('e1', 1, 1778112611126),
        ('e2', 2, '2026-04-19T00:00:00.000+00:00'),
        ('e3', 3, '2026-04-19 10:30:00')`,
    );
    const rows = (await store.list(M("Earning"), { _sort: "amount" })).items;
    expect(rows.map((r) => r.date)).toEqual([
      new Date(1778112611126), // integer = Unix ms, not seconds
      new Date("2026-04-19T00:00:00.000Z"),
      new Date("2026-04-19T10:30:00.000Z"), // CURRENT_TIMESTAMP text is UTC
    ]);

    const written = await store.create(M("Earning"), { amount: 4, date: "2026-10-21" });
    expect((written.date as Date).toISOString()).toBe("2026-10-21T00:00:00.000Z");
    const raw = (await store.raw(`SELECT typeof("date") AS t, "date" FROM "Earning" WHERE "id" = ?`, [written.id as string])) as any[];
    expect(raw[0]).toEqual({ t: "integer", date: Date.parse("2026-10-21T00:00:00Z") });
  });

  it("accepts a Date or an ISO string on write and rejects junk", async () => {
    const d = await store.create(M("Earning"), { amount: 1, date: new Date("2026-01-02T03:04:05Z") });
    expect((d.date as Date).toISOString()).toBe("2026-01-02T03:04:05.000Z");
    await expect(store.create(M("Earning"), { amount: 1, date: "yesterday" })).rejects.toThrow(/Expected DateTime/);
    await expect(store.create(M("Earning"), { amount: 1, date: 12 })).rejects.toThrow(/Expected DateTime/);
  });
});

describe("concurrency", () => {
  it("serialises interleaved calls so transactions never overlap", async () => {
    await Promise.all([
      store.create(M("Income"), { name: "A", amount: 1, isPrimary: true }),
      store.create(M("Income"), { name: "B", amount: 1, isPrimary: true }),
      store.create(M("Income"), { name: "C", amount: 1, isPrimary: true }),
      store.list(M("Income")),
    ]);
    const primaries = (await store.list(M("Income"))).items.filter((i) => i.isPrimary);
    expect(primaries).toHaveLength(1);
  });
});
