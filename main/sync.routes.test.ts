// @vitest-environment node
/**
 * Sync (main/sync.ts + /api/sync routes), local-first (Oct 29 2026) — real
 * HTTP, a real temp database, the REAL libsql client in its offline-writes
 * mode and the app's REAL transport (@libsql/client), with the cloud stood
 * in by tests/helpers/libsql-sync-server.ts: a protocol-faithful mock of
 * Turso's side of libsql's sync protocol (and enough Hrana for
 * @libsql/client), running in its own process. Nothing here is faked inside
 * the app; what the mock can't prove is that Turso's live servers still
 * speak the protocol (the user's own Turso run).
 *
 * The contract pinned here: writes are local and never wait for the cloud,
 * a sync pushes them and pulls other devices' changes, offline = read-WRITE
 * with a pending count, a cloud that moved on while this PC had unpushed
 * changes is a `conflict` the user settles ("cloud" or "local", both with a
 * .bak), and sandbox / backups / export / import / disconnect / restart all
 * work on the local copy. The route contract test
 * (api-server.routes.test.ts) stays untouched: sync off = exactly as before.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import type { Server } from "http";
import { startSyncServerProcess, type SyncServerProcess } from "../tests/helpers/libsql-sync-server";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "finances-os-sync-test-"));
const tmpDb = path.join(tmpDir, "test.db");
const replicaDb = path.join(tmpDir, "replica.db");
const otherDb = path.join(tmpDir, "other-device.db");
const settingsFile = path.join(tmpDir, "sync.json");
const HOST = "127.0.0.1:5858";
const TOKEN = "test-token-not-real";
/** The sync is bounded this tightly only here (the app waits 30 s). */
const SYNC_TIMEOUT_MS = 3_000;

let server: Server;
let cloud: SyncServerProcess;
let sync: typeof import("./sync");
let db: typeof import("../shared/db");
let libsql: typeof import("../shared/data/backends/libsql");

const api = () => {
  const agent = request(server);
  return {
    get: (url: string) => agent.get(url).set("Host", HOST),
    post: (url: string) => agent.post(url).set("Host", HOST),
    patch: (url: string) => agent.patch(url).set("Host", HOST),
    delete: (url: string) => agent.delete(url).set("Host", HOST),
  };
};

/** Rows straight from the cloud (through its own Hrana-less exec), bypassing the app. */
const cloudRows = (sql: string) => cloud.exec(sql);
const billNames = async () => (await cloudRows('SELECT name FROM "Bill" ORDER BY name')).map((r) => r.name);
const apiBillNames = async () => ((await api().get("/api/Bill")).body as any[]).map((b) => b.name).sort();

/**
 * A second device: another real libsql synced database on the same cloud,
 * driven directly (no app). Its own files live in the temp dir.
 */
async function otherDevice() {
  const conn = libsql.openLibsql(otherDb, { sync: { syncUrl: cloud.url, authToken: TOKEN, offline: true } });
  await conn.open();
  await conn.sync();
  return {
    conn,
    /** Add a bill and push it. */
    async addBill(name: string) {
      await conn.exec('INSERT INTO "Bill" ("id", "name", "amount", "dueDate") VALUES (?, ?, 1, 1)', [`other-${name}`, name]);
      return conn.sync();
    },
    bills: async () => (await conn.exec('SELECT name FROM "Bill" ORDER BY name')).map((r) => r.name),
    async close() {
      await conn.close();
      for (const f of fs.readdirSync(tmpDir).filter((f) => f.startsWith("other-device.db"))) {
        fs.rmSync(path.join(tmpDir, f), { force: true, maxRetries: 10, retryDelay: 50 });
      }
    },
  };
}
let other: Awaited<ReturnType<typeof otherDevice>> | null = null;

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
async function timedPosts(count: number, prefix: string): Promise<number[]> {
  const times: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = performance.now();
    expect((await api().post("/api/Bill").send({ name: `${prefix} ${i}`, amount: 1, dueDate: 1 })).status).toBe(200);
    times.push(performance.now() - t);
  }
  return times;
}

