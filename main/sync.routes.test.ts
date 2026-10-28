// @vitest-environment node
/**
 * Sync (main/sync.ts + /api/sync routes) — real HTTP + a real temp database,
 * with the cloud stood in by a plain SQLite file in the same temp dir:
 *
 *   - the "remote" the transport opens is that file,
 *   - the "replica" shared/db.ts opens IS that same file (a libsql replica
 *     shows the remote's rows and sends every write there, which is exactly
 *     what one shared file does), with a fake `sync()` that counts calls,
 *   - `isReachable` is a switch the tests flip to go offline.
 *
 * So nothing here needs a network or a Turso account; what the real replica
 * does on the wire was verified by hand against libsql-server (see
 * CLAUDE.md → "Sync"). The route contract test (api-server.routes.test.ts)
 * stays untouched: sync off must behave exactly as before.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import type { Server } from "http";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "finances-os-sync-test-"));
const tmpDb = path.join(tmpDir, "test.db");
const remoteDb = path.join(tmpDir, "cloud.db");
const replicaDb = path.join(tmpDir, "replica.db");
const settingsFile = path.join(tmpDir, "sync.json");
const HOST = "127.0.0.1:5858";
const CLOUD = { url: "libsql://budget-test.turso.io", token: "test-token-not-real" };

let server: Server;
let sync: typeof import("./sync");
let db: typeof import("../shared/db");
let libsql: typeof import("../shared/data/backends/libsql");
let reachable = true;
let syncCalls = 0;
let openCalls = 0;

const api = () => {
  const agent = request(server);
  return {
    get: (url: string) => agent.get(url).set("Host", HOST),
    post: (url: string) => agent.post(url).set("Host", HOST),
    patch: (url: string) => agent.patch(url).set("Host", HOST),
    delete: (url: string) => agent.delete(url).set("Host", HOST),
  };
};

/** A plain connection on the cloud file, as the transport's RemoteDatabase. */
function openCloudFile(): import("./sync").RemoteDatabase {
  const conn = libsql.openLibsql(remoteDb);
  return {
    exec: (sql, params) => conn.exec(sql, params),
    async batch(statements) {
      await conn.exec("BEGIN");
      try {
        for (const s of statements) await conn.exec(s.sql, s.args);
        await conn.exec("COMMIT");
      } catch (e) {
        await conn.exec("ROLLBACK");
        throw e;
      }
    },
    close: () => void conn.close(),
  };
}

/** Rows straight from the cloud file, bypassing the app. */
async function cloudRows(sql: string) {
  const conn = libsql.openLibsql(remoteDb);
  try {
    return await conn.exec(sql);
  } finally {
    await conn.close();
  }
}

beforeAll(async () => {
  const { createEmptyDatabase } = await import("../scripts/empty-db.mjs");
  createEmptyDatabase(tmpDb);
  process.env.FINANCES_OS_TEST_DB_URL = `file:${tmpDb.replace(/\\/g, "/")}`;

  db = await import("../shared/db");
  libsql = await import("../shared/data/backends/libsql");
  sync = await import("./sync");

  // The replica target opens the cloud file itself (see the file comment).
  db.__setConnectionOpenerForTests((target) => {
    const p = path.normalize(db.databaseUrlToPath(target.url));
    if (target.sync || p === path.normalize(replicaDb)) {
      openCalls++;
      // A marker so main/sync.ts sees "a replica exists" like the real file.
      if (!fs.existsSync(replicaDb)) fs.writeFileSync(replicaDb, "");
      const inner = libsql.openLibsql(remoteDb, { readOnly: target.readOnly });
      return {
        ...inner,
        replica: !!target.sync,
        async open() {
          if (target.sync && !reachable) throw new Error("tcp connect error: unreachable");
          await inner.open();
        },
        async sync() {
          if (!reachable) throw new Error("sync error: unreachable");
          syncCalls++;
        },
      };
    }
    return libsql.openLibsql(p, { readOnly: target.readOnly });
  });
  sync.__setSyncTransportForTests({
    openRemote: () => openCloudFile(),
    isReachable: async () => reachable,
  });

  const mod = await import("./api-server");
  server = mod.startServer(0);
});

