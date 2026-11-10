// @vitest-environment jsdom
/**
 * The automatic Optimize runner (lib/auto-optimize.tsx): which writes
 * trigger it, that a burst of saves plans ONCE after the quiet period, that
 * the run is the shared `runOptimize` (fetch → compare → plan → one batch →
 * baseline save), that a failure writes the Overview's alert and never
 * throws, and the start-up check. The API (fetch), the planner and the batch
 * request are mocked; Refine's hooks are stubbed. Nothing touches a database.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { createElement, type ReactNode } from "react";

const { planOptimize, applyBatch, notifyLocalWrite, invalidate, updateSettings } = vi.hoisted(() => ({
  planOptimize: vi.fn(),
  applyBatch: vi.fn(async (_ops: any[]) => []),
  notifyLocalWrite: vi.fn(),
  invalidate: vi.fn(),
  updateSettings: vi.fn(async (_vars: any) => ({})),
}));
vi.mock("./optimize-plan", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./optimize-plan")>()),
  planOptimize,
}));
vi.mock("./batch-api", () => ({ applyBatch }));
vi.mock("./use-connection-status", () => ({ notifyLocalWrite }));
// Like Refine, these hand back a NEW function identity on every render — the
// runner must not let that cancel a pending run (it did once, Nov 6 2026).
vi.mock("@refinedev/core", () => ({
  useInvalidate: () => (...args: any[]) => invalidate(...args),
  useUpdate: () => ({ mutateAsync: (...args: any[]) => updateSettings(...args) }),
}));

import { OPTIMIZE_HORIZON_MONTHS } from "./optimize-plan";
import { monthKeyOf } from "./pay-period-utils";
import {
  AutoOptimizeProvider,
  isOptimizeInputWrite,
  notifyInputWrite,
  withAutoOptimizeTriggers,
} from "./auto-optimize";
import { useAutoOptimize } from "./auto-optimize-context";
import {
  AUTO_OPTIMIZE_FAILED_PREFIX,
  OPTIMIZE_ALERT_KEY,
  computeInputSignatures,
  readOptimizeAlert,
} from "./optimize-run";

// ── Fake API ──
// A tiny in-memory copy of the six resources the runner reads. `fetch` is
// stubbed to answer GET /api/<resource> (and /AppSettings/global) from it.
const TODAY = new Date(2026, 10, 6, 12); // Nov 6 2026
const primaryIncome = { id: "inc1", amount: 700, payDay: 5, paymentCycle: "WEEKLY", payWeekOffset: 0, isPrimary: true };
let db: { Bill: any[]; Personal: any[]; Income: any[]; IncomeOverride: any[]; BillSplit: any[]; AppSettings: any | null };

function sigsOf() {
  return computeInputSignatures({
    bills: db.Bill,
    incomes: db.Income,
    incomeOverrides: db.IncomeOverride,
    personalBills: db.Personal,
    targetSurplusCents: Number(db.AppSettings?.wifeWeeklyTargetCents ?? 30000),
  });
}

/** Rows planned for every horizon month (so the start-up check sees a planned frontier). */
function fullHorizonRows() {
  const rows: any[] = [];
  for (let i = 0; i < OPTIMIZE_HORIZON_MONTHS; i++) {
    const d = new Date(TODAY.getFullYear(), TODAY.getMonth() + i, 1);
    rows.push({ id: `s${i}`, billId: "b1", monthKey: monthKeyOf(d.getFullYear(), d.getMonth()), weekIndex: 0, amountCents: 5000, occurrenceCoord: 10 });
  }
  return rows;
}