beforeAll(async () => {
  const { createEmptyDatabase } = await import("../scripts/empty-db.mjs");
  createEmptyDatabase(tmpDb);
  process.env.FINANCES_OS_TEST_DB_URL = `file:${tmpDb.replace(/\\/g, "/")}`;

  db = await import("../shared/db");
  libsql = await import("../shared/data/backends/libsql");
  sync = await import("./sync");
  sync.__setSyncTimeoutForTests(SYNC_TIMEOUT_MS);
  cloud = await startSyncServerProcess();

  const mod = await import("./api-server");
  server = mod.startServer(0);
}, 60_000);

afterAll(async () => {
  await sync.__resetSyncForTests();
  server?.close();
  await db.prisma.$disconnect();
  await cloud.close();
  fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

beforeEach(async () => {
  // Every test starts local only, on an empty local database and an empty cloud.
  if ((await api().get("/api/sandbox")).body.active) await api().post("/api/sandbox/discard");
  await sync.__resetSyncForTests();
  await cloud.reset();
  const tables: { name: string }[] = await db.prisma.$queryRawUnsafe(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'SchemaVersion'",
  );
  await db.prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
  for (const t of tables) await db.prisma.$executeRawUnsafe(`DELETE FROM "${t.name}"`);
  await db.prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  for (const f of fs.readdirSync(tmpDir).filter((f) => f.endsWith(".bak"))) fs.unlinkSync(path.join(tmpDir, f));
});

afterEach(async () => {
  if (other) await other.close();
  other = null;
  if ((await api().get("/api/sandbox")).body.active) await api().post("/api/sandbox/discard");
});

const connect = (extra: Record<string, unknown> = {}) =>
  api().post("/api/sync/connect").send({ url: cloud.url, token: TOKEN, ...extra });

describe("local only (sync off)", () => {
  it("reports local, blocks nothing, and refuses sync-only actions", async () => {
    const status = (await api().get("/api/sync")).body;
    expect(status).toMatchObject({
      configured: false,
      state: "local",
      url: null,
      writesBlocked: null,
      replicaPath: null,
      pendingChanges: 0,
      pendingPush: false,
      conflict: null,
    });
    expect((await api().post("/api/sync/now")).status).toBe(409);
    expect((await api().post("/api/sync/disconnect")).status).toBe(409);
    expect((await api().post("/api/sync/resolve").send({ keep: "cloud" })).status).toBe(409);
    expect((await api().post("/api/Bill").send({ name: "Local", amount: 1, dueDate: 1 })).status).toBe(200);
    expect(fs.existsSync(settingsFile)).toBe(false);
  });

  it("validates the URL and token before touching anything", async () => {
    expect((await connect({ url: "not a url" })).status).toBe(400);
    expect((await connect({ token: "" })).status).toBe(400);
    expect((await api().post("/api/sync/probe").send({ url: "ftp://x", token: "t" })).status).toBe(400);
    expect((await cloud.snapshot()).requests).toEqual([]);
  });

  it("says when the cloud can't be reached", async () => {
    await cloud.set("reachable", false);
    const res = await connect();
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/can't be reached/);
    expect((await api().get("/api/sync")).body.configured).toBe(false);
    expect(fs.existsSync(replicaDb)).toBe(false);
  });
});

describe("connect", () => {
  it("uploads the local database into an empty cloud and switches to a local copy of it", async () => {
    await api().post("/api/Bill").send({ name: "Uploaded", amount: 12, dueDate: 3 });
    const probe = await api().post("/api/sync/probe").send({ url: cloud.url, token: TOKEN });
    expect(probe.status).toBe(200);
    expect(probe.body).toMatchObject({ empty: true, schemaVersion: 0, dataRows: 0, tables: 0 });

    const res = await connect();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      configured: true,
      state: "synced",
      url: cloud.url,
      readOnly: false,
      writesBlocked: null,
      pendingChanges: 0,
      conflict: null,
    });
    expect(res.body.lastSyncedAt).toBeTruthy();
    // The token went to the cloud as a bearer token (both the Hrana upload and libsql's sync).
    expect((await cloud.snapshot()).authHeaders).toEqual([`Bearer ${TOKEN}`]);

    // The cloud holds the schema + the row; the local copy was bootstrapped
    // beside the local file (libsql's db + -info pair); the local file is untouched.
    expect(await billNames()).toEqual(["Uploaded"]);
    expect(await cloudRows('SELECT version FROM "SchemaVersion"')).toEqual([{ version: 1 }]);
    expect(fs.existsSync(replicaDb)).toBe(true);
    expect(fs.existsSync(`${replicaDb}-info`)).toBe(true);
    const localConn = libsql.openLibsql(tmpDb);
    expect(await localConn.exec('SELECT name FROM "Bill"')).toEqual([{ name: "Uploaded" }]);
    await localConn.close();

    // Reads and writes go to the local copy; a write is pending until the next sync pushes it.
    expect(await apiBillNames()).toEqual(["Uploaded"]);
    await api().post("/api/Bill").send({ name: "Via copy", amount: 5, dueDate: 9 });
    expect((await api().get("/api/sync")).body).toMatchObject({ state: "synced", pendingChanges: 1, pendingPush: true });
    expect(await billNames()).toEqual(["Uploaded"]);
    const pushed = await api().post("/api/sync/now");
    expect(pushed.status).toBe(200);
    expect(pushed.body).toMatchObject({ state: "synced", pendingChanges: 0, pendingPush: false });
    expect(await billNames()).toEqual(["Uploaded", "Via copy"]);

    // Settings are saved beside the database — token in the plain fallback
    // (no safeStorage outside Electron), URL in clear.
    const saved = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    expect(saved.url).toBe(cloud.url);
    expect(saved.token).toEqual({ kind: "plain", data: TOKEN });
    expect((await api().get("/api/meta")).body.databasePath.replace(/\\/g, "/")).toBe(tmpDb.replace(/\\/g, "/"));
  });

  it("asks which side wins when the cloud already holds data", async () => {
    await api().post("/api/Bill").send({ name: "Mine", amount: 1, dueDate: 1 });
    // A cloud database another device already filled.
    const { loadStatements, dumpDatabase } = await import("../shared/data");
    const localDump = await dumpDatabase({ exec: (s, p) => db.getStore().raw(s, p) });
    const theirs = JSON.parse(JSON.stringify(localDump));
    const bills = theirs.tables.find((t: any) => t.table === "Bill");
    bills.rows[0][bills.columns.indexOf("name")] = "Theirs";
    await cloud.batch(loadStatements(theirs));

    const refused = await connect();
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("REMOTE_HAS_DATA");
    expect(refused.body.details).toMatchObject({ empty: false, dataRows: 1, schemaVersion: 1 });
    expect((await api().get("/api/sync")).body.configured).toBe(false);
    expect(await billNames()).toEqual(["Theirs"]);

    // "cloud": the cloud's rows win, the local file keeps its own as the before-sync copy.
    expect((await connect({ source: "cloud" })).status).toBe(200);
    expect(await apiBillNames()).toEqual(["Theirs"]);
    await sync.__resetSyncForTests();

    // "local": this device's rows replace the cloud's.
    expect((await connect({ source: "local" })).status).toBe(200);
    expect(await billNames()).toEqual(["Mine"]);
    expect(await apiBillNames()).toEqual(["Mine"]);
  });

  it("refuses a cloud database made by a newer app", async () => {
    const { loadStatements, dumpDatabase, SCHEMA_VERSION } = await import("../shared/data");
    const dump = await dumpDatabase({ exec: (s, p) => db.getStore().raw(s, p) });
    const v = dump.tables.find((t) => t.table === "SchemaVersion")!;
    v.rows.push([SCHEMA_VERSION + 5, Date.now()]);
    await cloud.batch(loadStatements(dump));

    const res = await connect({ source: "cloud" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SCHEMA_NEWER");
    expect(res.body.error).toMatch(/update the app/i);
    expect((await api().get("/api/sync")).body.configured).toBe(false);
  });

  it("cannot connect twice, nor from inside a sandbox", async () => {
    expect((await connect()).status).toBe(200);
    expect((await connect()).status).toBe(409);
    await sync.__resetSyncForTests();
    await api().post("/api/sandbox/enter");
    expect((await connect()).status).toBe(409);
  });
});

describe("while synced", () => {
  beforeEach(async () => {
    await api().post("/api/Bill").send({ name: "Seed", amount: 1, dueDate: 1 });
    expect((await connect()).status).toBe(200);
  });

  it("writes are local — as fast as with sync off — and one sync pushes them all", async () => {
    // Same writes, sync off (fresh local-only state) vs sync on.
    await sync.__resetSyncForTests();
    const local = await timedPosts(20, "Local");
    await api().post("/api/sync/probe").send({ url: cloud.url, token: TOKEN }); // warm the transport
    await cloud.reset();
    expect((await connect()).status).toBe(200);
    const pushesBefore = (await cloud.snapshot()).pushes;
    const synced = await timedPosts(20, "Synced");
    console.log(`write through the API — sync off: median ${median(local).toFixed(1)} ms, sync on: median ${median(synced).toFixed(1)} ms`);
    // Nothing reached the cloud yet, and no write waited for it.
    expect((await cloud.snapshot()).pushes).toBe(pushesBefore);
    expect(synced.every((ms) => ms < 250)).toBe(true);
    expect(median(synced)).toBeLessThan(median(local) * 4 + 25);
    expect((await api().get("/api/sync")).body.pendingChanges).toBe(20);

    const res = await api().post("/api/sync/now");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: "synced", pendingChanges: 0 });
    expect((await billNames()).filter((n) => String(n).startsWith("Synced"))).toHaveLength(20);
  });

  it("pulls what another device pushed", async () => {
    other = await otherDevice();
    expect(await other.bills()).toEqual(["Seed"]);
    await other.addBill("From the phone");
    expect(await billNames()).toEqual(["From the phone", "Seed"]);
    expect(await apiBillNames()).toEqual(["Seed"]);
    const res = await api().post("/api/sync/now");
    expect(res.status).toBe(200);
    expect(await apiBillNames()).toEqual(["From the phone", "Seed"]);
    // And the other way round: a write here reaches the other device on its next sync.
    await api().post("/api/Bill").send({ name: "From the PC", amount: 2, dueDate: 2 });
    await api().post("/api/sync/now");
    await other.conn.sync();
    expect(await other.bills()).toEqual(["From the PC", "From the phone", "Seed"]);
  });

  it("keeps working read-write offline, counts the changes, and pushes them when the cloud is back", async () => {
    await cloud.set("reachable", false);
    expect((await api().post("/api/Bill").send({ name: "Offline write", amount: 1, dueDate: 1 })).status).toBe(200);
    expect((await api().patch("/api/AppSettings/global").send({ wifeWeeklyTargetCents: 1 })).status).toBe(200);
    const res = await api().post("/api/sync/now");
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/can't be reached/);
    const offline = (await api().get("/api/sync")).body;
    expect(offline).toMatchObject({ state: "offline", readOnly: false, writesBlocked: null, pendingPush: true });
    expect(offline.pendingChanges).toBeGreaterThanOrEqual(2);
    expect(await apiBillNames()).toEqual(["Offline write", "Seed"]);
    expect(await billNames()).toEqual(["Seed"]);

    await cloud.set("reachable", true);
    const back = await api().post("/api/sync/now");
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ state: "synced", pendingChanges: 0, lastError: null });
    expect(await billNames()).toEqual(["Offline write", "Seed"]);
  });

  it("a cloud that accepts connections and never answers delays no write", async () => {
    await cloud.set("hang", true);
    const t = performance.now();
    expect((await api().post("/api/Bill").send({ name: "During hang", amount: 1, dueDate: 1 })).status).toBe(200);
    expect(performance.now() - t).toBeLessThan(500);
    const res = await api().post("/api/sync/now");
    expect(res.status).toBe(502);
    expect((await api().get("/api/sync")).body).toMatchObject({ state: "offline" });
    expect((await api().get("/api/sync")).body.lastError).toMatch(/timed out/);
    // Reads and writes carried on meanwhile, and recover with the cloud.
    expect(await apiBillNames()).toEqual(["During hang", "Seed"]);
    await cloud.set("hang", false);
    expect((await api().post("/api/sync/now")).body.state).toBe("synced");
    expect(await billNames()).toEqual(["During hang", "Seed"]);
  }, 15_000);

  describe("conflict: the cloud moved on while this PC had unpushed changes", () => {
    async function makeConflict() {
      other = await otherDevice();
      await other.addBill("Theirs");
      // This PC has not pulled "Theirs" yet and writes on top of the old state.
      await api().post("/api/Bill").send({ name: "Mine", amount: 1, dueDate: 1 });
      const res = await api().post("/api/sync/now");
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("SYNC_CONFLICT");
      const status = (await api().get("/api/sync")).body;
      expect(status.state).toBe("conflict");
      expect(status.conflict.message).toMatch(/InvalidPushFrame/);
      expect(status.pendingChanges).toBeGreaterThanOrEqual(1);
      expect(status.writesBlocked).toBeNull();
      return status;
    }

    it("is reported, keeps the local data usable, and stays until settled", async () => {
      await makeConflict();
      expect(await apiBillNames()).toEqual(["Mine", "Seed"]);
      expect((await api().post("/api/Bill").send({ name: "Still writing", amount: 1, dueDate: 1 })).status).toBe(200);
      const again = await api().post("/api/sync/now");
      expect(again.status).toBe(409);
      expect(again.body.code).toBe("SYNC_CONFLICT");
      expect(await billNames()).toEqual(["Seed", "Theirs"]);
      expect((await api().post("/api/sync/resolve").send({ keep: "sideways" })).status).toBe(400);
    });

    it("'cloud': this PC's rows go into a .bak and the copy is fetched again", async () => {
      await makeConflict();
      const res = await api().post("/api/sync/resolve").send({ keep: "cloud" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ state: "synced", pendingChanges: 0, conflict: null });
      expect(res.body.backupPath).toMatch(/test\.db\..*\.bak$/);
      const bak = libsql.openLibsql(res.body.backupPath);
      expect((await bak.exec('SELECT name FROM "Bill" ORDER BY name')).map((r) => r.name)).toEqual(["Mine", "Seed"]);
      await bak.close();
      expect(await apiBillNames()).toEqual(["Seed", "Theirs"]);
      expect(await billNames()).toEqual(["Seed", "Theirs"]);
      // Writes flow again.
      await api().post("/api/Bill").send({ name: "After", amount: 1, dueDate: 1 });
      expect((await api().post("/api/sync/now")).body.state).toBe("synced");
      expect(await billNames()).toEqual(["After", "Seed", "Theirs"]);
    });

    it("'local': the cloud's rows go into a .bak and the cloud takes this PC's rows", async () => {
      await makeConflict();
      const res = await api().post("/api/sync/resolve").send({ keep: "local" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ state: "synced", pendingChanges: 0, conflict: null });
      const bak = libsql.openLibsql(res.body.backupPath);
      expect((await bak.exec('SELECT name FROM "Bill" ORDER BY name')).map((r) => r.name)).toEqual(["Seed", "Theirs"]);
      await bak.close();
      expect(await billNames()).toEqual(["Mine", "Seed"]);
      expect(await apiBillNames()).toEqual(["Mine", "Seed"]);
      // The other device pulls the settled state.
      await other!.conn.sync();
      expect(await other!.bills()).toEqual(["Mine", "Seed"]);
    });

    it("settling needs the cloud; nothing to settle is a 409", async () => {
      await makeConflict();
      await cloud.set("reachable", false);
      expect((await api().post("/api/sync/resolve").send({ keep: "cloud" })).status).toBe(502);
      expect((await api().get("/api/sync")).body.state).toBe("conflict");
      await cloud.set("reachable", true);
      expect((await api().post("/api/sync/resolve").send({ keep: "cloud" })).status).toBe(200);
      const none = await api().post("/api/sync/resolve").send({ keep: "cloud" });
      expect(none.status).toBe(409);
      expect(none.body.code).toBe("NO_CONFLICT");
    });
  });

  it("refuses to sync or write once the database is stamped by a newer app", async () => {
    const { SCHEMA_VERSION } = await import("../shared/data");
    await cloud.exec('INSERT INTO "SchemaVersion" ("version", "appliedAt") VALUES (?, ?)', [SCHEMA_VERSION + 1, Date.now()]);

    expect((await api().post("/api/sync/now")).body.state).toBe("blocked");
    const status = (await api().get("/api/sync")).body;
    expect(status.schemaGate).toEqual({ app: SCHEMA_VERSION, database: SCHEMA_VERSION + 1 });
    expect(status.writesBlocked).toMatch(/update the app/i);
    expect((await api().get("/api/Bill")).status).toBe(200);
    const write = await api().post("/api/Bill").send({ name: "No", amount: 1, dueDate: 1 });
    expect(write.status).toBe(409);
    expect(write.body).toMatchObject({ code: "WRITES_BLOCKED" });
    expect((await api().delete("/api/Bill/whatever")).status).toBe(409);
    const again = await api().post("/api/sync/now");
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("SCHEMA_NEWER");
  });

  it("sandbox: pauses sync, Discard reopens the copy, Keep pushes the kept rows", async () => {
    const entered = await api().post("/api/sandbox/enter");
    expect(entered.status).toBe(200);
    expect((await api().get("/api/sync")).body.state).toBe("paused");
    expect((await api().post("/api/sync/now")).status).toBe(409);
    expect((await api().post("/api/sync/disconnect")).status).toBe(409);
    const sandboxFile = path.join(tmpDir, "sandbox.db");
    expect(fs.readFileSync(sandboxFile).subarray(0, 15).toString()).toBe("SQLite format 3");

    // Edits inside the sandbox never reach the cloud …
    await api().post("/api/Bill").send({ name: "Sandboxed", amount: 2, dueDate: 2 });
    expect(await billNames()).toEqual(["Seed"]);
    // … and Discard forgets them. Reopening the copy needs no network.
    await cloud.set("reachable", false);
    expect((await api().post("/api/sandbox/discard")).status).toBe(200);
    expect(await apiBillNames()).toEqual(["Seed"]);
    await cloud.set("reachable", true);
    expect((await api().post("/api/sync/now")).body.state).toBe("synced");

    // Keep: the sandbox's rows replace the cloud's, with a .bak of this PC's rows first.
    await api().post("/api/sandbox/enter");
    await api().post("/api/Bill").send({ name: "Kept", amount: 3, dueDate: 3 });
    const kept = await api().post("/api/sandbox/keep");
    expect(kept.status).toBe(200);
    expect(kept.body.backupPath).toMatch(/test\.db\..*\.bak$/);
    expect(fs.existsSync(kept.body.backupPath)).toBe(true);
    expect(await billNames()).toEqual(["Kept", "Seed"]);
    expect((await api().get("/api/sync")).body).toMatchObject({ state: "synced", pendingChanges: 0 });
    expect(await apiBillNames()).toEqual(["Kept", "Seed"]);
    expect(fs.existsSync(sandboxFile)).toBe(false);
  });

  it("Keep needs the cloud and leaves the sandbox active when it is away", async () => {
    await api().post("/api/sandbox/enter");
    await cloud.set("reachable", false);
    const res = await api().post("/api/sandbox/keep");
    expect(res.status).toBe(502);
    expect((await api().get("/api/sandbox")).body.active).toBe(true);
    await cloud.set("reachable", true);
    expect((await api().post("/api/sandbox/keep")).status).toBe(200);
  });

  it("backs up the local copy through the data layer, offline too", async () => {
    await cloud.set("reachable", false);
    await api().post("/api/Bill").send({ name: "Unpushed", amount: 1, dueDate: 1 });
    const res = await api().post("/api/backups");
    expect(res.status).toBe(200);
    expect(res.body.method).toBe("dump");
    const bak = libsql.openLibsql(res.body.file);
    expect((await bak.exec('SELECT name FROM "Bill" ORDER BY name')).map((r) => r.name)).toEqual(["Seed", "Unpushed"]);
    await bak.close();
  });

  it("disconnect keeps the copy's rows — unpushed ones included — as the local file and forgets the token", async () => {
    await api().post("/api/Bill").send({ name: "Pushed", amount: 4, dueDate: 4 });
    await api().post("/api/sync/now");
    await cloud.set("reachable", false);
    await api().post("/api/Bill").send({ name: "Never pushed", amount: 5, dueDate: 5 });
    const res = await api().post("/api/sync/disconnect");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: false, state: "local", pendingChanges: 0 });
    expect(res.body.backupPath).toMatch(/test\.db\..*\.bak$/);
    expect(fs.existsSync(settingsFile)).toBe(false);
    expect(fs.existsSync(replicaDb)).toBe(false);
    expect(fs.existsSync(`${replicaDb}-info`)).toBe(false);
    expect(await apiBillNames()).toEqual(["Never pushed", "Pushed", "Seed"]);
    // The .bak is the local file from before ("Seed" only, uploaded at connect).
    const bak = libsql.openLibsql(res.body.backupPath);
    expect(await bak.exec('SELECT name FROM "Bill"')).toEqual([{ name: "Seed" }]);
    await bak.close();
    // Writes work locally again; the cloud never saw the unpushed row.
    expect((await api().post("/api/Bill").send({ name: "Local again", amount: 1, dueDate: 1 })).status).toBe(200);
    await cloud.set("reachable", true);
    expect(await billNames()).toEqual(["Pushed", "Seed"]);
  });

  it("restart: the saved settings reopen the copy without the network and the previous run's unpushed changes are pushed", async () => {
    await cloud.set("reachable", false);
    await api().post("/api/Bill").send({ name: "Before restart", amount: 1, dueDate: 1 });
    // Simulate a restart: forget the in-memory state, keep sync.json + the copy.
    await sync.__resetSyncForTests({ keepFiles: true });
    const offlineStart = await sync.initSync();
    expect(offlineStart).toMatchObject({ configured: true, state: "offline", url: cloud.url, readOnly: false, pendingPush: true });
    expect(offlineStart.pendingChanges).toBeGreaterThanOrEqual(1);
    expect(await apiBillNames()).toEqual(["Before restart", "Seed"]);
    expect((await api().post("/api/Bill").send({ name: "After restart", amount: 1, dueDate: 1 })).status).toBe(200);

    await cloud.set("reachable", true);
    await sync.__resetSyncForTests({ keepFiles: true });
    const status = await sync.initSync();
    expect(status).toMatchObject({ configured: true, state: "synced", pendingChanges: 0 });
    expect(await billNames()).toEqual(["After restart", "Before restart", "Seed"]);
    expect(await apiBillNames()).toEqual(["After restart", "Before restart", "Seed"]);
  });

  it("follows the cloud into a new generation (its checkpoint) and keeps pulling", async () => {
    await cloud.newGeneration();
    other = await otherDevice();
    await other.addBill("Next generation");
    expect((await api().post("/api/sync/now")).body.state).toBe("synced");
    expect(await apiBillNames()).toEqual(["Next generation", "Seed"]);
    await api().post("/api/Bill").send({ name: "Pushed after", amount: 1, dueDate: 1 });
    expect((await api().post("/api/sync/now")).body.state).toBe("synced");
    expect(await billNames()).toEqual(["Next generation", "Pushed after", "Seed"]);
  });

  it("a copy left by the old remote-replica mode (no mode marker) is backed up and fetched again", async () => {
    await api().post("/api/Bill").send({ name: "Pushed before", amount: 1, dueDate: 1 });
    await api().post("/api/sync/now");
    await sync.__resetSyncForTests({ keepFiles: true });
    expect(fs.readFileSync(`${replicaDb}-mode`, "utf8").trim()).toBe("offline-writes");
    fs.rmSync(`${replicaDb}-mode`);
    const status = await sync.initSync();
    expect(status).toMatchObject({ configured: true, state: "synced", readOnly: false, pendingChanges: 0 });
    const baks = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".bak"));
    expect(baks).toHaveLength(1);
    const bak = libsql.openLibsql(path.join(tmpDir, baks[0]));
    expect((await bak.exec('SELECT name FROM "Bill" ORDER BY name')).map((r) => r.name)).toEqual(["Pushed before", "Seed"]);
    await bak.close();
    expect(fs.existsSync(`${replicaDb}-mode`)).toBe(true);
    expect(await apiBillNames()).toEqual(["Pushed before", "Seed"]);
    expect((await api().post("/api/Bill").send({ name: "After", amount: 1, dueDate: 1 })).status).toBe(200);
    expect((await api().post("/api/sync/now")).body.state).toBe("synced");
    expect(await billNames()).toEqual(["After", "Pushed before", "Seed"]);
  });

  it("a damaged metadata file beside the copy is backed up and the copy fetched again", async () => {
    await sync.__resetSyncForTests({ keepFiles: true });
    fs.writeFileSync(`${replicaDb}-info`, '{"hash":1,"version":0,"durable_frame_num":999,"generation":1}');
    const status = await sync.initSync();
    expect(status).toMatchObject({ configured: true, state: "synced", readOnly: false });
    expect(fs.readdirSync(tmpDir).filter((f) => f.endsWith(".bak"))).toHaveLength(1);
    expect(await apiBillNames()).toEqual(["Seed"]);
  });

  it("no local copy and no cloud at startup: the pre-sync file is shown read-only until the cloud is back", async () => {
    await api().post("/api/Bill").send({ name: "Only in the copy", amount: 1, dueDate: 1 });
    await api().post("/api/sync/now");
    await sync.__resetSyncForTests({ keepFiles: true });
    for (const f of fs.readdirSync(tmpDir).filter((f) => f.startsWith("replica.db"))) fs.rmSync(path.join(tmpDir, f), { force: true });
    await cloud.set("reachable", false);
    const status = await sync.initSync();
    expect(status).toMatchObject({ configured: true, state: "offline", readOnly: true });
    expect(status.writesBlocked).toMatch(/read-only/);
    expect(await apiBillNames()).toEqual(["Seed"]);
    const write = await api().post("/api/Bill").send({ name: "Nope", amount: 1, dueDate: 1 });
    expect(write.status).toBe(409);
    expect(write.body.code).toBe("WRITES_BLOCKED");

    await cloud.set("reachable", true);
    const back = await api().post("/api/sync/now");
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ state: "synced", readOnly: false, writesBlocked: null });
    expect(await apiBillNames()).toEqual(["Only in the copy", "Seed"]);
  });
});

