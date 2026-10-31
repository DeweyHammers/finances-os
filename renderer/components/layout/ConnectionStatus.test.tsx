// @vitest-environment jsdom
/**
 * The sync status row (ConnectionStatus.tsx) while a sync is in flight on a
 * healthy connection: the WHOLE row becomes the syncing state — amber,
 * spinning arrows, "Syncing…" over "Sending and receiving changes" — and
 * goes back to green "Synced" over "Up to date with the cloud" once the
 * sync settles. Until Oct 31 2026 only the label changed, so the row read
 * "Syncing…" in green over Synced's detail line (user report).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { createElement } from "react";

vi.mock("../../lib/sync-api", () => ({
  fetchSyncStatus: vi.fn(),
  syncNow: vi.fn(),
}));

import { fetchSyncStatus, syncNow } from "../../lib/sync-api";
import {
  MIN_SPIN_MS,
  SyncStatusProvider,
  WRITE_SETTLE_MS,
  notifyLocalWrite,
} from "../../lib/use-connection-status";
import { ConnectionStatus } from "./ConnectionStatus";

// jsdom reports the computed border colour as rgba(r, g, b, a).
const AMBER = "rgba(251, 191, 36";
const GREEN = "rgba(61, 188, 131";

const synced = {
  configured: true,
  url: "libsql://example.test",
  state: "synced",
  lastSyncedAt: "2026-10-31T12:00:00.000Z",
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
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(fetchSyncStatus).mockReset().mockResolvedValue(synced as any);
  vi.mocked(syncNow).mockReset().mockResolvedValue(synced as any);
});

afterEach(() => {
  vi.useRealTimers();
});

async function mountRow() {
  const view = render(createElement(SyncStatusProvider, { intervalMs: 60_000, children: createElement(ConnectionStatus) }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return view;
}

/** The sider card's border carries the state's colour (`${color}55`). */
const cardColor = () => getComputedStyle(screen.getByTestId("sync-status")).borderColor;

describe("ConnectionStatus while a sync runs", () => {
  it("turns the whole row amber 'Syncing…' after a save, then back to green 'Synced'", async () => {
    await mountRow();
    expect(screen.getByText("Synced")).toBeTruthy();
    expect(screen.getByText("Up to date with the cloud")).toBeTruthy();
    expect(screen.queryByTestId("sync-spinner")).toBeNull();
    expect(cardColor()).toContain(GREEN);

    act(() => notifyLocalWrite());

    // Label, detail, colour and the arrows all say "syncing" — nothing of
    // the Synced state is left on the card.
    expect(screen.getByText("Syncing…")).toBeTruthy();
    expect(screen.getByText("Sending and receiving changes")).toBeTruthy();
    expect(screen.queryByText("Up to date with the cloud")).toBeNull();
    expect(screen.getByTestId("sync-spinner")).toBeTruthy();
    expect(cardColor()).toContain(AMBER);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WRITE_SETTLE_MS + MIN_SPIN_MS);
    });
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Synced")).toBeTruthy();
    expect(screen.getByText("Up to date with the cloud")).toBeTruthy();
    expect(screen.queryByTestId("sync-spinner")).toBeNull();
    expect(cardColor()).toContain(GREEN);
  });

  it("the server's own pull reads the same way", async () => {
    vi.mocked(fetchSyncStatus).mockResolvedValue({ ...synced, state: "syncing", syncing: true } as any);
    await mountRow();
    expect(screen.getByText("Syncing…")).toBeTruthy();
    expect(screen.getByText("Sending and receiving changes")).toBeTruthy();
    expect(screen.queryByText("Up to date with the cloud")).toBeNull();
    expect(screen.getByTestId("sync-spinner")).toBeTruthy();
  });

  it("offline keeps its own label and detail while a sync is attempted", async () => {
    vi.mocked(fetchSyncStatus).mockResolvedValue({ ...synced, state: "offline", pendingChanges: 2 } as any);
    await mountRow();
    act(() => notifyLocalWrite());
    expect(screen.getByText("Offline")).toBeTruthy();
    expect(screen.getByText("2 changes waiting")).toBeTruthy();
    expect(screen.getByTestId("sync-spinner")).toBeTruthy();
  });
});
