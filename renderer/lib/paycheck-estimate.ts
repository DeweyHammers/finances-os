/**
 * paycheck-estimate — what a paycheck comes to for a given number of hours.
 *
 * Used ONLY by the per-week editor on the Income page (IncomePaychecks.tsx)
 * to fill in the amount when the user types "32 hours this week". The result
 * is a suggestion in an editable field; the plan itself only ever reads the
 * amount that gets saved (the IncomeOverride row), never this estimate.
 *
 * It works the way a pay stub does (user's stub, Nov 10 2026):
 *
 *     gross pay              scales with the hours
 *   − taxes                  scale with the hours too
 *   − flat deductions        the same every paycheck (union dues)
 *   = take-home              what the Income's `amount` is
 *
 * The income stores the take-home for its regular hours plus, optionally, the
 * taxes and flat deductions that came out of it. Gross is never stored: it is
 * take-home + taxes + flat deductions. For other hours every scaling part is
 * multiplied by hours / regular hours and the flat part is subtracted as is.
 *
 * Why not just scale the take-home? Because the flat part does not shrink:
 * with $20 of dues, a 32-hour week pays LESS than 80% of a 40-hour one.
 * (Algebraically the taxes cancel out — take-home = (regular take-home + flat)
 * × ratio − flat — so they only matter for the breakdown shown to the user;
 * with no flat deductions the estimate is plain proportional scaling.)
 *
 * Taxes are treated as proportional. Most of a US stub is (Social Security,
 * Medicare, state disability are flat percentages); income-tax withholding
 * falls a little faster than the hours, so a short week is estimated slightly
 * LOW and a long one slightly high — the safe direction for a budget. The
 * user corrects the amount from the real stub.
 */

/** The regular paycheck, as stored on the Income row. */
export interface PaycheckBasis {
  /** Take-home for the regular hours (Income.amount), dollars. */
  amount: number;
  /** Regular hours (Income.baseHours). Without them nothing can be scaled. */
  baseHours: number | null;
  /** Taxes taken out of the regular paycheck (Income.baseTaxes); scale with hours. */
  taxes?: number | null;
  /** Deductions that are the same every paycheck (Income.baseFlatDeductions). */
  flatDeductions?: number | null;
}

/** A paycheck for some number of hours; `gross − taxes − flatDeductions = takeHome` to the cent. */
export interface PaycheckEstimate {
  gross: number;
  taxes: number;
  flatDeductions: number;
  takeHome: number;
}

const toCents = (dollars: number) => Math.round(dollars * 100);
/** A stored optional money field as a non-negative number of dollars (junk → 0). */
const money = (value: number | null | undefined) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * The basis fields off a raw Income row (loose values straight off the REST
 * boundary). `baseHours` is null unless it is a positive number.
 */
export function paycheckBasisOf(income: {
  amount?: unknown;
  baseHours?: unknown;
  baseTaxes?: unknown;
  baseFlatDeductions?: unknown;
}): PaycheckBasis {
  const hours = Number(income.baseHours);
  return {
    amount: Number(income.amount) || 0,
    baseHours: income.baseHours != null && Number.isFinite(hours) && hours > 0 ? hours : null,
    taxes: money(income.baseTaxes as number),
    flatDeductions: money(income.baseFlatDeductions as number),
  };
}

/** The regular paycheck itself, broken down (hours = regular hours). */
export function regularPaycheck(basis: PaycheckBasis): PaycheckEstimate {
  const taxes = money(basis.taxes);
  const flatDeductions = money(basis.flatDeductions);
  return {
    gross: (toCents(basis.amount) + toCents(taxes) + toCents(flatDeductions)) / 100,
    taxes,
    flatDeductions,
    takeHome: basis.amount,
  };
}

/**
 * The paycheck for `hours`, or null when it cannot be estimated (no regular
 * hours on the income, or hours that are not a number ≥ 0).
 *
 * Each part is rounded to the cent on its own and the take-home is their
 * difference, so the breakdown shown to the user always adds up. A week with
 * so few hours that the flat deductions exceed the pay comes out as $0, not
 * a negative paycheck (0 hours = no paycheck, and nothing is deducted).
 */
export function estimatePaycheck(basis: PaycheckBasis, hours: number): PaycheckEstimate | null {
  if (basis.baseHours == null || !(basis.baseHours > 0)) return null;
  if (!Number.isFinite(hours) || hours < 0) return null;
  const regular = regularPaycheck(basis);
  const ratio = hours / basis.baseHours;
  const grossCents = Math.round(toCents(regular.gross) * ratio);
  const taxCents = Math.round(toCents(regular.taxes) * ratio);
  const flatCents = hours === 0 ? 0 : toCents(regular.flatDeductions);
  const takeHomeCents = Math.max(0, grossCents - taxCents - flatCents);
  return {
    gross: grossCents / 100,
    taxes: taxCents / 100,
    flatDeductions: flatCents / 100,
    takeHome: takeHomeCents / 100,
  };
}
