// @vitest-environment node
/**
 * /api/updates routes (main/api-server.ts → main/updates.ts) over real HTTP
 * with a fake engine, the way the Settings page drives them. The route
 * contract test (api-server.routes.test.ts) stays untouched: with no engine
 * wired, a check still answers through the old GitHub lookup and the rest
 * is a 409.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import type { Server } from "http";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "finances-os-updates-test-"));
const tmpDb = path.join(tmpDir, "test.db");
const HOST = "127.0.0.1:5858";

let server: Server;
let updates: typeof import("./updates");
let db: typeof import("../shared/db");

const api = () => {
  const agent = request(server);
  return {
    get: (url: string) => agent.get(url).set("Host", HOST),
    post: (url: string) => agent.post(url).set("Host", HOST),
  };
};

/** The smallest engine the routes need; the download finishes on demand. */
function fakeEngine(latest = "99.0.0") {
  let finish: (() => void) | null = null;
  const installs: unknown[][] = [];
  const progressListeners: Array<(p: unknown) => void> = [];
  return {
    installs,
    emitProgress: (p: unknown) => progressListeners.forEach((l) => l(p)),
    finishDownload: () => finish?.(),
    checkForUpdates: async () => ({ isUpdateAvailable: true, updateInfo: { version: latest } }),
    downloadUpdate: () => new Promise<void>((r) => (finish = r)),
    quitAndInstall: (...a: unknown[]) => void installs.push(a),
    on(event: string, l: (p: unknown) => void) {
      if (event === "download-progress") progressListeners.push(l);
      return this;
    },
  };
}

beforeAll(async () => {
  const { createEmptyDatabase } = await import("../scripts/empty-db.mjs");
  createEmptyDatabase(tmpDb);
  process.env.FINANCES_OS_TEST_DB_URL = `file:${tmpDb.replace(/\\/g, "/")}`;
  const mod = await import("./api-server");
  updates = await import("./updates");
  db = await import("../shared/db");
  server = mod.startServer(0);
});

afterAll(async () => {
  server?.close();
  await db?.prisma.$disconnect();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => updates.resetUpdatesForTests());

describe("in-app updates (/api/updates)", () => {
  it("GET status is not shadowed by /api/:resource and reports an unsupported build", async () => {
    const res = await api().get("/api/updates/status");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ supported: false, state: "idle", latest: null });
    expect(res.body.releaseUrl).toContain("github.com");
  });

  it("download / install are 409 UPDATER_UNAVAILABLE without an engine", async () => {
    const dl = await api().post("/api/updates/download");
    expect(dl.status).toBe(409);
    expect(dl.body).toMatchObject({ code: "UPDATER_UNAVAILABLE" });
    expect(dl.body.message).toBe(dl.body.error);
    expect((await api().post("/api/updates/install")).status).toBe(409);
    expect((await api().post("/api/updates/nonsense")).status).toBe(404);
  });

  it("status carries the install block and download is 409 INSTALL_BLOCKED with the message", async () => {
    updates.registerUpdateEngine({
      async checkForUpdates() {
        return { isUpdateAvailable: true, updateInfo: { version: "9.9.9" } };
      },
      downloadUpdate: () => Promise.resolve(),
      quitAndInstall() {},
      on() {},
    });
    updates.setInstallBlock({ code: "SMART_APP_CONTROL", message: "Smart App Control is on for this PC." });
    const chk = await api().post("/api/updates/check");
    expect(chk.status).toBe(200);
    expect(chk.body).toMatchObject({ supported: true, state: "available", installBlocked: { code: "SMART_APP_CONTROL" } });
    const dl = await api().post("/api/updates/download");
    expect(dl.status).toBe(409);
    expect(dl.body).toMatchObject({ code: "INSTALL_BLOCKED", message: "Smart App Control is on for this PC." });
  });

  it("walks check → download → progress → downloaded → install with an engine", async () => {
    const engine = fakeEngine("99.0.0");
    updates.registerUpdateEngine(engine);

    const checked = await api().post("/api/updates/check");
    expect(checked.status).toBe(200);
    expect(checked.body).toMatchObject({ supported: true, state: "available", latest: "99.0.0" });

    // Install before download: a wrong-state 409, not a crash.
    const early = await api().post("/api/updates/install");
    expect(early.status).toBe(409);
    expect(early.body.code).toBe("WRONG_STATE");

    const dl = await api().post("/api/updates/download");
    expect(dl.status).toBe(200);
    expect(dl.body.state).toBe("downloading");

    engine.emitProgress({ percent: 50, transferred: 60, total: 120, bytesPerSecond: 10 });
    expect((await api().get("/api/updates/status")).body.progress).toMatchObject({ percent: 50, transferred: 60, total: 120 });

    engine.finishDownload();
    await updates.awaitPendingUpdateWorkForTests();
    expect((await api().get("/api/updates/status")).body).toMatchObject({ state: "downloaded", progress: null });

    const inst = await api().post("/api/updates/install");
    expect(inst.status).toBe(200);
    expect(inst.body.state).toBe("installing");
    // The response is out before the app quits.
    expect(engine.installs).toEqual([]);
    await updates.awaitPendingUpdateWorkForTests();
    expect(engine.installs).toEqual([[true, true]]);
  });
});
