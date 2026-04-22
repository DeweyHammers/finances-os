import { addDays, startOfDay } from "date-fns";

export const parseDateSafe = (dateStr: string | null | undefined) => {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  // Return a local date object that matches the UTC parts
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

/**
 * Calculates gross earnings for a specific week (Sunday to Saturday)
 * Includes:
 * 1. Hourly contracts active during the week (if includeProjections = true)
 * 2. Explicit ContractEntry (always included)
 * 3. Fixed contracts with a completedDate in this week (only if includeProjections = true or no entries exist)
 */
export const calculateWeeklyGrossEarnings = (
  sunday: Date,
  contracts: any[],
  earnings: any[] = [],
  includeProjections: boolean = true,
) => {
  const saturday = addDays(sunday, 6);
  const sundayTime = startOfDay(sunday).getTime();
  const saturdayTime = startOfDay(saturday).getTime();

  const contractGross = contracts.reduce((acc, c) => {
    // Sum all explicit entries for this contract in this week
    const weeklyEntries = (c.entries || []).filter((entry: any) => {
      const entryDate = new Date(entry.date);
      const entryTime = startOfDay(entryDate).getTime();
      return entryTime >= sundayTime && entryTime <= saturdayTime;
    });

    if (weeklyEntries.length > 0) {
      const totalGross = weeklyEntries.reduce((sum: number, e: any) => sum + (Number(e.grossPay) || 0), 0);
      return acc + totalGross;
    }

    // If no entry, handle projections/fallback
    if (c.type === "HOURLY") {
      if (!includeProjections) return acc;
      if (c.status !== "ACTIVE") return acc;

      const cStart = parseDateSafe(c.startDate);
      const cEnd = parseDateSafe(c.endDate);

      const isActiveThisWeek =
        (!cStart || cStart <= saturday) && (!cEnd || cEnd >= sunday);

      if (isActiveThisWeek) {
        return acc + Number(c.grossRate) * Number(c.weeklyHours || 0);
      }
    } else if (c.type === "FIXED") {
      // For FIXED, if there's no entry, we only use completedDate if projections are ON
      // This prevents "ghost" earnings from showing in EDD reports before you log them.
      if (!includeProjections) return acc;

      const cCompleted = parseDateSafe(c.completedDate);
      if (cCompleted) {
        const completedTime = cCompleted.getTime();
        if (completedTime >= sundayTime && completedTime <= saturdayTime) {
          return acc + Number(c.grossRate);
        }
      }
    }
    return acc;
  }, 0);

  // We intentionally exclude 'earnings' (manual income log) from EDD calculations.
  // EDD reporting is based on when money is EARNED, and manual income logs
  // usually represent unwithdrawn balance or past work, which would cause
  // double-counting or incorrect deductions if included here.
  const logGross = 0;

  return contractGross + logGross;
};

/**
 * Calculates net earnings for a specific week (Sunday to Saturday)
 */
export const calculateWeeklyNetEarnings = (
  sunday: Date,
  contracts: any[],
  includeProjections: boolean = true,
) => {
  const saturday = addDays(sunday, 6);
  const sundayTime = startOfDay(sunday).getTime();
  const saturdayTime = startOfDay(saturday).getTime();

  return contracts.reduce((acc, c) => {
    // Sum all explicit entries for this contract in this week
    const weeklyEntries = (c.entries || []).filter((entry: any) => {
      const entryDate = new Date(entry.date);
      const entryTime = startOfDay(entryDate).getTime();
      return entryTime >= sundayTime && entryTime <= saturdayTime;
    });

    if (weeklyEntries.length > 0) {
      const totalNet = weeklyEntries.reduce((sum: number, e: any) => sum + (Number(e.netPay) || 0), 0);
      return acc + totalNet;
    }

    if (c.type === "HOURLY") {
      if (!includeProjections) return acc;
      if (c.status !== "ACTIVE") return acc;

      const cStart = parseDateSafe(c.startDate);
      const cEnd = parseDateSafe(c.endDate);

      const isActiveThisWeek =
        (!cStart || cStart <= saturday) && (!cEnd || cEnd >= sunday);

      if (isActiveThisWeek) {
        return acc + Number(c.netRate) * Number(c.weeklyHours || 0);
      }
    } else if (c.type === "FIXED" && c.status === "COMPLETED") {
      if (!includeProjections) return acc;

      const cCompleted = parseDateSafe(c.completedDate);
      if (cCompleted) {
        const completedTime = startOfDay(cCompleted).getTime();
        if (completedTime >= sundayTime && completedTime <= saturdayTime) {
          return acc + Number(c.netRate);
        }
      }
    }
    return acc;
  }, 0);
};

/**
 * Calculates EDD benefit for a specific week based on gross earnings
 */
export const calculateWeeklyEddBenefit = (
  sunday: Date,
  contracts: any[],
  settings: any,
  earnings: any[] = [],
  includeProjections: boolean = true,
) => {
  const baseWba = Number(settings.baseEddWeeklyAmount) || 0;
  if (!settings.eddActive || baseWba <= 0) return 0;

  let weeklyGrossEarnings = calculateWeeklyGrossEarnings(
    sunday,
    contracts,
    earnings,
    includeProjections,
  );

  // Include W2 if active
  if (settings.w2Active) {
    weeklyGrossEarnings += Number(settings.w2Amount) || 0;
  }

  if (weeklyGrossEarnings <= 0) return baseWba;

  let deduction = 0;
  if (weeklyGrossEarnings <= 100) {
    deduction = Math.max(0, weeklyGrossEarnings - 25);
  } else {
    deduction = weeklyGrossEarnings * 0.75;
  }

  return Math.max(0, baseWba - deduction);
};
