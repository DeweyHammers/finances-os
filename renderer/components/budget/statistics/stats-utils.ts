import { SHORT_MONTHS } from "../../../lib/constants";

export interface StatsTransaction {
  date: string | Date;
  categoryItemId: string | null;
  categoryName: string | null;
  payeeId: string | null;
  memo: string | null;
  inflowCents: number;
  outflowCents: number;
}

const REMOVED_GROUP_ID = "__removed__";
const REMOVED_GROUP_NAME = "Removed Items";

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

export const listYearsForData = (transactions: StatsTransaction[]): number[] => {
  const years = new Set<number>();
  transactions.forEach((t) => {
    const d = toDate(t.date);
    if (Number.isFinite(d.getTime())) years.add(d.getUTCFullYear());
  });
  years.add(new Date().getUTCFullYear());
  return Array.from(years).sort((a, b) => b - a);
};

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

export const computeYearlyIncome = (params: {
  year: number;
  transactions: StatsTransaction[];
  payees: StatsPayee[];
}): MonthlySpend[] => {
  const { year, transactions, payees } = params;
  const payeeById = new Map(payees.map((p) => [p.id, p]));
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

const isoWeekKey = (date: Date): string => {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNum}`;
};

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