describe("export / import", () => {
  const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(c));
    res.on("end", () => cb(null, Buffer.concat(chunks)));
  };
  const exportDb = () => api().get("/api/sync/export").buffer(true).parse(binary);
  const importDb = (file: Buffer) =>
    api().post("/api/sync/import").set("Content-Type", "application/octet-stream").send(file);

  it("exports a plain SQLite download and imports it back, local only", async () => {
    await api().post("/api/Bill").send({ name: "Exported", amount: 7, dueDate: 7 });
    const res = await exportDb();
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="Finances OS .*\.db"/);
    const file = res.body as Buffer;
    expect(file.subarray(0, 15).toString()).toBe("SQLite format 3");

    // Change the data, then import the export: the rows come back, a .bak is written.
    await api().post("/api/Bill").send({ name: "After export", amount: 8, dueDate: 8 });
    const imported = await importDb(file);
    expect(imported.status).toBe(200);
    expect(imported.body).toMatchObject({ dataRows: 1, schemaVersion: 1, target: "local" });
    expect(fs.existsSync(imported.body.backupPath)).toBe(true);
    expect(await apiBillNames()).toEqual(["Exported"]);
  });

  it("refuses files that are not a database, or come from a newer app", async () => {
    expect((await importDb(Buffer.from("hello"))).status).toBe(400);
    expect((await api().post("/api/sync/import").send()).status).toBe(400);
    const newer = path.join(tmpDir, "newer.db");
    const { createEmptyDatabase } = await import("../scripts/empty-db.mjs");
    createEmptyDatabase(newer);
    const { SCHEMA_VERSION } = await import("../shared/data");
    const c = libsql.openLibsql(newer);
    await c.exec('INSERT INTO "SchemaVersion" ("version", "appliedAt") VALUES (?, ?)', [SCHEMA_VERSION + 1, 0]);
    await c.close();
    const res = await importDb(fs.readFileSync(newer));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SCHEMA_NEWER");
  });

  it("while synced, an import replaces the cloud's rows and an export reads the local copy", async () => {
    await api().post("/api/Bill").send({ name: "Before", amount: 1, dueDate: 1 });
    const exported = (await exportDb()).body as Buffer;
    expect((await connect()).status).toBe(200);
    await api().post("/api/Bill").send({ name: "Cloud extra", amount: 2, dueDate: 2 });

    // The export reads the copy, unpushed row included.
    const synced = await exportDb();
    expect(synced.status).toBe(200);
    const check = path.join(tmpDir, "check.db");
    fs.writeFileSync(check, synced.body as Buffer);
    const c = libsql.openLibsql(check);
    expect((await c.exec('SELECT name FROM "Bill" ORDER BY name')).map((r) => r.name)).toEqual(["Before", "Cloud extra"]);
    await c.close();

    const imported = await importDb(exported);
    expect(imported.status).toBe(200);
    expect(imported.body.target).toBe("cloud");
    expect(await billNames()).toEqual(["Before"]);
    expect(await apiBillNames()).toEqual(["Before"]);
    expect((await api().get("/api/sync")).body).toMatchObject({ state: "synced", pendingChanges: 0 });
  });

  it("neither works from inside a sandbox", async () => {
    await api().post("/api/sandbox/enter");
    expect((await exportDb()).status).toBe(409);
    expect((await importDb(Buffer.from("x"))).status).toBe(409);
  });
});
