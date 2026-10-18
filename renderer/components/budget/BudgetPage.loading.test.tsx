/**
 * Regression (Oct 2026, seen in PROD): opening the app flashed
 * "$20,482.09 Ready to Assign" for a frame before settling to $0.00.
 *
 * Cause: the Ready-to-Assign pill (and the Sync Plan button) render ABOVE the
 * page's isLoading gate. On launch the transactions query resolves before the
 * BudgetMonth (assignments) query, so for one render RTA = all inflows − $0.
 *
 * Contract pinned here: while any Plan query is still loading, the pill shows
 * no amount and no Assign button; once everything has loaded it shows the
 * real value. Generic sample data only (this file is committed).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ── Minimal fake @refinedev/core ──
// `loading` lists the resources whose query is still in flight.
const state = vi.hoisted(() => ({ loading: new Set<string>() }));

const ROWS: Record<string, any[]> = {
  BudgetCategoryGroup: [{ id: "g1", name: "Checking", sortOrder: 0 }],
  BudgetCategorySubsection: [],
  BudgetCategoryItem: [
    { id: "i1", groupId: "g1", subsectionId: null, name: "Groceries", sortOrder: 0, sourceType: "CUSTOM", customAmountCents: 100000, customCycle: null },
  ],
  // $1,000 paycheck in, fully assigned to Groceries this month → RTA $0.
  AccountTransaction: [
    { id: "t1", accountId: "a1", date: "2026-10-07T12:00:00.000Z", categoryItemId: null, inflowCents: 100000, outflowCents: 0, memo: "Income", cleared: true },
  ],
  BudgetMonth: [{ id: "m1", month: "2026-10-01T00:00:00.000Z", categoryItemId: "i1", assignedCents: 100000 }],
  Bill: [],
  Personal: [],
  BillSplit: [],
  Income: [{ id: "inc1", name: "Paycheck", amount: 1000, paymentCycle: "WEEKLY", payDay: 3, payWeekOffset: 0, isPrimary: true }],
};
const SETTINGS = { id: "global", payDay: 3, paymentCycle: "WEEKLY", wifeWeeklyTargetCents: 25000 };

vi.mock("@refinedev/core", () => {
  const result = (resource: string, data: any) => {
    const loading = state.loading.has(resource);
    return { query: { data: loading ? undefined : { data }, isLoading: loading, isFetching: loading }, result: data };
  };
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(async () => ({})) });
  return {
    useList: ({ resource }: { resource: string }) => result(resource, ROWS[resource] ?? []),
    useOne: ({ resource }: { resource: string }) => result(resource, resource === "AppSettings" ? SETTINGS : undefined),
    useCreate: mutation,
    useUpdate: mutation,
    useDelete: mutation,
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/Plan",
  useSearchParams: () => new URLSearchParams(),
}));

import { BudgetPage } from "./BudgetPage";

// Visible text only: `visibility: hidden` content doesn't count as shown.
const isVisible = (el: HTMLElement | null) => {
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    if (getComputedStyle(n).visibility === "hidden") return false;
  }
  return !!el;
};

describe("Plan page — no Ready-to-Assign flash while loading", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 18, 12, 0, 0));
    state.loading.clear();
  });

  it("shows no amount or Assign button while assignments are still loading", () => {
    // The PROD launch order: transactions resolved, BudgetMonth not yet.
    state.loading.add("BudgetMonth");
    render(<BudgetPage />);
    expect(isVisible(screen.queryByText("$1,000.00"))).toBe(false);
    expect(isVisible(screen.queryByText("Ready to Assign"))).toBe(false);
    expect(screen.queryByRole("button", { name: /^Assign$/ })).toBeNull();
    vi.useRealTimers();
  });

  it("shows the real value once everything has loaded", () => {
    render(<BudgetPage />);
    expect(isVisible(screen.getByText("$0.00"))).toBe(true);
    expect(isVisible(screen.getByText("All Money Assigned"))).toBe(true);
    vi.useRealTimers();
  });
});