afterAll(async () => {
  await sync.__resetSyncForTests();
  server?.close();
  await db.prisma.$disconnect();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  reachable = true;
  syncCalls = 0;
  openCalls = 0;
  // Every test starts local only, on an empty local database and no cloud file.
  if ((await api().get("/api/sandbox")).body.active) await api().post("/api/sandbox/discard");
  await sync.__resetSyncForTests();
  fs.rmSync(remoteDb, { force: true });
  fs.rmSync(replicaDb, { force: true });
  const tables: { name: string }[] = await db.prisma.$queryRawUnsafe(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'SchemaVersion'",
  );
  await db.prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
  for (const t of tables) await db.prisma.$executeRawUnsafe(`DELETE FROM "${t.name}"`);
  await db.prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  for (const f of fs.readdirSync(tmpDir).filter((f) => f.endsWith(".bak"))) fs.unlinkSync(path.join(tmpDir, f));
});

afterEach(async () => {
  if ((await api().get("/api/sandbox")).body.active) await api().post("/api/sandbox/discard");
});

const connect = (extra: Record<string, unknown> = {}) =>
  api().post("/api/sync/connect").send({ ...CLOUD, ...extra });

describe("local only (sync off)", () => {
  it("reports local, blocks nothing, and refuses sync-only actions", async () => {
    const status = (await api().get("/api/sync")).body;
    expect(status).toMatchObject({ configured: false, state: "local", url: null, writesBlocked: null, replicaPath: null });
    expect((await api().post("/api/sync/now")).status).toBe(409);
    expect((await api().post("/api/sync/disconnect")).status).toBe(409);
    expect((await api().post("/api/Bill").send({ name: "Local", amount: 1, dueDate: 1 })).status).toBe(200);
    expect(fs.existsSync(settingsFile)).toBe(false);
  });

  it("validates the URL and token before touching anything", async () => {
    expect((await connect({ url: "not a url" })).status).toBe(400);
    expect((await connect({ token: "" })).status).toBe(400);
    expect((await api().post("/api/sync/probe").send({ url: "ftp://x", token: "t" })).status).toBe(400);
    expect(fs.existsSync(remoteDb)).toBe(false);
  });

  it("says when the cloud can't be reached", async () => {
    reachable = false;
    const res = await connect();
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/can't be reached/);
    expect((await api().get("/api/sync")).body.configured).toBe(false);
  });
});

