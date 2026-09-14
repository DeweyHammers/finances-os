/**
 * stats-utils — pure aggregation helpers for the /Statistics page.
 *
 * Given raw AccountTransactions + BudgetCategoryItems/Groups/Payees, produces
 * the derived `MonthlySpend[]` shape consumed by MonthlyStackedBars and
 * MonthlyPie, plus KPI helpers (yearly totals, weekly income avg, item colors).
 * All amounts are in cents throughout; only the chart's y-axis converts to dollars.
 */

import { SHORT_MONTHS } from "../../../lib/constants";

// Raw transaction shape (narrower than the full Prisma model — only the fields
// stats actually touches). Accepts either ISO string or Date since Refine can
// yield either depending on the resource adapter.
export interface StatsTransaction {
  date: string | Date;
  categoryItemId: string | null;
  categoryName: string | null;   // snapshot copied at write time; survives category deletion
  payeeId: string | null;
  memo: string | null;
  inflowCents: number;
  outflowCents: number;
}

// Synthetic bucket used when a transaction's category has been deleted from the
// budget. Preserves the historical `categoryName` snapshot instead of dropping
// the money from stats. All orphans coalesce into a single "Removed Items" group.
const REMOVED_GROUP_ID = "__removed__";
const REMOVED_GROUP_NAME = "Removed Items";

// Deterministic key so multiple transactions that reference the same
// (now-deleted) category name still group into one slice/bar segment.
const orphanItemId = (snapshotName: string): string =>
  `__removed__${snapshotName.trim().toLowerCase()}`;

export interface StatsCategoryItem {
  id: string;
  name: string;
  groupId: string;
  sortOrder: number;
}

export interface StatsCategoryGroup {
  id: string;
  name: string;
  sortOrder: number;
}

export interface StatsPayee {
  id: string;
  name: string;
}

// Convention: only inflow transactions whose memo is exactly "income" count
// toward income stats. This distinguishes real paychecks from refunds/transfers
// (which are also inflows but should not inflate income KPIs).
export const INCOME_MEMO = "income";

export const isIncomeTransaction = (t: StatsTransaction): boolean => {
  if ((t.inflowCents || 0) <= 0) return false;
  const m = (t.memo || "").trim().toLowerCase();
  return m === INCOME_MEMO;
};

export interface ItemSpend {
  itemId: string;
  itemName: string;
  groupId: string;
  groupName: string;
  cents: number;
}

export interface MonthlySpend {
  monthIndex: number;
  monthLabel: string;
  totalCents: number;
  items: ItemSpend[];
}

const toDate = (v: string | Date): Date =>
  typeof v === "string" ? new Date(v) : v;

// Returns every year that has at least one transaction, plus the current year
// (so the picker still lets you jump to "now" even when no data exists yet).
// Descending order — most recent first.
export const listYearsForData = (transactions: StatsTransaction[]): number[] => {
  const years = new Set<number>();
  transactions.forEach((t) => {
    const d = toDate(t.date);
    if (Number.isFinite(d.getTime())) years.add(d.getUTCFullYear());
  });
  years.add(new Date().getUTCFullYear());
  return Array.from(years).sort((a, b) => b - a);
};

