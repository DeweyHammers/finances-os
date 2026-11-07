/**
 * optimize-run — everything the Overview's "Optimize" button and the
 * automatic re-plan (lib/auto-optimize.tsx) have in common, so the two can
 * never drift:
 *
 *  - the INPUT SIGNATURES (bills / incomes / personals / surplus target) that
 *    decide whether the plan is stale, and the baseline they are compared
 *    against (`AppSettings.optimizedInputsSig`, JSON of the signatures at the
 *    last successful run);
 *  - PHASE B of a run: the plan from `planOptimize` turned into ONE batch
 *    request (each month's deletes before its creates, exactly as the rows
 *    were issued when each was its own mutation), the sync notice + BillSplit
 *    refetch that the batch owes because it bypasses Refine, and the baseline
 *    save that happens ONLY once every write landed;
 *  - the Overview's stale-data alert text, kept in
 *    `localStorage("overviewOptimizeAlert")` so it survives navigation and
 *    restarts, with a window event so a mounted Overview sees a change made
 *    by the runner on another page.
 *
 * Until Nov 6 2026 all of this lived inside OverviewPage.handleOptimize; it
 * moved here (verbatim where it matters — the lock-in tests pin the writes)
 * when Optimize started running by itself after every input change. See
 * CLAUDE.md → "Stale-data alert + always-visible Optimize" and
 * "Overview optimizer".
 */
import { applyBatch, type BatchOperation } from "./batch-api";
import { notifyLocalWrite } from "./use-connection-status";
import { planOptimize, type MonthWritePlan, type OptimizeInputs } from "./optimize-plan";

// ── Input signatures ──

/**
 * One string per input family plus the surplus target. Anything that changes
 * the plan's inputs must be reflected here, or an edit to it will neither
 * raise the alert nor start an automatic re-plan. Key ORDER matters: the
 * JSON of this object is what gets stored and compared.
 */
export interface InputSignatures {
  bills: string;
  incomes: string;
  personals: string;
  surplusTarget: number;
}

/** The raw rows a signature is computed from (the same resources the Overview reads). */
export interface SignatureInputs {
  bills: any[];
  incomes: any[];
  personalBills: any[];
  /** AppSettings.wifeWeeklyTargetCents (the "Surplus Target"), default $300. */
  targetSurplusCents: number;
}

/** Signatures of every Optimize input — the Overview's rule, unchanged. */
export function computeInputSignatures({ bills, incomes, personalBills, targetSurplusCents }: SignatureInputs): InputSignatures {
  return {
    bills: bills.map((b: any) => `${b.id}:${b.amount}:${b.dueDate}:${b.neverSplit ? 1 : 0}`).sort().join(","),
    incomes: incomes.map((i: any) => `${i.id}:${i.amount}:${i.payDay}:${i.paymentCycle}:${i.payWeekOffset ?? 0}`).sort().join(","),
    personals: personalBills.map((p: any) => `${p.id}:${p.amount}:${p.dueDate}:${p.repeatWeekly ? 1 : 0}:${p.weekOfMonth ?? ""}`).sort().join(","),
    surplusTarget: targetSurplusCents,
  };
}

/** The stored baseline (`AppSettings.optimizedInputsSig`), or null when absent / unreadable. */
export function parseOptimizedSig(raw: unknown): InputSignatures | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw) as InputSignatures;
  } catch {
    return null;
  }
}

/** The surplus target the Overview and the runner both read from AppSettings. */
export function surplusTargetCentsOf(settings: any): number {
  return Number(settings?.wifeWeeklyTargetCents ?? 30000);
}

// Alert texts raised by input-change detection, in the order the Overview
// has always checked them. Only these (and an automatic-run failure, below)
// are auto-cleared when the inputs match the baseline again — the
// legacy-split migration alert is cleared only by a successful run.
const BILLS_CHANGED = "Bills were added or updated.";
const INCOME_CHANGED = "Income was added or updated.";
const PERSONALS_CHANGED = "Personal expenses were added or updated.";
const SURPLUS_CHANGED = "Weekly surplus target was changed.";
const INPUT_CHANGE_ALERTS = new Set([BILLS_CHANGED, INCOME_CHANGED, PERSONALS_CHANGED, SURPLUS_CHANGED]);

/**
 * The alert text for the first input family that differs from the baseline,
 * or null when the inputs match it (the plan is up to date).
 */
export function describeInputChange(current: InputSignatures, baseline: InputSignatures): string | null {
  if (current.bills !== baseline.bills) return BILLS_CHANGED;
  if (current.incomes !== baseline.incomes) return INCOME_CHANGED;
  if (current.personals !== baseline.personals) return PERSONALS_CHANGED;
  if (current.surplusTarget !== baseline.surplusTarget) return SURPLUS_CHANGED;
  return null;
}

/** True for one of the input-change alert texts above. */
export function isInputChangeAlert(text: string | null | undefined): boolean {
  return !!text && INPUT_CHANGE_ALERTS.has(text);
}

// ── Stale-data alert storage ──

/** The localStorage key the Overview has always used for its alert text. */
export const OPTIMIZE_ALERT_KEY = "overviewOptimizeAlert";
/** Window event fired whenever `writeOptimizeAlert` changes the stored text. */
const OPTIMIZE_ALERT_EVENT = "finances-os:optimize-alert";
/**
 * Every alert written by a FAILED automatic run starts with this, so the
 * Overview can tell it from its own input-change texts: it is never
 * overwritten by "Bills were added or updated." (the error message is the
 * useful part) and it is cleared when a run succeeds or nothing is left to
 * re-plan.
 */
