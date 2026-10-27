"use client";

/**
 * useConnectionStatus — is the API reachable right now?
 *
 * Powers the status indicator in the sider footer and Settings → Sync
 * (the "sync icon" the user asked for, modelled on Obsidian's). Today it
 * reports the link between this screen and the app's database server; when
 * sync lands (plans/phone-app-and-sync.md, Phase B/D) the same slot gains
 * the "last synced" state.
 *
 * Pings `GET /api/meta` every `intervalMs`, immediately on mount, when the
 * tab becomes visible again and on the browser's online/offline events. The
 * last known state is kept while a check is in flight so the dot never
 * flickers between colours on every poll.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchMeta } from "./meta-api";

export type ConnectionState = "unknown" | "connected" | "offline";

export interface ConnectionStatus {
  state: ConnectionState;
  /** A check is in flight right now. */
  checking: boolean;
  /** When the API last answered. */
  lastOkAt: Date | null;
  /** Message of the last failed check, null after a success. */
  lastError: string | null;
  /** Force a check now (the indicator is clickable). */
  refresh: () => void;
}

const PING_TIMEOUT_MS = 5000;

export function useConnectionStatus(intervalMs = 30_000): ConnectionStatus {
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
  }, [check, intervalMs]);

  return { state, checking, lastOkAt, lastError, refresh: check };
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