const fetchMock = vi.fn(async (url: string) => {
  const path = url.replace(/^.*\/api\//, "");
  const respond = (body: unknown, status = 200) =>
    ({ ok: status < 400, status, statusText: "", json: async () => body }) as unknown as Response;
  if (path === "AppSettings/global") return db.AppSettings ? respond(db.AppSettings) : respond({ error: "Not found" }, 404);
  const rows = (db as any)[path];
  return rows ? respond(rows) : respond({ error: `Model ${path} not found` }, 404);
});

// The plan the mocked planner returns: one month, one delete, one create.
const ONE_MONTH_PLAN = [
  { mk: "2026-12", toDelete: [{ id: "old1" }], toCreate: [{ billId: "b1", weekIndex: 1, amountCents: 1234, occurrenceCoord: 10 }] },
];

// ── Mounting ──
let state: ReturnType<typeof useAutoOptimize> | null = null;
function Probe() {
  state = useAutoOptimize();
  return null;
}
function mount(props: { debounceMs?: number; startupDelayMs?: number | null } = {}) {
  return render(
    createElement(AutoOptimizeProvider, { debounceMs: 1000, startupDelayMs: null, ...props } as any, createElement(Probe)),
  );
}
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(TODAY);
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  planOptimize.mockReset().mockReturnValue(ONE_MONTH_PLAN);
  applyBatch.mockClear().mockResolvedValue([]);
  notifyLocalWrite.mockClear();
  invalidate.mockClear();
  updateSettings.mockClear().mockResolvedValue({});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  db = {
    Bill: [{ id: "b1", amount: 50, dueDate: 10, neverSplit: false }],
    Personal: [{ id: "p1", amount: 20, dueDate: null, repeatWeekly: true, weekOfMonth: null }],
    Income: [primaryIncome],
    IncomeOverride: [],
    BillSplit: fullHorizonRows(),
    AppSettings: { id: "global", wifeWeeklyTargetCents: 30000, optimizedInputsSig: null },
  };
  // The baseline matches the inputs: an up-to-date plan.
  db.AppSettings.optimizedInputsSig = JSON.stringify(sigsOf());
  state = null;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isOptimizeInputWrite — which writes schedule a re-plan", () => {
  it("fires for the planner's inputs, in any resource casing", () => {
    expect(isOptimizeInputWrite("Bill", { amount: 5 })).toBe(true);
    expect(isOptimizeInputWrite("personal", { amount: 5 })).toBe(true);
    expect(isOptimizeInputWrite("Income", undefined)).toBe(true); // a delete has no variables
    // One week's paycheck (a 32-hour week) changes that week's income.
    expect(isOptimizeInputWrite("IncomeOverride", { incomeId: "inc1", payDate: 20261118, amount: 560 })).toBe(true);
    expect(isOptimizeInputWrite("incomeoverride", undefined)).toBe(true);
    expect(isOptimizeInputWrite("AppSettings", { wifeWeeklyTargetCents: 40000 })).toBe(true);
    expect(isOptimizeInputWrite("AppSettings", { paymentCycle: "BI_WEEKLY" })).toBe(true);
  });
  it("never fires for the planner's own output", () => {
    expect(isOptimizeInputWrite("BillSplit", { amountCents: 1 })).toBe(false);
    expect(isOptimizeInputWrite("AppSettings", { optimizedInputsSig: "{}" })).toBe(false);
    expect(isOptimizeInputWrite("AccountTransaction", { amount: 1 })).toBe(false);
    expect(isOptimizeInputWrite("YearlyCost", { amount: 1 })).toBe(false);
    expect(isOptimizeInputWrite(undefined)).toBe(false);
  });
  it("a mixed AppSettings save (baseline + a real input) still fires", () => {
    expect(isOptimizeInputWrite("AppSettings", { optimizedInputsSig: "{}", wifeWeeklyTargetCents: 1 })).toBe(true);
  });
});

describe("withAutoOptimizeTriggers — the data-provider wrapper", () => {
  it("notifies after a successful input write only, and passes results through", async () => {
    mount();
    const provider: any = {
      getList: vi.fn(),
      create: vi.fn(async (p: any) => ({ data: { id: "new", ...p.variables } })),
      update: vi.fn(async () => ({ data: {} })),
      deleteOne: vi.fn(async () => ({ data: {} })),
    };
    const wrapped: any = withAutoOptimizeTriggers(provider);
    expect(wrapped.getList).toBe(provider.getList); // reads untouched
    db.Bill[0].amount = 9; // what the server now holds — the baseline is stale

    let created: any;
    await act(async () => {
      created = await wrapped.create({ resource: "Bill", variables: { amount: 9 } });
    });
    expect(created.data.id).toBe("new");
    expect(state!.pending).toBe(true);

    // A baseline save and a BillSplit write do not touch the timer: the run
    // happens exactly once, 1 s after the LAST input write.
    await tick(600);
    await wrapped.update({ resource: "AppSettings", id: "global", variables: { optimizedInputsSig: "{}" } });
    await wrapped.deleteOne({ resource: "BillSplit", id: "s1" });
    await tick(500);
    expect(planOptimize).toHaveBeenCalledTimes(1);
  });

  it("a failed write schedules nothing", async () => {
    mount();
    const provider: any = { update: vi.fn(async () => { throw new Error("500"); }) };
    const wrapped: any = withAutoOptimizeTriggers(provider);
    await expect(wrapped.update({ resource: "Bill", id: "b1", variables: { amount: 1 } })).rejects.toThrow("500");
    expect(state!.pending).toBe(false);
  });
});

