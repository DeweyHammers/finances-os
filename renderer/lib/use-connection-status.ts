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
 * synced / syncing / offline / paused (sandbox) / blocked (the database is
 * newer than this app). The last known state is kept while a check is in
 * flight so the dot never flickers between colours on every poll.
 */
import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { fetchSyncStatus, syncNow, type SyncState, type SyncStatus } from "./sync-api";

export type { SyncState, SyncStatus };

export interface ConnectionStatus {
  /** A cloud database is set up on this device. False = local only. */
  configured: boolean;
  /** "unknown" until the first answer; then the server's state. */
  state: SyncState | "unknown";
  /** The server's full answer, null until the first one. */
  status: SyncStatus | null;
  /** A status check or a sync is in flight right now. */
  checking: boolean;
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

let latest: SyncStatus | null = null;

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

  const sync = useCallback(async () => {
    setChecking(true);
    try {
      apply(await syncNow());
    } catch {
      // The failure is in the status the server keeps; show that.
      await refresh();
    } finally {
      setChecking(false);
    }
  }, [apply, refresh]);

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
    checking: checking || !!status?.syncing,
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
