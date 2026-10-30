"use client";

/**
 * Sync status for the whole renderer — the "sync icon" of
 * plans/phone-app-and-sync.md, modelled on Obsidian's.
 *
 * One poller (`SyncStatusProvider`, mounted in app/providers.tsx) asks
 * `GET /api/sync` every `intervalMs`, immediately on mount, when the tab
 * becomes visible again and on the browser's online/offline events (an
 * `online` event also asks the server to sync right away). The sider row
 * above Settings and the Connection row in Settings → Phone & sync both read
 * it through `useConnectionStatus()`, so they can never disagree.
 *
 * A local-only install (`configured: false`) shows nothing: there is nothing
 * to be connected TO, so no "Connected" and no red light either (user
 * decision, Oct 27 2026). Once a cloud database is set up the states are
 * synced / syncing / offline (read-write, with the changes waiting to be
 * pushed) / paused (sandbox) / blocked (the database is newer than this
 * app) / conflict (the cloud changed while this PC had unpushed changes —
 * settled in Settings → Phone & sync). The last known state is kept while a
 * check is in flight so the dot never flickers between colours on every poll.
 *
 * Saves show up in the icon (user request, Oct 29 2026). Every write the
 * renderer makes goes through Refine's data provider, which app/providers.tsx
 * wraps with `withSyncWriteNotices`: after a create / update / delete
 * resolves it calls `notifyLocalWrite()`. The poller then shows `syncing`
 * (spinning arrows in the dot) and, once the writes go quiet for
 * WRITE_SETTLE_MS, asks the server to sync now — since Oct 29 2026 that is
 * the PUSH of the save to the cloud (writes are local first), ahead of the
 * server's own 3 s timer. Bursts
 * (Optimize writes hundreds of rows) collapse into one sync; a write that
 * lands during the sync queues exactly one more. The arrows stay at least
 * MIN_SPIN_MS so a fast sync is still visible as a flick.
 */
import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { DataProvider } from "@refinedev/core";
import { fetchSyncStatus, syncNow, type SyncState, type SyncStatus } from "./sync-api";

export type { SyncState, SyncStatus };

export interface ConnectionStatus {
  /** A cloud database is set up on this device. False = local only. */
  configured: boolean;
  /** "unknown" until the first answer; then the server's state. */
  state: SyncState | "unknown";
  /** The server's full answer, null until the first one. */
  status: SyncStatus | null;
  /** A status check (the cheap GET) is in flight right now. */
  checking: boolean;
  /**
   * A sync is in flight: after a save (see notifyLocalWrite), from the dot's
   * click, or the server's own pull. The dot shows spinning arrows.
   */
  syncing: boolean;
  /** The server could not be reached at all (not the cloud — the app's own API). */
  apiDown: boolean;
  /** When the cloud was last synced. */
  lastSyncedAt: Date | null;
  /** The server's last sync error, null after a success. */
  lastError: string | null;
  /** Re-read the status (cheap). */
  refresh: () => Promise<void>;
  /** Ask the server to sync now, then re-read (the indicator's dot does this). */
  syncNow: () => Promise<void>;
  /** Hand a status the caller just received (connect / disconnect) to everyone. */
  apply: (status: SyncStatus) => void;
}

const PING_TIMEOUT_MS = 5000;
/** How long writes must go quiet before the one sync that confirms them. */
export const WRITE_SETTLE_MS = 400;
/** The arrows spin at least this long after a save, so a fast sync still shows. */
export const MIN_SPIN_MS = 700;

let latest: SyncStatus | null = null;

/** The mounted poller's write handler (null when no provider is mounted). */
let writeHandler: (() => void) | null = null;

/**
 * Tell the sync indicator that this device just wrote something. Called by
 * the data-provider wrapper below after every successful create / update /
 * delete; harmless on a local-only install (the poller ignores it).
 */
export function notifyLocalWrite(): void {
  writeHandler?.();
}

/**
 * Wrap Refine's data provider so every successful write reports to the sync
 * indicator. Reads are untouched. Applied once in app/providers.tsx.
 */
export function withSyncWriteNotices(provider: DataProvider): DataProvider {
  const writes = ["create", "createMany", "update", "updateMany", "deleteOne", "deleteMany"] as const;
  const wrapped: DataProvider = { ...provider };
  for (const name of writes) {
    const original = (provider as any)[name];
    if (typeof original !== "function") continue;
    (wrapped as any)[name] = async (...args: unknown[]) => {
      const result = await original.apply(provider, args);
      notifyLocalWrite();
      return result;
    };
  }
  return wrapped;
}

