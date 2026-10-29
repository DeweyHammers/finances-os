// @vitest-environment node
/**
 * In-app updates (main/updates.ts) — the state machine behind Settings →
 * General, driven with a FAKE engine (the shape of electron-updater's
 * autoUpdater) and generic versions. Nothing here touches the network,
 * Electron or GitHub.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  INSTALL_DELAY_MS,
  awaitPendingUpdateWorkForTests,
  checkForUpdate,
  downloadUpdate,
  getUpdateStatus,
  installUpdate,
  registerUpdateEngine,
  resetUpdatesForTests,
  setInstallBlock,
  type UpdateEngine,
  type UpdateProgress,
} from "./updates";
import { readVersion } from "./meta";

/** A controllable stand-in for electron-updater's autoUpdater. */
function fakeEngine(opts: { latest?: string; available?: boolean; checkError?: string; downloadError?: string } = {}) {
  const listeners: Record<string, Array<(...a: any[]) => void>> = {};
  let resolveDownload: (() => void) | null = null;
  let rejectDownload: ((e: Error) => void) | null = null;
  const calls = { check: 0, download: 0, install: [] as Array<[boolean?, boolean?]> };
  const engine: UpdateEngine & {
    calls: typeof calls;
    progress: (p: UpdateProgress) => void;
    finishDownload: () => void;
    failDownload: (msg: string) => void;
  } = {
    calls,
    async checkForUpdates() {
      calls.check++;
      if (opts.checkError) throw new Error(opts.checkError);
      return {
        isUpdateAvailable: opts.available ?? true,
        updateInfo: { version: opts.latest ?? "99.0.0", releaseDate: "2026-10-28T00:00:00.000Z" },
      };
    },
    downloadUpdate() {
      calls.download++;
      if (opts.downloadError) return Promise.reject(new Error(opts.downloadError));
      return new Promise<void>((resolve, reject) => {
        resolveDownload = resolve;
        rejectDownload = reject;
      });
    },
    quitAndInstall(isSilent, isForceRunAfter) {
      calls.install.push([isSilent, isForceRunAfter]);
    },
    on(event: string, listener: (...a: any[]) => void) {
      (listeners[event] ??= []).push(listener);
      return engine;
    },
    progress: (p) => listeners["download-progress"]?.forEach((l) => l(p)),
    finishDownload: () => resolveDownload?.(),
    failDownload: (msg) => rejectDownload?.(new Error(msg)),
  };
  return engine;
}

/** A fake `fetch` for the no-engine GitHub fallback (main/meta.ts). */
const githubSays = (tag: string) =>
  (async () => ({ ok: true, status: 200, json: async () => ({ tag_name: tag, html_url: "https://example.test/rel" }) })) as unknown as typeof fetch;

beforeEach(() => {
  resetUpdatesForTests();
});