export const AUTO_OPTIMIZE_FAILED_PREFIX = "Automatic re-plan failed: ";

export function isAutoOptimizeFailureAlert(text: string | null | undefined): boolean {
  return !!text && text.startsWith(AUTO_OPTIMIZE_FAILED_PREFIX);
}

/** The stored alert text, null when there is none (or no localStorage). */
export function readOptimizeAlert(): string | null {
  try {
    return localStorage.getItem(OPTIMIZE_ALERT_KEY);
  } catch {
    return null;
  }
}

/**
 * Store (or, with null, clear) the alert text and tell a mounted Overview.
 * Safe without localStorage or window (tests, SSR): the write is best-effort.
 */
export function writeOptimizeAlert(text: string | null): void {
  try {
    if (text) localStorage.setItem(OPTIMIZE_ALERT_KEY, text);
    else localStorage.removeItem(OPTIMIZE_ALERT_KEY);
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent<string | null>(OPTIMIZE_ALERT_EVENT, { detail: text }));
  } catch {}
}

/** Be told whenever `writeOptimizeAlert` runs in this window. Returns the unsubscribe. */
export function subscribeOptimizeAlert(listener: (text: string | null) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => listener((e as CustomEvent<string | null>).detail ?? null);
  window.addEventListener(OPTIMIZE_ALERT_EVENT, handler);
  return () => window.removeEventListener(OPTIMIZE_ALERT_EVENT, handler);
}

// ── PHASE B ──

/**
 * The plan as ONE batch, in the order the rows were always written: for each
 * month, its deletes, then its creates. Delete-then-create is intentional:
 * there is no `upsert` for a composite key that includes occurrenceCoord, and
 * the algorithm may add/remove splits (not just change amounts). Locked-week
 * rows are not in `toDelete`, so they survive. Each month's deletes precede
 * its creates so a replaced row never collides with the unique key it is
 * replacing.
 */
export function buildBatchOperations(writePlans: readonly MonthWritePlan[]): BatchOperation[] {
  const operations: BatchOperation[] = [];
  for (const plan of writePlans) {
    for (const o of plan.toDelete) {
      operations.push({ op: "delete", resource: "BillSplit", id: o.id });
    }
    for (const a of plan.toCreate) {
      operations.push({
        op: "create",
        resource: "BillSplit",
        values: {
          billId: a.billId,
          monthKey: plan.mk,
          weekIndex: a.weekIndex,
          amountCents: a.amountCents,
          occurrenceCoord: a.occurrenceCoord,
        },
      });
    }
  }
  return operations;
}

/** What a caller must provide: both come from Refine hooks, which only a component can hold. */
export interface RunOptimizeHooks {
  /**
   * Persist the signatures as the new "last optimized" baseline
   * (`AppSettings.optimizedInputsSig` = the JSON given). Through Refine's
   * `useUpdate`, so every AppSettings query refetches and the Overview's
   * alert check sees the new baseline.
   */
  saveBaseline: (sigJson: string) => Promise<unknown>;
  /** Refetch the BillSplit lists every page reads (Refine's `invalidate`). */
  invalidateSplits: () => void;
}

export interface RunOptimizeResult {
  /** Months whose rows changed (the planner's fast path skips the rest). */
  months: number;
  /** Rows deleted + created, 0 when the database was already up to date. */
  operations: number;
}

/**
 * One complete Optimize run: PHASE A (`planOptimize`, pure — a planning
 * failure throws before anything is written), then PHASE B as ONE request and
 * ONE database transaction (lib/batch-api.ts → POST /api/batch; all or
 * nothing, so a failure inside it leaves the database untouched too).
 *
 * Until Nov 6 2026 every row was its own request (≈2000 for a full re-plan,
 * each its own commit). With sync on, the background sync kept starting in
 * the middle of that run, and every sync holds the database lock for its
 * round trips to the cloud — so the remaining writes and all of the UI's
 * reads queued behind the network: the app froze, and the thousands of WAL
 * frames those commits left ended in a sync conflict. One transaction = one
 * commit, a handful of frames, and one push once it is done.
 *
 * On success the baseline is saved and the stale-data alert cleared — ONLY
 * then, so a failed run keeps nagging (and keeps the Optimize button as the
 * retry). Throws whatever failed; the caller decides how to report it.
 */
export async function runOptimize(
  inputs: OptimizeInputs,
  sigs: InputSignatures,
  hooks: RunOptimizeHooks,
): Promise<RunOptimizeResult> {
  // PHASE A — plan every month WITHOUT touching the DB. The balance algorithm
  // + underfunded / locked-week assertions can throw; doing all of that before
  // the first delete means a failure leaves the DB exactly as it was, instead
  // of the old behaviour (delete a month's rows, then die halfway through
  // re-creating them — which silently dropped two split bills from Oct 2026
  // and inflated that week's surplus).
  const writePlans = planOptimize(inputs);

  // PHASE B — apply.
  const operations = buildBatchOperations(writePlans);
  if (operations.length > 0) {
    await applyBatch(operations);
    // The batch bypasses Refine's data provider, so do what useCreate /
    // useDelete did for us: one notice to the sync indicator (spinning
    // arrows, then a single push of the whole plan) and a refetch of the
    // BillSplit lists every page reads.
    notifyLocalWrite();
    hooks.invalidateSplits();
  }

  // Success only — the baseline signature is saved and the alert cleared ONLY
  // when every write landed.
  await hooks.saveBaseline(JSON.stringify(sigs));
  writeOptimizeAlert(null);
  return { months: writePlans.length, operations: operations.length };
}
