"use client";

/**
 * SandboxContext — one shared view of Sandbox mode for the whole renderer.
 *
 * The sider button (enter) and the banner (discard / keep) both read from
 * here, so they can never disagree about whether a sandbox is active. The
 * status is fetched once on mount; every action re-fetches and then RELOADS
 * the window. A reload is deliberate: every Refine query, every page's local
 * state and the Overview's stale-alert check must all start over against the
 * database file the API now points at, and a full reload is the one way to
 * guarantee nothing stale survives the switch.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  fetchSandboxStatus,
  runSandboxAction,
  type SandboxAction,
  type SandboxStatus,
} from "../../lib/sandbox-api";

interface SandboxContextValue {
  /** null until the first status fetch resolves (or if the API is down). */
  status: SandboxStatus | null;
  /** An action is in flight — buttons disable themselves. */
  busy: boolean;
  /** Last action's error message, cleared on the next attempt. */
  error: string | null;
  run: (action: SandboxAction) => Promise<void>;
}

const SandboxContext = createContext<SandboxContextValue>({
  status: null,
  busy: false,
  error: null,
  run: async () => {},
});

export function SandboxProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSandboxStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        // API not up yet (dev startup race) — the banner simply stays hidden.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(async (action: SandboxAction) => {
    setBusy(true);
    setError(null);
    try {
      const next = await runSandboxAction(action);
      setStatus(next);
      window.location.reload();
    } catch (e: any) {
      setError(e?.message || String(e));
      setBusy(false);
    }
  }, []);

  return (
    <SandboxContext.Provider value={{ status, busy, error, run }}>
      {children}
    </SandboxContext.Provider>
  );
}

export function useSandbox(): SandboxContextValue {
  return useContext(SandboxContext);
}
