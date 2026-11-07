"use client";

/**
 * Automatic Optimize (Nov 6 2026) — the Overview's "Optimize" without the
 * button press.
 *
 * Every write the renderer makes goes through Refine's data provider, which
 * app/providers.tsx wraps with `withAutoOptimizeTriggers` (beside
 * `withSyncWriteNotices`). After a successful create / update / delete on one
 * of the planner's INPUT resources — Bill, Personal, Income, AppSettings — it
 * calls `notifyInputWrite()`, and the runner mounted once in
 * app/providers.tsx (`AutoOptimizeProvider`) schedules ONE re-plan
 * `AUTO_OPTIMIZE_DEBOUNCE_MS` later: a burst of saves plans once. Two writes
 * never trigger it, or the runner would loop on its own output:
 * BillSplit rows (what a run writes) and an AppSettings save that only
 * carries `optimizedInputsSig` (the baseline a run saves at the end — the
 * Overview's own first-run adoption too).
 *
 * A run fetches the inputs itself from the API (the Refine caches may be
 * stale), computes the signatures the Overview uses (lib/optimize-run.ts),
 * skips when they equal the saved baseline, and otherwise runs the shared
 * `runOptimize` — same planner, same single batch, same baseline save as the
 * button. The planner is idempotent and skips months whose rows are already
 * right, so re-running after every save is safe and cheap.
 *
 * It also runs once on app start (after `startupDelayMs`) when the baseline
 * differs from the inputs — an edit made while a run could not finish, or in
 * another window — or when the 36-month horizon has moved into a month that
 * has no planned rows yet, so the farthest month out does not stay unplanned
 * until the next edit.
 *
 * Failure never fails the user's save: it is logged and written to the
 * Overview's alert (`"Automatic re-plan failed: <message>"`, see
 * lib/optimize-run.ts), so the amber alert + Optimize button appear as the
 * retry. A later successful run — automatic or manual — clears it. The
 * Overview's own "inputs differ from the baseline" check stays as the safety
 * net behind all of this.
 *
 * Sandbox mode reloads the window after enter / discard / keep (the API
 * switches database files). The runner never starts a run while a sandbox
 * action is in flight or once the page is unloading, so a plan read from one
 * file is never written into the other; the reload drops any pending timer,
 * and the start-up check after it plans whatever the new file needs. A run
 * inside an active sandbox writes to the sandbox copy, which is right.
 */
import { createElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useInvalidate, useUpdate, type DataProvider } from "@refinedev/core";
import { API_URL } from "./api-url";
import { OPTIMIZE_HORIZON_MONTHS } from "./optimize-plan";
import { monthKeyOf } from "./pay-period-utils";
import {
  AUTO_OPTIMIZE_FAILED_PREFIX,
  computeInputSignatures,
  describeInputChange,
  isAutoOptimizeFailureAlert,
  parseOptimizedSig,
  readOptimizeAlert,
  runOptimize,
  surplusTargetCentsOf,
  writeOptimizeAlert,
} from "./optimize-run";
import { AutoOptimizeContext, type AutoOptimizeState } from "./auto-optimize-context";
import { useSandbox } from "../components/sandbox/SandboxContext";

/** How long input writes must go quiet before the one run that plans them all. */
export const AUTO_OPTIMIZE_DEBOUNCE_MS = 1000;
/** Delay before the start-up check, so the app's first paint is not competing with it. */
export const AUTO_OPTIMIZE_STARTUP_DELAY_MS = 1500;

// The planner's inputs, lower-cased (Refine resource names are
// case-insensitive on the API). BillSplit is deliberately absent.
const INPUT_RESOURCES = new Set(["bill", "personal", "income", "appsettings"]);
// AppSettings keys a run writes itself; a save carrying ONLY these is output,
// not input.
const OUTPUT_ONLY_KEYS = new Set(["optimizedInputsSig"]);

/**
 * Whether a write to `resource` with these `variables` changes the planner's
 * inputs. Exported for the tests and the wrapper below.
 */
export function isOptimizeInputWrite(resource: unknown, variables?: unknown): boolean {
  if (typeof resource !== "string" || !INPUT_RESOURCES.has(resource.toLowerCase())) return false;
  if (resource.toLowerCase() === "appsettings" && variables && typeof variables === "object" && !Array.isArray(variables)) {
    const keys = Object.keys(variables as Record<string, unknown>);
    if (keys.length > 0 && keys.every((k) => OUTPUT_ONLY_KEYS.has(k))) return false;
  }
  return true;
}