/**
 * Whether a cloud database is configured on this device, from the last
 * status the poller received (false until the first answer).
 */
export function isSyncConfigured(): boolean {
  return latest?.configured ?? false;
}

const noop = async () => {};
const ConnectionContext = createContext<ConnectionStatus>({
  configured: false,
  state: "unknown",
  status: null,
  checking: false,
  syncing: false,
  apiDown: false,
  lastSyncedAt: null,
  lastError: null,
  refresh: noop,
  syncNow: noop,
  apply: () => {},
});

function useSyncPoller(intervalMs: number): ConnectionStatus {
  const [status, setStatus] = useState<SyncStatus | null>(latest);
  const [checking, setChecking] = useState(false);
  const [apiDown, setApiDown] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  const apply = useCallback((next: SyncStatus) => {
    latest = next;
    setStatus(next);
    setApiDown(false);
  }, []);

  const refresh = useCallback(async () => {
    // One check at a time; a forced refresh cancels the previous one.
    inFlight.current?.abort();
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
    setChecking(true);
    try {
      const next = await fetchSyncStatus(ctrl.signal);
      if (ctrl.signal.aborted) return;
      apply(next);
    } catch {
      if (ctrl.signal.aborted && inFlight.current !== ctrl) return; // superseded
      setApiDown(true);
    } finally {
      clearTimeout(timer);
      if (inFlight.current === ctrl) {
        inFlight.current = null;
        setChecking(false);
      }
    }
  }, [apply]);

  const [syncing, setSyncing] = useState(false);
  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      apply(await syncNow());
    } catch {
      // The failure is in the status the server keeps; show that.
      await refresh();
    } finally {
      setSyncing(false);
    }
  }, [apply, refresh]);

  // ── Saves → spinning arrows → one confirming sync ──
  // `settle` is the quiet-period timer; `running` means a post-write sync is
  // in flight; `again` records a write that landed during it, so exactly one
  // more sync follows. The spin shows from the first write until the last
  // sync finishes and at least MIN_SPIN_MS have passed.
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef(false);
  const again = useRef(false);
  const spinSince = useRef(0);
  const noteWrite = useCallback(() => {
    if (!latest?.configured) return; // local only: nothing to sync
    if (!spinSince.current) spinSince.current = Date.now();
    setSyncing(true);
    if (running.current) {
      again.current = true;
      return;
    }
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(async () => {
      settle.current = null;
      running.current = true;
      try {
        do {
          again.current = false;
          try {
            apply(await syncNow());
          } catch {
            await refresh();
          }
        } while (again.current);
      } finally {
        running.current = false;
        const left = MIN_SPIN_MS - (Date.now() - spinSince.current);
        spinSince.current = 0;
        if (left > 0) await new Promise((r) => setTimeout(r, left));
        setSyncing(false);
      }
    }, WRITE_SETTLE_MS);
  }, [apply, refresh]);
  useEffect(() => {
    writeHandler = noteWrite;
    return () => {
      if (writeHandler === noteWrite) writeHandler = null;
      if (settle.current) clearTimeout(settle.current);
    };
  }, [noteWrite]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const onOnline = () => void sync();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      inFlight.current?.abort();
    };
  }, [refresh, sync, intervalMs]);

  return {
    configured: status?.configured ?? false,
    state: status?.state ?? "unknown",
    status,
    checking,
    syncing: syncing || !!status?.syncing,
    apiDown,
    lastSyncedAt: status?.lastSyncedAt ? new Date(status.lastSyncedAt) : null,
    lastError: status?.lastError ?? null,
    refresh,
    syncNow: sync,
    apply,
  };
}

export function SyncStatusProvider({ children, intervalMs = 30_000 }: { children: ReactNode; intervalMs?: number }) {
  const value = useSyncPoller(intervalMs);
  return createElement(ConnectionContext.Provider, { value }, children);
}

/** The shared status (see SyncStatusProvider). */
export function useConnectionStatus(): ConnectionStatus {
  return useContext(ConnectionContext);
}

/** "just now", "3 min ago", "2 h ago", or a clock time for anything older. */
export function timeAgo(date: Date | null, now = new Date()): string {
  if (!date) return "never";
  const sec = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec} s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h ago`;
  return date.toLocaleString();
}
