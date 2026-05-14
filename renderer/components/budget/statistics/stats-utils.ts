import { SHORT_MONTHS } from "../../../lib/constants";

export interface StatsTransaction {
  date: string | Date;
  categoryItemId: string | null;
  payeeId: string | null;
  memo: string | null;
  inflowCents: number;
  outflowCents: number;
}

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
      if (!t.categoryItemId) return;
      const d = toDate(t.date);
      if (!Number.isFinite(d.getTime())) return;
      if (d.getUTCFullYear() !== year || d.getUTCMonth() !== monthIndex) return;

      const item = itemById.get(t.categoryItemId);
      if (!item) return;
      const group = groupById.get(item.groupId);

      const cents = (t.outflowCents || 0) - (t.inflowCents || 0);
      if (cents <= 0) return;

      const existing = itemMap.get(item.id);
      if (existing) {
        existing.cents += cents;
      } else {
        itemMap.set(item.id, {
          itemId: item.id,
          itemName: item.name,
          groupId: item.groupId,
          groupName: group?.name ?? "",
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