describe("without an engine (dev / hosted / tests)", () => {
  it("reports unsupported + idle with the running version and the Release page", () => {
    const s = getUpdateStatus();
    expect(s).toMatchObject({ supported: false, state: "idle", latest: null, progress: null, error: null, checkedAt: null });
    expect(s.current).toBe(readVersion());
    expect(s.releaseUrl).toContain("github.com");
  });

  it("check falls back to the GitHub API lookup and reports available / up to date", async () => {
    const newer = await checkForUpdate({ fetchImpl: githubSays("v99.0.0") });
    expect(newer).toMatchObject({ supported: false, state: "available", latest: "99.0.0" });
    expect(newer.checkedAt).toBeTruthy();

    resetUpdatesForTests();
    const same = await checkForUpdate({ fetchImpl: githubSays(`v${readVersion()}`) });
    expect(same.state).toBe("up-to-date");
  });

  it("a failed check lands in state error with the message", async () => {
    const failing = (async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch;
    const s = await checkForUpdate({ fetchImpl: failing });
    expect(s.state).toBe("error");
    expect(s.error).toContain("503");
  });

  it("download and install are refused with UPDATER_UNAVAILABLE", async () => {
    await checkForUpdate({ fetchImpl: githubSays("v99.0.0") });
    expect(() => downloadUpdate()).toThrow(expect.objectContaining({ status: 409, code: "UPDATER_UNAVAILABLE" }));
    expect(() => installUpdate()).toThrow(expect.objectContaining({ status: 409, code: "UPDATER_UNAVAILABLE" }));
  });
});

describe("with an engine (installed app)", () => {
  it("check → available → download (with progress) → downloaded → install", async () => {
    const engine = fakeEngine({ latest: "99.0.0" });
    registerUpdateEngine(engine);
    expect(getUpdateStatus()).toMatchObject({ supported: true, state: "idle" });

    const checked = await checkForUpdate();
    expect(checked).toMatchObject({ state: "available", latest: "99.0.0", releaseDate: "2026-10-28T00:00:00.000Z" });
    expect(engine.calls.check).toBe(1);

    const started = downloadUpdate();
    expect(started.state).toBe("downloading");
    expect(started.progress).toEqual({ percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 });
    expect(engine.calls.download).toBe(1);

    engine.progress({ percent: 42.4, transferred: 52_000_000, total: 123_000_000, bytesPerSecond: 9_000_000 });
    expect(getUpdateStatus().progress).toMatchObject({ percent: 42.4, transferred: 52_000_000, total: 123_000_000 });

    engine.finishDownload();
    await awaitPendingUpdateWorkForTests();
    expect(getUpdateStatus()).toMatchObject({ state: "downloaded", progress: null, latest: "99.0.0" });

    vi.useFakeTimers();
    try {
      expect(installUpdate().state).toBe("installing");
      // Not yet: the HTTP response gets out first.
      expect(engine.calls.install).toEqual([]);
      await vi.advanceTimersByTimeAsync(INSTALL_DELAY_MS);
      // Silent install, relaunch afterwards.
      expect(engine.calls.install).toEqual([[true, true]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("up to date when the engine says so", async () => {
    registerUpdateEngine(fakeEngine({ latest: "1.0.0", available: false }));
    const s = await checkForUpdate();
    expect(s).toMatchObject({ state: "up-to-date", latest: "1.0.0" });
    expect(() => downloadUpdate()).toThrow(expect.objectContaining({ status: 409, code: "WRONG_STATE" }));
  });

  it("wrong-state calls are refused, repeats are idempotent", async () => {
    const engine = fakeEngine();
    registerUpdateEngine(engine);
    expect(() => downloadUpdate()).toThrow("Check for updates first");
    expect(() => installUpdate()).toThrow("Download the update first");

    await checkForUpdate();
    downloadUpdate();
    // A second click while downloading changes nothing.
    expect(downloadUpdate().state).toBe("downloading");
    expect(engine.calls.download).toBe(1);
    // A check while downloading is left alone too.
    expect((await checkForUpdate()).state).toBe("downloading");
    expect(engine.calls.check).toBe(1);
    expect(() => installUpdate()).toThrow("Download the update first");

    engine.finishDownload();
    await awaitPendingUpdateWorkForTests();
    expect((await checkForUpdate()).state).toBe("downloaded");
  });

  it("two overlapping checks share one engine call", async () => {
    const engine = fakeEngine();
    registerUpdateEngine(engine);
    const [a, b] = await Promise.all([checkForUpdate(), checkForUpdate()]);
    expect(a.state).toBe("available");
    expect(b).toEqual(a);
    expect(engine.calls.check).toBe(1);
  });

  it("a failed download is reported and keeps the release for the manual link", async () => {
    const engine = fakeEngine({ latest: "99.0.0" });
    registerUpdateEngine(engine);
    await checkForUpdate();
    downloadUpdate();
    engine.failDownload("sha512 checksum mismatch");
    await awaitPendingUpdateWorkForTests();
    expect(getUpdateStatus()).toMatchObject({ state: "error", error: "sha512 checksum mismatch", latest: "99.0.0", progress: null });
    // The user can try again from a fresh check.
    expect((await checkForUpdate()).state).toBe("available");
  });

  it("a failed check reports the error; a SILENT failed check goes back to idle", async () => {
    registerUpdateEngine(fakeEngine({ checkError: "net::ERR_INTERNET_DISCONNECTED" }));
    expect(await checkForUpdate()).toMatchObject({ state: "error", error: "net::ERR_INTERNET_DISCONNECTED" });

    resetUpdatesForTests();
    registerUpdateEngine(fakeEngine({ checkError: "offline" }));
    expect(await checkForUpdate({ silent: true })).toMatchObject({ state: "idle", error: null });
  });

  it("a silent check that succeeds keeps its result", async () => {
    registerUpdateEngine(fakeEngine({ latest: "99.0.0" }));
    expect(await checkForUpdate({ silent: true })).toMatchObject({ state: "available", latest: "99.0.0" });
  });

  it("an install block (Smart App Control) keeps the check and refuses download / install", async () => {
    const engine = fakeEngine({ latest: "9.9.9" });
    registerUpdateEngine(engine);
    setInstallBlock({ code: "SMART_APP_CONTROL", message: "Smart App Control is on for this PC." });
    // The row still learns that a release exists…
    const s = await checkForUpdate();
    expect(s).toMatchObject({ supported: true, state: "available", latest: "9.9.9" });
    expect(s.installBlocked).toEqual({ code: "SMART_APP_CONTROL", message: "Smart App Control is on for this PC." });
    // …but nothing is downloaded or installed: the app would quit for nothing.
    expect(() => downloadUpdate()).toThrowError(expect.objectContaining({ status: 409, code: "INSTALL_BLOCKED" }));
    expect(() => installUpdate()).toThrowError(expect.objectContaining({ status: 409, code: "INSTALL_BLOCKED" }));
    expect(engine.calls.download).toBe(0);
    expect(engine.calls.install).toEqual([]);
    expect(getUpdateStatus().state).toBe("available");
    // Clearing the block restores the normal path.
    setInstallBlock(null);
    expect(getUpdateStatus().installBlocked).toBeNull();
    expect(downloadUpdate().state).toBe("downloading");
  });

  it("an install block is not reported without an engine (dev / hosted: unsupported already)", () => {
    setInstallBlock({ code: "SMART_APP_CONTROL", message: "x" });
    expect(getUpdateStatus()).toMatchObject({ supported: false, installBlocked: null });
  });

  it("falls back to a version compare when the engine gives no isUpdateAvailable", async () => {
    const engine = fakeEngine();
    engine.checkForUpdates = async () => ({ updateInfo: { version: "0.0.1" } });
    registerUpdateEngine(engine);
    expect((await checkForUpdate()).state).toBe("up-to-date");
  });
});
