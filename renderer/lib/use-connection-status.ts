"use client";

/**
 * useConnectionStatus — can this screen reach its server right now?
 *
 * Powers the status row above Settings in the sider and the Connection row
 * in Settings → Phone & sync. It is the "sync icon" of
 * plans/phone-app-and-sync.md, modelled on Obsidian's, and it only has a
 * meaning once a sync server is configured: on a local-only install there
 * is nothing to be connected TO (the app's own database server is the app
 * itself), so `configured` is false, nothing is polled, and both places
 * show nothing / "Local only" instead of a status (user decision,
 * Oct 27 2026: no "Connected" before a server exists, and no red light for
 * "no server configured" either — only a configured server that stops
 * answering is worth a warning).
 *
 * While configured: pings `GET /api/meta` every `intervalMs`, immediately
 * on mount, when the tab becomes visible again and on the browser's
 * online/offline events. The last known state is kept while a check is in
 * flight so the dot never flickers between colours on every poll. Phase B
 * points the ping at the sync server and adds the "last synced" state.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchMeta } from "./meta-api";

export type ConnectionState = "unknown" | "connected" | "offline";

export interface ConnectionStatus {
  /** A sync server is set up on this device. False = local only. */
  configured: boolean;
  state: ConnectionState;
  /** A check is in flight right now. */
  checking: boolean;
  /** When the server last answered. */
  lastOkAt: Date | null;
  /** Message of the last failed check, null after a success. */
  lastError: string | null;
  /** Force a check now (the indicator's dot is clickable). */
  refresh: () => void;
}

const PING_TIMEOUT_MS = 5000;

/**
 * Whether a sync server is configured on this device. Phase B of
 * plans/phone-app-and-sync.md reads this from the saved sync settings; until
 * then every install is local only.
 */
export function isSyncConfigured(): boolean {
  return false;
}

export function useConnectionStatus(intervalMs = 30_000): ConnectionStatus {
  const configured = isSyncConfigured();
  const [state, setState] = useState<ConnectionState>("unknown");
  const [checking, setChecking] = useState(false);
  const [lastOkAt, setLastOkAt] = useState<Date | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    // One check at a time; a forced refresh cancels the previous one.
    inFlight.current?.abort();
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
    setChecking(true);
    try {
      await fetchMeta(ctrl.signal);
      if (ctrl.signal.aborted) return;
      setState("connected");
      setLastOkAt(new Date());
      setLastError(null);
    } catch (e: any) {
      if (ctrl.signal.aborted && inFlight.current !== ctrl) return; // superseded
      setState("offline");
      setLastError(e?.name === "AbortError" ? "No answer in 5 s" : e?.message || String(e));
    } finally {
      clearTimeout(timer);
      if (inFlight.current === ctrl) {
        inFlight.current = null;
        setChecking(false);
      }
    }
  }, []);

  useEffect(() => {
    // Local only: nothing to reach, so nothing to poll.
    if (!configured) return;
    check();
    const id = setInterval(check, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    window.addEventListener("online", check);
    window.addEventListener("offline", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", check);
      window.removeEventListener("offline", check);
      document.removeEventListener("visibilitychange", onVisible);
      inFlight.current?.abort();
    };
  }, [check, intervalMs, configured]);

  return { configured, state, checking, lastOkAt, lastError, refresh: check };
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
