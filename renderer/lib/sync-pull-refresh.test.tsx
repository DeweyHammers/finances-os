// @vitest-environment jsdom
/**
 * SyncPullRefresh (lib/sync-pull-refresh.tsx): the page's data is reloaded
 * when — and only when — the sync status reports that a sync brought in
 * another device's changes (`remoteChanges` rose). The server and Refine are
 * mocked; the real poller (SyncStatusProvider) carries the status.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { createElement } from "react";

vi.mock("./sync-api", () => ({
  fetchSyncStatus: vi.fn(),
  syncNow: vi.fn(),
}));

const invalidate = vi.fn(async (_args: unknown) => {});
vi.mock("@refinedev/core", () => ({
  // A NEW function per render, like Refine's own hook: the component must
  // not re-run (or miss a run) because of that.
  useInvalidate: () => (args: unknown) => invalidate(args),
}));

import { fetchSyncStatus, syncNow } from "./sync-api";
import {
  SyncStatusProvider,
  __resetConnectionStatusForTests,
  useConnectionStatus,
  type ConnectionStatus,
} from "./use-connection-status";
import { SyncPullRefresh } from "./sync-pull-refresh";

const status = (over: Record<string, unknown> = {}) => ({
  configured: true,
  url: "libsql://example.test",
  state: "synced",
  lastSyncedAt: "2026-11-09T12:00:00.000Z",
  lastError: null,
  syncing: false,
  pausedBy: null,
  schemaGate: null,
  readOnly: false,
  writesBlocked: null,
  pendingChanges: 0,
  pendingPush: false,
  conflict: null,
  remoteChanges: 0,
  replicaPath: "replica.db",
  appSchemaVersion: 1,
  ...over,
});

/** The poller's handle, so a test can make it re-read the status. */
let connection: ConnectionStatus;
function Probe(): null {
  connection = useConnectionStatus();
  return null;
}

async function mountWith(first: ReturnType<typeof status>) {
  vi.mocked(fetchSyncStatus).mockResolvedValue(first as any);
  vi.mocked(syncNow).mockResolvedValue(first as any);
  const view = render(
    createElement(SyncStatusProvider, { intervalMs: 60_000, children: [createElement(SyncPullRefresh, { key: "r" }), createElement(Probe, { key: "p" })] }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return view;
}

/** The next status the server reports, read by the poller right now. */
async function serverReports(next: ReturnType<typeof status>) {
  vi.mocked(fetchSyncStatus).mockResolvedValue(next as any);
  await act(async () => {
    await connection.refresh();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(fetchSyncStatus).mockReset();
  vi.mocked(syncNow).mockReset();
  invalidate.mockClear();
  // Each test's provider starts with no status, like a freshly loaded window.
  __resetConnectionStatusForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SyncPullRefresh", () => {
  it("only remembers the first value: the page loaded its data after it", async () => {
    await mountWith(status({ remoteChanges: 3 }));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("reloads every active query when a sync pulled another device's changes", async () => {
    await mountWith(status({ remoteChanges: 3 }));
    await serverReports(status({ remoteChanges: 4 }));
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ invalidates: ["all"] });

    // Two pulls between two polls are still one reload.
    await serverReports(status({ remoteChanges: 6 }));
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("stays quiet while the counter does not move: this PC's own saves, pushes, empty syncs", async () => {
    await mountWith(status({ remoteChanges: 2 }));
    await serverReports(status({ remoteChanges: 2, pendingChanges: 5, pendingPush: true }));
    await serverReports(status({ remoteChanges: 2, state: "syncing", syncing: true }));
    await serverReports(status({ remoteChanges: 2, lastSyncedAt: "2026-11-09T12:05:00.000Z" }));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("a counter that went DOWN (the API restarted) is adopted without a reload, and counts from there", async () => {
    await mountWith(status({ remoteChanges: 5 }));
    await serverReports(status({ remoteChanges: 0 }));
    expect(invalidate).not.toHaveBeenCalled();
    await serverReports(status({ remoteChanges: 1 }));
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("the sync the focus handler asks for reloads the page from its own answer", async () => {
    await mountWith(status({ remoteChanges: 0 }));
    vi.mocked(syncNow).mockResolvedValue(status({ remoteChanges: 1 }) as any);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("does nothing on a local-only install", async () => {
    await mountWith(status({ configured: false, state: "local", remoteChanges: 0 }));
    await serverReports(status({ configured: false, state: "local", remoteChanges: 0 }));
    expect(invalidate).not.toHaveBeenCalled();
  });
});