// Build the 12-month spending series for a given year.
// Rules:
//  - `cents = outflow - inflow` per txn; refunds (positive inflow against a
//    category) reduce that item's spend total for the month.
//  - Only positive net-outflow transactions count toward spending.
//  - Live categories (still in the budget) resolve to their current name.
//  - Deleted categories fall back to the snapshot `categoryName` and bucket
//    into the synthetic "Removed Items" group.
//  - Fully-uncategorized outflows (no live item, no snapshot) are dropped —
//    they can't be attributed to any bar segment.
export const computeYearlySpending = (params: {
  year: number;
  transactions: StatsTransaction[];
  items: StatsCategoryItem[];
  groups: StatsCategoryGroup[];
}): MonthlySpend[] => {
  const { year, transactions, items, groups } = params;
  const itemById = new Map(items.map((i) => [i.id, i]));
  const groupById = new Map(groups.map((g) => [g.id, g]));

  return Array.from({ length: 12 }, (_, monthIndex) => {
    const itemMap = new Map<string, ItemSpend>();

    transactions.forEach((t) => {
      const d = toDate(t.date);
      if (!Number.isFinite(d.getTime())) return;
      if (d.getUTCFullYear() !== year || d.getUTCMonth() !== monthIndex) return;

      // Net-of-refund spend for this transaction. Skip zero/negative rows.
      const cents = (t.outflowCents || 0) - (t.inflowCents || 0);
      if (cents <= 0) return;

      const liveItem = t.categoryItemId ? itemById.get(t.categoryItemId) : undefined;
      const snapshotName = (t.categoryName || "").trim();

      let key: string;
      let resolvedName: string;
      let resolvedGroupId: string;
      let resolvedGroupName: string;

      if (liveItem) {
        const group = groupById.get(liveItem.groupId);
        key = liveItem.id;
        resolvedName = liveItem.name;
        resolvedGroupId = liveItem.groupId;
        resolvedGroupName = group?.name ?? "";
      } else if (snapshotName) {
        key = orphanItemId(snapshotName);
        resolvedName = snapshotName;
        resolvedGroupId = REMOVED_GROUP_ID;
        resolvedGroupName = REMOVED_GROUP_NAME;
      } else {
        return;
      }

      const existing = itemMap.get(key);
      if (existing) {
        existing.cents += cents;
      } else {
        itemMap.set(key, {
          itemId: key,
          itemName: resolvedName,
          groupId: resolvedGroupId,
          groupName: resolvedGroupName,
          cents,
        });
      }
    });

    // Descending sort → biggest categories render at the bottom of each
    // stacked bar and appear first in the pie legend.
    const ordered = Array.from(itemMap.values()).sort(
      (a, b) => b.cents - a.cents,
    );

    return {
      monthIndex,
      monthLabel: SHORT_MONTHS[monthIndex],
      totalCents: ordered.reduce((s, it) => s + it.cents, 0),
      items: ordered,
    };
  });
};

// Fixed palette shared by pies + stacked bars. Chosen for good contrast on the
// dark slate-900 background AND acceptable distinctness up to ~16 items
// (typical budgets have far fewer live categories at once).
const ITEM_PALETTE = [
  "#818cf8", // indigo
  "#2dd4bf", // teal
  "#fbbf24", // amber
  "#f87171", // red
  "#c084fc", // purple
  "#34d399", // emerald
  "#60a5fa", // blue
  "#fb923c", // orange
  "#f472b6", // pink
  "#a3e635", // lime
  "#22d3ee", // cyan
  "#facc15", // yellow
  "#a78bfa", // violet
  "#4ade80", // green
  "#fda4af", // rose
  "#fcd34d", // gold
];

// Mirror of computeYearlySpending but for income transactions (memo="income").
// Instead of grouping by category/group, groups by payee (income "source").
// Reuses the MonthlySpend/ItemSpend shape so both charts render identically.
export const computeYearlyIncome = (params: {
  year: number;
  transactions: StatsTransaction[];
  payees: StatsPayee[];
}): MonthlySpend[] => {
  const { year, transactions, payees } = params;
  const payeeById = new Map(payees.map((p) => [p.id, p]));
  // Coalesces every payeeless income row into one "Unknown source" bucket.
  const UNKNOWN = "__unknown_payee__";

  return Array.from({ length: 12 }, (_, monthIndex) => {
    const itemMap = new Map<string, ItemSpend>();

    transactions.forEach((t) => {
      if (!isIncomeTransaction(t)) return;
      const d = toDate(t.date);
      if (!Number.isFinite(d.getTime())) return;
      if (d.getUTCFullYear() !== year || d.getUTCMonth() !== monthIndex) return;

      const key = t.payeeId || UNKNOWN;
      const payee = t.payeeId ? payeeById.get(t.payeeId) : undefined;
      const name = payee?.name || "Unknown source";
      const cents = t.inflowCents || 0;

      const existing = itemMap.get(key);
      if (existing) {
        existing.cents += cents;
      } else {
        itemMap.set(key, {
          itemId: key,
          itemName: name,
          groupId: "",
          groupName: "",
          cents,
        });
      }
    });

    const ordered = Array.from(itemMap.values()).sort(
      (a, b) => b.cents - a.cents,
    );

    return {
      monthIndex,
      monthLabel: SHORT_MONTHS[monthIndex],
      totalCents: ordered.reduce((s, it) => s + it.cents, 0),
      items: ordered,
    };
  });
};