describe("connect", () => {
  it("uploads the local database into an empty cloud and switches to the replica", async () => {
    await api().post("/api/Bill").send({ name: "Uploaded", amount: 12, dueDate: 3 });
    const probe = await api().post("/api/sync/probe").send(CLOUD);
    expect(probe.status).toBe(200);
    expect(probe.body).toMatchObject({ empty: true, schemaVersion: 0, dataRows: 0, tables: 0 });

    const res = await connect();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, state: "synced", url: CLOUD.url, readOnly: false, writesBlocked: null });
    expect(res.body.lastSyncedAt).toBeTruthy();
    expect(syncCalls).toBe(1);

    // The cloud holds the schema + the row; the local file is untouched.
    expect(await cloudRows('SELECT name FROM "Bill"')).toEqual([{ name: "Uploaded" }]);
    expect(await cloudRows('SELECT version FROM "SchemaVersion"')).toEqual([{ version: 1 }]);
    const localConn = libsql.openLibsql(tmpDb);
    expect(await localConn.exec('SELECT name FROM "Bill"')).toEqual([{ name: "Uploaded" }]);
    await localConn.close();

    // Reads and writes now go through the replica (= the cloud).
    expect((await api().get("/api/Bill")).body.map((b: any) => b.name)).toEqual(["Uploaded"]);
    await api().post("/api/Bill").send({ name: "Via replica", amount: 5, dueDate: 9 });
    expect((await cloudRows('SELECT name FROM "Bill" ORDER BY name')).map((r) => r.name)).toEqual(["Uploaded", "Via replica"]);

    // Settings are saved beside the database — token in the plain fallback
    // (no safeStorage outside Electron), URL in clear.
    const saved = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    expect(saved.url).toBe(CLOUD.url);
    expect(saved.token).toEqual({ kind: "plain", data: CLOUD.token });
    expect((await api().get("/api/meta")).body.databasePath.replace(/\\/g, "/")).toBe(tmpDb.replace(/\\/g, "/"));
  });

  it("asks which side wins when the cloud already holds data", async () => {
    await api().post("/api/Bill").send({ name: "Mine", amount: 1, dueDate: 1 });
    // A cloud database another device already filled.
    const cloud = openCloudFile();
    const { loadStatements } = await import("../shared/data");
    const { dumpDatabase } = await import("../shared/data");
    const localDump = await dumpDatabase({ exec: (s, p) => db.getStore().raw(s, p) });
    const theirs = JSON.parse(JSON.stringify(localDump));
    const bills = theirs.tables.find((t: any) => t.table === "Bill");
    bills.rows[0][bills.columns.indexOf("name")] = "Theirs";
    await cloud.batch(loadStatements(theirs));
    cloud.close();

    const refused = await connect();
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("REMOTE_HAS_DATA");
    expect(refused.body.details).toMatchObject({ empty: false, dataRows: 1, schemaVersion: 1 });
    expect((await api().get("/api/sync")).body.configured).toBe(false);
    expect((await cloudRows('SELECT name FROM "Bill"'))).toEqual([{ name: "Theirs" }]);

    // "cloud": the cloud's rows win, the local file keeps its own as the before-sync copy.
    expect((await connect({ source: "cloud" })).status).toBe(200);
    expect((await api().get("/api/Bill")).body.map((b: any) => b.name)).toEqual(["Theirs"]);
    await sync.__resetSyncForTests();

    // "local": this device's rows replace the cloud's.
    expect((await connect({ source: "local" })).status).toBe(200);
    expect(await cloudRows('SELECT name FROM "Bill"')).toEqual([{ name: "Mine" }]);
  });

  it("refuses a cloud database made by a newer app", async () => {
    const cloud = openCloudFile();
    const { loadStatements, dumpDatabase, SCHEMA_VERSION } = await import("../shared/data");
    const dump = await dumpDatabase({ exec: (s, p) => db.getStore().raw(s, p) });
    const v = dump.tables.find((t) => t.table === "SchemaVersion")!;
    v.rows.push([SCHEMA_VERSION + 5, Date.now()]);
    await cloud.batch(loadStatements(dump));
    cloud.close();

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
    syncCalls = 0;
  });

  it("sync now pulls and stamps the time", async () => {
    const before = (await api().get("/api/sync")).body.lastSyncedAt;
    await new Promise((r) => setTimeout(r, 5));
    const res = await api().post("/api/sync/now");
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("synced");
    expect(syncCalls).toBe(1);
    expect(res.body.lastSyncedAt > before).toBe(true);
  });

  it("goes offline when the cloud stops answering, refuses writes meanwhile, and recovers", async () => {
    reachable = false;
    const res = await api().post("/api/sync/now");
    expect(res.status).toBe(502);
    const offline = (await api().get("/api/sync")).body;
    expect(offline).toMatchObject({ state: "offline", readOnly: false });
    expect(offline.writesBlocked).toMatch(/can.t be saved right now/);
    // Reads keep working on the open replica; a write is refused up front
    // (libsql would otherwise forward it to the dead host and block).
    expect((await api().get("/api/Bill")).status).toBe(200);
    const write = await api().post("/api/Bill").send({ name: "Nope", amount: 1, dueDate: 1 });
    expect(write.status).toBe(409);
    expect(write.body).toMatchObject({ code: "WRITES_BLOCKED" });
    expect(write.body.error).toMatch(/can't be saved right now/);
    expect(await cloudRows('SELECT name FROM "Bill"')).toEqual([{ name: "Seed" }]);

    reachable = true;
    // The probe before a write is cached for a few seconds, so the first write
    // after the cloud returns may still be refused — "Sync now" (a fresh
    // probe) or the next tick clears it.
    sync.__forgetReachabilityForTests();
    expect((await api().post("/api/Bill").send({ name: "Back", amount: 1, dueDate: 1 })).status).toBe(200);
    expect((await api().get("/api/sync")).body.state).toBe("synced");
    expect((await api().post("/api/sync/now")).body.state).toBe("synced");
  });

  it("falls back to a read-only replica when the cloud is unreachable at open time", async () => {
    // Entering and discarding a sandbox reopens the replica — offline.
    await api().post("/api/sandbox/enter");
    reachable = false;
    expect((await api().post("/api/sandbox/discard")).status).toBe(200);
    const status = (await api().get("/api/sync")).body;
    expect(status).toMatchObject({ configured: true, state: "offline", readOnly: true });
    expect(status.writesBlocked).toMatch(/read-only/);

    expect((await api().get("/api/Bill")).body.map((b: any) => b.name)).toEqual(["Seed"]);
    const write = await api().post("/api/Bill").send({ name: "Nope", amount: 1, dueDate: 1 });
    expect(write.status).toBe(409);
    expect(write.body.code).toBe("WRITES_BLOCKED");
    expect((await api().patch("/api/AppSettings/global").send({ wifeWeeklyTargetCents: 1 })).status).toBe(409);
    expect((await cloudRows('SELECT name FROM "Bill"'))).toEqual([{ name: "Seed" }]);

    // Back online: sync now reconnects the real replica and writes flow again.
    reachable = true;
    const back = await api().post("/api/sync/now");
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ state: "synced", readOnly: false, writesBlocked: null });
    expect((await api().post("/api/Bill").send({ name: "Now ok", amount: 1, dueDate: 1 })).status).toBe(200);
  });

  it("refuses to sync or write once the database is stamped by a newer app", async () => {
    const { SCHEMA_VERSION } = await import("../shared/data");
    const cloud = openCloudFile();
    await cloud.exec('INSERT INTO "SchemaVersion" ("version", "appliedAt") VALUES (?, ?)', [SCHEMA_VERSION + 1, Date.now()]);
    cloud.close();

    expect((await api().post("/api/sync/now")).body.state).toBe("blocked");
    const status = (await api().get("/api/sync")).body;
    expect(status.schemaGate).toEqual({ app: SCHEMA_VERSION, database: SCHEMA_VERSION + 1 });
    expect(status.writesBlocked).toMatch(/update the app/i);
    expect((await api().get("/api/Bill")).status).toBe(200);
    expect((await api().post("/api/Bill").send({ name: "No", amount: 1, dueDate: 1 })).status).toBe(409);
    expect((await api().delete("/api/Bill/whatever")).status).toBe(409);
    const again = await api().post("/api/sync/now");
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("SCHEMA_NEWER");
  });

  it("sandbox: pauses sync, Discard reopens the replica, Keep pushes the kept rows", async () => {
    const entered = await api().post("/api/sandbox/enter");
    expect(entered.status).toBe(200);
    expect((await api().get("/api/sync")).body.state).toBe("paused");
    expect((await api().post("/api/sync/now")).status).toBe(409);
    expect((await api().post("/api/sync/disconnect")).status).toBe(409);
    const sandboxFile = path.join(tmpDir, "sandbox.db");
    expect(fs.readFileSync(sandboxFile).subarray(0, 15).toString()).toBe("SQLite format 3");

    // Edits inside the sandbox never reach the cloud …
    await api().post("/api/Bill").send({ name: "Sandboxed", amount: 2, dueDate: 2 });
    expect(await cloudRows('SELECT name FROM "Bill"')).toEqual([{ name: "Seed" }]);
    // … and Discard forgets them.
    expect((await api().post("/api/sandbox/discard")).status).toBe(200);
    expect((await api().get("/api/sync")).body.state).toBe("synced");
    expect((await api().get("/api/Bill")).body.map((b: any) => b.name)).toEqual(["Seed"]);

    // Keep: the sandbox's rows replace the cloud's, with a .bak of the cloud's rows first.
    await api().post("/api/sandbox/enter");
    await api().post("/api/Bill").send({ name: "Kept", amount: 3, dueDate: 3 });
    const kept = await api().post("/api/sandbox/keep");
    expect(kept.status).toBe(200);
    expect(kept.body.backupPath).toMatch(/test\.db\..*\.bak$/);
    expect(fs.existsSync(kept.body.backupPath)).toBe(true);
    expect((await cloudRows('SELECT name FROM "Bill" ORDER BY name')).map((r) => r.name)).toEqual(["Kept", "Seed"]);
    expect((await api().get("/api/sync")).body.state).toBe("synced");
    expect((await api().get("/api/Bill")).body.map((b: any) => b.name).sort()).toEqual(["Kept", "Seed"]);
    expect(fs.existsSync(sandboxFile)).toBe(false);
  });

  it("Keep needs the cloud and leaves the sandbox active when it is away", async () => {
    await api().post("/api/sandbox/enter");
    reachable = false;
    const res = await api().post("/api/sandbox/keep");
    expect(res.status).toBe(502);
    expect((await api().get("/api/sandbox")).body.active).toBe(true);
    reachable = true;
    expect((await api().post("/api/sandbox/keep")).status).toBe(200);
  });

  it("backs up a replica through the data layer", async () => {
    const res = await api().post("/api/backups");
    expect(res.status).toBe(200);
    expect(res.body.method).toBe("dump");
    const bak = libsql.openLibsql(res.body.file);
    expect(await bak.exec('SELECT name FROM "Bill"')).toEqual([{ name: "Seed" }]);
    await bak.close();
  });

  it("disconnect keeps the cloud's rows as the local file and forgets the token", async () => {
    await api().post("/api/Bill").send({ name: "Cloud-only", amount: 4, dueDate: 4 });
    const res = await api().post("/api/sync/disconnect");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: false, state: "local" });
    expect(res.body.backupPath).toMatch(/test\.db\..*\.bak$/);
    expect(fs.existsSync(settingsFile)).toBe(false);
    expect(fs.existsSync(replicaDb)).toBe(false);
    expect((await api().get("/api/Bill")).body.map((b: any) => b.name).sort()).toEqual(["Cloud-only", "Seed"]);
    // The .bak is the local file from before ("Seed" only, uploaded at connect).
    const bak = libsql.openLibsql(res.body.backupPath);
    expect(await bak.exec('SELECT name FROM "Bill"')).toEqual([{ name: "Seed" }]);
    await bak.close();
    // Writes work locally again.
    expect((await api().post("/api/Bill").send({ name: "Local again", amount: 1, dueDate: 1 })).status).toBe(200);
    expect(await cloudRows('SELECT name FROM "Bill" ORDER BY name')).toEqual([{ name: "Cloud-only" }, { name: "Seed" }]);
  });

  it("initSync reopens the replica from the saved settings on the next start", async () => {
    // Simulate a restart: forget the in-memory state but keep sync.json.
    const saved = fs.readFileSync(settingsFile, "utf8");
    await sync.__resetSyncForTests();
    fs.writeFileSync(settingsFile, saved);
    openCalls = 0;
    const status = await sync.initSync();
    expect(status).toMatchObject({ configured: true, state: "synced", url: CLOUD.url });
    expect(openCalls).toBe(1);
    expect((await api().get("/api/Bill")).body.map((b: any) => b.name)).toEqual(["Seed"]);
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
    expect((await api().get("/api/Bill")).body.map((b: any) => b.name)).toEqual(["Exported"]);
  });

  it("refuses files that are not a database, or come from a newer app", async () => {
    expect((await importDb(Buffer.from("hello"))).status).toBe(400);
    expect((await api().post("/api/sync/import").send()).status).toBe(400);
    // A valid database stamped by a newer app.
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

  it("while synced, an import replaces the cloud's rows and an export reads the replica", async () => {
    await api().post("/api/Bill").send({ name: "Before", amount: 1, dueDate: 1 });
    const exported = (await exportDb()).body as Buffer;
    expect((await connect()).status).toBe(200);
    await api().post("/api/Bill").send({ name: "Cloud extra", amount: 2, dueDate: 2 });

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
    expect(await cloudRows('SELECT name FROM "Bill"')).toEqual([{ name: "Before" }]);
    expect((await api().get("/api/Bill")).body.map((b: any) => b.name)).toEqual(["Before"]);
  });

  it("neither works from inside a sandbox", async () => {
    await api().post("/api/sandbox/enter");
    expect((await exportDb()).status).toBe(409);
    expect((await importDb(Buffer.from("x"))).status).toBe(409);
  });
});