describe("the debounced run", () => {
  it("a burst of input writes plans ONCE, a second after the last one, and writes one batch", async () => {
    mount();
    // The inputs changed on the server (a bill's amount); the baseline is stale.
    db.Bill[0].amount = 75;

    act(() => {
      notifyInputWrite();
    });
    await tick(600);
    act(() => {
      notifyInputWrite(); // still typing — restarts the quiet period
    });
    await tick(600); // 1.2 s after the first write, 0.6 s after the last: nothing yet
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state!.pending).toBe(true);

    await tick(400); // 1 s of quiet → the run
    expect(state!.pending).toBe(false);
    expect(state!.running).toBe(false);

    // Inputs were fetched from the API, not a cache.
    const urls = fetchMock.mock.calls.map(([u]) => String(u).replace(/^.*\/api\//, "")).sort();
    expect(urls).toEqual(["AppSettings/global", "Bill", "BillSplit", "Income", "IncomeOverride", "Personal"]);

    // The planner ran once with those inputs and today's date...
    expect(planOptimize).toHaveBeenCalledTimes(1);
    const inputs = planOptimize.mock.calls[0][0];
    expect(inputs.bills).toEqual(db.Bill);
    expect(inputs.primaryIncome).toEqual(primaryIncome);
    expect(inputs.targetSurplusCents).toBe(30000);
    // `today` is `new Date()` at run time (the fake clock has moved ~1.6 s).
    expect(inputs.today.getTime()).toBeGreaterThanOrEqual(TODAY.getTime());
    expect(inputs.today.getTime()).toBeLessThan(TODAY.getTime() + 5000);

    // ...its plan went out as ONE batch, deletes before creates...
    expect(applyBatch).toHaveBeenCalledTimes(1);
    expect(applyBatch.mock.calls[0][0]).toEqual([
      { op: "delete", resource: "BillSplit", id: "old1" },
      { op: "create", resource: "BillSplit", values: { billId: "b1", monthKey: "2026-12", weekIndex: 1, amountCents: 1234, occurrenceCoord: 10 } },
    ]);
    // ...followed by the sync notice, the BillSplit refetch and the baseline save.
    expect(notifyLocalWrite).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ resource: "BillSplit", invalidates: ["list", "many"] });
    expect(updateSettings).toHaveBeenCalledTimes(1);
    const saved = updateSettings.mock.calls[0][0];
    expect(saved.resource).toBe("AppSettings");
    expect(saved.id).toBe("global");
    expect(JSON.parse(saved.values.optimizedInputsSig)).toEqual(sigsOf());
    expect(readOptimizeAlert()).toBeNull();
  });

  it("a single week's paycheck override re-plans, with the override handed to the planner and saved in the baseline", async () => {
    mount();
    // "The Nov 18 paycheck is 32 hours": one IncomeOverride row was saved.
    db.IncomeOverride = [{ id: "o1", incomeId: "inc1", payDate: 20261118, amount: 560, hours: 32 }];
    act(() => {
      notifyInputWrite();
    });
    await tick(1000);

    expect(planOptimize).toHaveBeenCalledTimes(1);
    expect(planOptimize.mock.calls[0][0].incomeOverrides).toEqual(db.IncomeOverride);
    // The baseline now carries the override, so the same inputs are up to date…
    const saved = JSON.parse(updateSettings.mock.calls[0][0].values.optimizedInputsSig);
    expect(saved).toEqual(sigsOf());
    expect(saved.incomes).toBe("inc1:700:5:WEEKLY:0|inc1@20261118:560");
    db.AppSettings.optimizedInputsSig = JSON.stringify(saved);
    planOptimize.mockClear();
    act(() => {
      notifyInputWrite();
    });
    await tick(1000);
    expect(planOptimize).not.toHaveBeenCalled();

    // …and changing its amount, or removing it, is a change again.
    db.IncomeOverride[0].amount = 525;
    act(() => {
      notifyInputWrite();
    });
    await tick(1000);
    expect(planOptimize).toHaveBeenCalledTimes(1);
    db.AppSettings.optimizedInputsSig = updateSettings.mock.calls.at(-1)![0].values.optimizedInputsSig;
    db.IncomeOverride = [];
    act(() => {
      notifyInputWrite();
    });
    await tick(1000);
    expect(planOptimize).toHaveBeenCalledTimes(2);
    // Without overrides the signature is the pre-Nov-2026 string again.
    expect(JSON.parse(updateSettings.mock.calls.at(-1)![0].values.optimizedInputsSig).incomes).toBe("inc1:700:5:WEEKLY:0");
  });

  it("skips the planner when the inputs still match the baseline (and clears a stale failure alert)", async () => {
    localStorage.setItem(OPTIMIZE_ALERT_KEY, `${AUTO_OPTIMIZE_FAILED_PREFIX}boom`);
    mount();
    act(() => {
      notifyInputWrite();
    });
    await tick(1000);
    expect(fetchMock).toHaveBeenCalled();
    expect(planOptimize).not.toHaveBeenCalled();
    expect(applyBatch).not.toHaveBeenCalled();
    expect(updateSettings).not.toHaveBeenCalled();
    expect(readOptimizeAlert()).toBeNull();
  });

  it("an up-to-date plan with no rows to write still saves the baseline", async () => {
    mount();
    db.Bill[0].amount = 75;
    planOptimize.mockReturnValue([]); // the fast path: every month already right
    act(() => {
      notifyInputWrite();
    });
    await tick(1000);
    expect(applyBatch).not.toHaveBeenCalled();
    expect(notifyLocalWrite).not.toHaveBeenCalled();
    expect(updateSettings).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a primary income", async () => {
    mount();
    db.Income = [];
    db.Bill[0].amount = 75;
    act(() => {
      notifyInputWrite();
    });
    await tick(1000);
    expect(planOptimize).not.toHaveBeenCalled();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("a write that lands during a run queues exactly one more run", async () => {
    mount();
    db.Bill[0].amount = 75;
    let release!: () => void;
    applyBatch.mockImplementationOnce(() => new Promise<any[]>((r) => { release = () => r([]); }));
    act(() => {
      notifyInputWrite();
    });
    await tick(1000);
    expect(state!.running).toBe(true);
    act(() => {
      notifyInputWrite();
      notifyInputWrite();
    });
    await tick(0);
    expect(planOptimize).toHaveBeenCalledTimes(1);
    release();
    await tick(0);
    await tick(0);
    // The second run saw the baseline the first one saved? No — the fake API
    // never stores it, so the inputs are still "stale" and it plans again.
    expect(planOptimize).toHaveBeenCalledTimes(2);
    expect(state!.running).toBe(false);
  });
});

describe("failure", () => {
  it("a failing batch writes the Overview's alert, saves no baseline and does not throw", async () => {
    mount();
    db.Bill[0].amount = 75;
    applyBatch.mockRejectedValueOnce(new Error("UNIQUE constraint failed"));
    act(() => {
      notifyInputWrite();
    });
    await tick(1000);
    expect(updateSettings).not.toHaveBeenCalled();
    expect(readOptimizeAlert()).toBe(`${AUTO_OPTIMIZE_FAILED_PREFIX}UNIQUE constraint failed`);
    expect(state!.running).toBe(false);
  });

  it("a planning failure (nothing written) does the same", async () => {
    mount();
    db.Bill[0].amount = 75;
    planOptimize.mockImplementation(() => { throw new Error("Optimize Now — 2027-01: underfunded"); });
    act(() => {
      notifyInputWrite();
    });
    await tick(1000);
    expect(applyBatch).not.toHaveBeenCalled();
    expect(readOptimizeAlert()).toBe(`${AUTO_OPTIMIZE_FAILED_PREFIX}Optimize Now — 2027-01: underfunded`);
  });

  it("an API that cannot be reached is a failure too", async () => {
    mount();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    act(() => {
      notifyInputWrite();
    });
    await tick(1000);
    expect(readOptimizeAlert()).toBe(`${AUTO_OPTIMIZE_FAILED_PREFIX}Failed to fetch`);
  });

  it("the next successful run clears the alert", async () => {
    localStorage.setItem(OPTIMIZE_ALERT_KEY, `${AUTO_OPTIMIZE_FAILED_PREFIX}boom`);
    mount();
    db.Bill[0].amount = 75;
    act(() => {
      notifyInputWrite();
    });
    await tick(1000);
    expect(readOptimizeAlert()).toBeNull();
  });
});

describe("start-up check", () => {
  it("runs when the baseline differs from the inputs", async () => {
    db.Bill[0].amount = 75; // edited while a run could not finish
    mount({ startupDelayMs: 1500 });
    await tick(1400);
    expect(fetchMock).not.toHaveBeenCalled();
    await tick(100);
    expect(planOptimize).toHaveBeenCalledTimes(1);
    expect(applyBatch).toHaveBeenCalledTimes(1);
  });

  it("runs when the horizon's last month has no planned rows yet", async () => {
    db.BillSplit = db.BillSplit.slice(0, -1); // a month rolled over since the last run
    mount({ startupDelayMs: 1500 });
    await tick(1500);
    expect(planOptimize).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the plan is up to date", async () => {
    mount({ startupDelayMs: 1500 });
    await tick(1500);
    expect(fetchMock).toHaveBeenCalled();
    expect(planOptimize).not.toHaveBeenCalled();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("does not use the horizon rule when there are no bills", async () => {
    db.Bill = [];
    db.BillSplit = [];
    db.AppSettings.optimizedInputsSig = JSON.stringify(sigsOf());
    mount({ startupDelayMs: 1500 });
    await tick(1500);
    expect(planOptimize).not.toHaveBeenCalled();
  });
});

describe("page unload", () => {
  it("a pending run is dropped once the page is going away (sandbox reload)", async () => {
    mount();
    db.Bill[0].amount = 75;
    act(() => {
      notifyInputWrite();
    });
    await tick(500);
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await tick(2000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(planOptimize).not.toHaveBeenCalled();
  });
});