// Compute ISO-8601 week identifier ("2026-W7").
// ISO weeks start on Monday and week 1 is the one containing Jan 4th.
// The "+4 - day" trick pins the date to the Thursday of its ISO week, which is
// how ISO-8601 defines the week's year — this correctly attributes Dec 30 2024
// (a Monday) to "2025-W1" instead of "2024-W53".
const isoWeekKey = (date: Date): string => {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNum}`;
};

// "Weekly Average" KPI for the income series. Averages over active weeks only
// (weeks that had at least $0.01 of income), so a mid-year start doesn't drag
// the average toward zero.
export const computeWeeklyIncomeKpi = (params: {
  year: number;
  transactions: StatsTransaction[];
}): { total: number; activeWeeks: number; avg: number } => {
  const { year, transactions } = params;
  const totals = new Map<string, number>();

  transactions.forEach((t) => {
    if (!isIncomeTransaction(t)) return;
    const d = toDate(t.date);
    if (!Number.isFinite(d.getTime())) return;
    if (d.getUTCFullYear() !== year) return;

    const key = isoWeekKey(d);
    totals.set(key, (totals.get(key) || 0) + (t.inflowCents || 0));
  });

  let total = 0;
  let activeWeeks = 0;
  totals.forEach((cents) => {
    if (cents > 0) {
      total += cents;
      activeWeeks += 1;
    }
  });

  return {
    total,
    activeWeeks,
    avg: activeWeeks > 0 ? total / activeWeeks : 0,
  };
};

// Roll-up used by the tile row above the yearly chart. Avg is over active
// months only (same rationale as computeWeeklyIncomeKpi) — a partial year
// shouldn't average as though the missing months were $0.
export const computeKpis = (months: MonthlySpend[]) => {
  const total = months.reduce((s, m) => s + m.totalCents, 0);
  const nonZeroMonths = months.filter((m) => m.totalCents > 0).length;
  const avg = nonZeroMonths > 0 ? total / nonZeroMonths : 0;
  const highest = months.reduce(
    (best, m) => (m.totalCents > best.totalCents ? m : best),
    months[0],
  );
  return { total, nonZeroMonths, avg, highest };
};

// Deterministic color for an item/payee id.
//  - Live items: color = palette[index-in-list] so a category's color stays
//    stable as long as the item ordering doesn't shift.
//  - Orphaned items (deleted; not in `allItems`): fall back to a djb2-style
//    string hash of the id, so historical rows still get a consistent color
//    across renders without relying on any lookup.
export const itemColor = (
  itemId: string,
  allItems: { id: string }[],
): string => {
  const idx = allItems.findIndex((i) => i.id === itemId);
  if (idx < 0) {
    let h = 0;
    for (let i = 0; i < itemId.length; i++) {
      h = (h * 31 + itemId.charCodeAt(i)) >>> 0;
    }
    return ITEM_PALETTE[h % ITEM_PALETTE.length];
  }
  return ITEM_PALETTE[idx % ITEM_PALETTE.length];
};