/** The mounted runner's handler (null when no provider is mounted). */
let inputWriteHandler: (() => void) | null = null;

/**
 * Tell the runner that an Optimize input was just written. Called by the
 * data-provider wrapper below; harmless when no runner is mounted.
 */
export function notifyInputWrite(): void {
  inputWriteHandler?.();
}

/**
 * Wrap Refine's data provider so every successful write to an input resource
 * schedules a re-plan. Reads are untouched. Applied once in app/providers.tsx,
 * around `withSyncWriteNotices`.
 */
export function withAutoOptimizeTriggers(provider: DataProvider): DataProvider {
  const writes = ["create", "createMany", "update", "updateMany", "deleteOne", "deleteMany"] as const;
  const wrapped: DataProvider = { ...provider };
  for (const name of writes) {
    const original = (provider as any)[name];
    if (typeof original !== "function") continue;
    (wrapped as any)[name] = async (...args: unknown[]) => {
      const result = await original.apply(provider, args);
      const params = (args[0] ?? {}) as { resource?: unknown; variables?: unknown };
      if (isOptimizeInputWrite(params.resource, params.variables)) notifyInputWrite();
      return result;
    };
  }
  return wrapped;
}

// ── Inputs from the API ──

async function getJson(path: string, allowMissing = false): Promise<any> {
  const res = await fetch(`${API_URL}/${path}`);
  if (res.status === 404 && allowMissing) return null;
  if (!res.ok) throw new Error(`GET /${path} failed: ${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * The same resources the Overview reads, fresh from the server. The list
 * routes ignore pagination, so a plain GET is every row. AppSettings/global
 * does not exist until the first Settings save (404 → defaults).
 */
export async function fetchOptimizeInputs() {
  const [bills, personalBills, incomes, splitRows, settings] = await Promise.all([
    getJson("Bill"),
    getJson("Personal"),
    getJson("Income"),
    getJson("BillSplit"),
    getJson("AppSettings/global", true),
  ]);
  return {
    bills: (bills ?? []) as any[],
    personalBills: (personalBills ?? []) as any[],
    incomes: (incomes ?? []) as any[],
    splitRows: (splitRows ?? []) as any[],
    settings: (settings ?? {}) as any,
  };
}

/** Why a run was asked for. */
export type AutoOptimizeReason = "write" | "startup";

export interface AutoOptimizeProviderProps {
  children: ReactNode;
  debounceMs?: number;
  /** Delay before the start-up check; `null` disables it (tests). */
  startupDelayMs?: number | null;
}

function useAutoOptimizeRunner(debounceMs: number, startupDelayMs: number | null): AutoOptimizeState {
  const invalidate = useInvalidate();
  const { mutateAsync: updateSettings } = useUpdate();
  const sandbox = useSandbox();

  const [pending, setPending] = useState(false);
  const [running, setRunning] = useState(false);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  /** A write landed during a run — run once more when it finishes. */
  const again = useRef(false);
  /** The window is going away (sandbox reload, close): start nothing new. */
  const unloading = useRef(false);
  const sandboxBusy = useRef(false);
  sandboxBusy.current = sandbox.busy;

  // The baseline save, through Refine like the Overview's, so AppSettings
  // queries refetch (the Overview's alert check reads the new baseline) and
  // the sync indicator sees the write. Its only key is `optimizedInputsSig`,
  // which the trigger wrapper ignores — see OUTPUT_ONLY_KEYS.
  const saveBaseline = useCallback(
    (sigJson: string) =>
      updateSettings({
        resource: "AppSettings",
        id: "global",
        values: { optimizedInputsSig: sigJson },
        successNotification: false,
        errorNotification: false,
      }),
    [updateSettings],
  );
  const invalidateSplits = useCallback(
    () => invalidate({ resource: "BillSplit", invalidates: ["list", "many"] }),
    [invalidate],
  );

  // One run: fetch → compare → (plan + write + save). Never throws.
  const performRun = useCallback(async (reason: AutoOptimizeReason) => {
    try {
      const { bills, personalBills, incomes, splitRows, settings } = await fetchOptimizeInputs();
      const primaryIncome = incomes.find((i: any) => i.isPrimary);
      // No primary income → no pay-week grid → nothing to plan (the Overview
      // shows its "No Income Added Yet" state instead of the button).
      if (!primaryIncome) return;

      const targetSurplusCents = surplusTargetCentsOf(settings);
      const sigs = computeInputSignatures({ bills, incomes, personalBills, targetSurplusCents });
      const baseline = parseOptimizedSig(settings?.optimizedInputsSig);
      const stale = !baseline || describeInputChange(sigs, baseline) !== null;
      const today = new Date();

      if (!stale) {
        if (reason === "write") {
          // The write changed nothing the planner reads (or was reverted):
          // nothing to re-plan, so an earlier failure has nothing left to say.
          if (isAutoOptimizeFailureAlert(readOptimizeAlert())) writeOptimizeAlert(null);
          return;
        }
        // Start-up: also plan when the horizon has moved into a month with
        // no rows yet (there are bills, so a planned month always has some).
        const last = new Date(today.getFullYear(), today.getMonth() + OPTIMIZE_HORIZON_MONTHS - 1, 1);
        const lastMk = monthKeyOf(last.getFullYear(), last.getMonth());
        const horizonUnplanned = bills.length > 0 && !splitRows.some((r: any) => String(r.monthKey) === lastMk);
        if (!horizonUnplanned) return;
      }

      const result = await runOptimize(
        { today, bills, personalBills, incomes, primaryIncome, splitRows, targetSurplusCents },
        sigs,
        { saveBaseline, invalidateSplits },
      );
      console.info(`Automatic re-plan (${reason}): ${result.operations} rows across ${result.months} months`);
    } catch (err: any) {
      // The user's save already succeeded; this must not undo that. Leave
      // the amber alert + Optimize button on the Overview as the retry.
      console.error("Automatic re-plan failed:", err);
      writeOptimizeAlert(`${AUTO_OPTIMIZE_FAILED_PREFIX}${err?.message ?? String(err)}`);
    }
  }, [saveBaseline, invalidateSplits]);

  // The latest run function, read at fire time. `schedule` below must keep ONE
  // identity for the life of the provider: Refine's `useUpdate` hands back a
  // new `mutateAsync` on re-render, which would rebuild `performRun` and
  // `schedule` — and an effect keyed on `schedule` would then clear the
  // pending timer on the very re-render `setPending(true)` causes. (That is
  // exactly what happened on the first browser check, Nov 6 2026: the bill
  // saved, the timer was cancelled, no re-plan.)
  const performRunRef = useRef(performRun);
  performRunRef.current = performRun;

  // Debounce + serialise: one timer, one run at a time, at most one queued.
  const schedule = useCallback((reason: AutoOptimizeReason, delay: number) => {
    if (unloading.current) return;
    if (inFlight.current) {
      again.current = true;
      return;
    }
    setPending(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      timer.current = null;
      // A sandbox switch is in flight (the window reloads once it lands):
      // wait it out rather than read one file and write the other.
      if (sandboxBusy.current) {
        timer.current = setTimeout(() => schedule(reason, delay), delay);
        return;
      }
      if (unloading.current) {
        setPending(false);
        return;
      }
      setPending(false);
      setRunning(true);
      inFlight.current = true;
      try {
        do {
          again.current = false;
          await performRunRef.current(reason);
          // A write that landed mid-run is a "write" run, whatever started this one.
          reason = "write";
        } while (again.current && !unloading.current);
      } finally {
        inFlight.current = false;
        setRunning(false);
      }
    }, delay);
  }, []);

  // Writes → the debounced run.
  useEffect(() => {
    const onWrite = () => schedule("write", debounceMs);
    inputWriteHandler = onWrite;
    return () => {
      if (inputWriteHandler === onWrite) inputWriteHandler = null;
    };
  }, [schedule, debounceMs]);

  // Start-up check, once per mount; the pending timer dies with the provider.
  useEffect(() => {
    if (startupDelayMs !== null) schedule("startup", startupDelayMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // `schedule` never changes (see above); the check must run exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nothing new once the page is going away (sandbox reload, window close).
  useEffect(() => {
    const onUnload = () => {
      unloading.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
    window.addEventListener("pagehide", onUnload);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("pagehide", onUnload);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);

  return useMemo(() => ({ pending, running, busy: pending || running }), [pending, running]);
}

/**
 * Mounts the runner once (app/providers.tsx, inside Refine and the Sandbox
 * provider) and shares its state through `useAutoOptimize()`.
 */
export function AutoOptimizeProvider({
  children,
  debounceMs = AUTO_OPTIMIZE_DEBOUNCE_MS,
  startupDelayMs = AUTO_OPTIMIZE_STARTUP_DELAY_MS,
}: AutoOptimizeProviderProps) {
  const value = useAutoOptimizeRunner(debounceMs, startupDelayMs);
  return createElement(AutoOptimizeContext.Provider, { value }, children);
}
