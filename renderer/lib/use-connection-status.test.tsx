// @vitest-environment jsdom
/**
 * The sync indicator's reaction to saves (lib/use-connection-status.ts):
 * writes report through notifyLocalWrite, the arrows spin at once, a burst
 * collapses into ONE "sync now" after the quiet period, a write during that
 * sync queues exactly one more, and the spin lasts at least MIN_SPIN_MS.
 * The server is mocked; nothing here touches the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";

vi.mock("./sync-api", () => ({
  fetchSyncStatus: vi.fn(),
  syncNow: vi.fn(),
}));

import { fetchSyncStatus, syncNow } from "./sync-api";
import {
  MIN_SPIN_MS,
  SyncStatusProvider,
  WRITE_SETTLE_MS,
  notifyLocalWrite,
  useConnectionStatus,
  withSyncWriteNotices,
} from "./use-connection-status";

const status = (over: Record<string, unknown> = {}) => ({
  configured: true,
  url: "libsql://example.test",
  state: "synced",
  lastSyncedAt: "2026-10-29T12:00:00.000Z",
  lastError: null,
  syncing: false,
  pausedBy: null,
  schemaGate: null,
  readOnly: false,
  writesBlocked: null,
  pendingChanges: 0,
  pendingPush: false,
  conflict: null,
  replicaPath: "replica.db",
  appSchemaVersion: 1,
  ...over,
});

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(SyncStatusProvider, { intervalMs: 60_000, children });

async function mountWith(first: ReturnType<typeof status>) {
  vi.mocked(fetchSyncStatus).mockResolvedValue(first as any);
  vi.mocked(syncNow).mockResolvedValue(first as any);
  const hook = renderHook(() => useConnectionStatus(), { wrapper });
  // Let the mount-time status fetch land.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return hook;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(fetchSyncStatus).mockReset();
  vi.mocked(syncNow).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("saves → spinning arrows → one confirming sync", () => {
  it("collapses a burst of writes into one sync after the quiet period", async () => {
    const hook = await mountWith(status());
    expect(hook.result.current.configured).toBe(true);
    expect(hook.result.current.syncing).toBe(false);

    act(() => {
      notifyLocalWrite();
      notifyLocalWrite();
      notifyLocalWrite();
    });
    // Spinning at once, nothing asked of the server yet.
    expect(hook.result.current.syncing).toBe(true);
    expect(syncNow).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WRITE_SETTLE_MS);
    });
    expect(syncNow).toHaveBeenCalledTimes(1);

    // The sync answered instantly, but the arrows stay up for MIN_SPIN_MS.
    expect(hook.result.current.syncing).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIN_SPIN_MS);
    });
    expect(hook.result.current.syncing).toBe(false);
    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it("a write that lands during the sync queues exactly one more", async () => {
    const hook = await mountWith(status());
    let finishFirst!: () => void;
    vi.mocked(syncNow)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = () => resolve(status() as any);
          }),
      )
      .mockResolvedValue(status() as any);

    act(() => notifyLocalWrite());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WRITE_SETTLE_MS);
    });
    expect(syncNow).toHaveBeenCalledTimes(1);

    // Two more writes while the first sync is still running …
    act(() => {
      notifyLocalWrite();
      notifyLocalWrite();
    });
    await act(async () => {
      finishFirst();
      await vi.advanceTimersByTimeAsync(0);
    });
    // … become one follow-up sync, not two.
    expect(syncNow).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIN_SPIN_MS);
    });
    expect(hook.result.current.syncing).toBe(false);
  });

  it("does nothing on a local-only install", async () => {
    const hook = await mountWith(status({ configured: false, state: "local" }));
    act(() => notifyLocalWrite());
    expect(hook.result.current.syncing).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WRITE_SETTLE_MS + MIN_SPIN_MS);
    });
    expect(syncNow).not.toHaveBeenCalled();
  });

  it("the server's own pull also shows as syncing", async () => {
    const hook = await mountWith(status({ state: "syncing", syncing: true }));
    expect(hook.result.current.syncing).toBe(true);
  });
});

describe("withSyncWriteNotices", () => {
  it("reports after every write and leaves reads alone", async () => {
    const hook = await mountWith(status());
    const calls: string[] = [];
    const provider: any = {
      getList: async () => (calls.push("getList"), { data: [], total: 0 }),
      getOne: async () => (calls.push("getOne"), { data: {} }),
      create: async () => (calls.push("create"), { data: { id: 1 } }),
      update: async () => (calls.push("update"), { data: { id: 1 } }),
      deleteOne: async () => (calls.push("deleteOne"), { data: { id: 1 } }),
      getApiUrl: () => "http://x",
    };
    const wrapped: any = withSyncWriteNotices(provider);

    await act(async () => {
      await wrapped.getList({ resource: "Bill" });
      await wrapped.getOne({ resource: "Bill", id: 1 });
    });
    expect(hook.result.current.syncing).toBe(false);

    await act(async () => {
      await wrapped.create({ resource: "Bill", variables: {} });
    });
    expect(hook.result.current.syncing).toBe(true);
    expect(calls).toEqual(["getList", "getOne", "create"]);
    // The original's result comes back untouched.
    expect(await wrapped.update({ resource: "Bill", id: 1, variables: {} })).toEqual({ data: { id: 1 } });
    expect(wrapped.getApiUrl()).toBe("http://x");
  });
});
