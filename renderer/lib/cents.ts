/**
 * cents — Money conversion + display helpers.
 *
 * All budget/bill math in the app runs in integer cents to avoid the classic
 * IEEE-754 rounding drift (e.g. 0.1 + 0.2 !== 0.3). Prisma Decimal values
 * from Bill/Personal amounts are typically already dollars; use `toCents` at
 * the boundary and `fromCents` only when handing values back to a Decimal
 * column or display formatter. `formatMoney` is the canonical UI formatter —
 * uses toLocaleString on the whole-dollar portion so thousands separators
 * appear (e.g. "$1,234.56").
 */

/**
 * Converts a dollar amount (number or user-typed string) to an integer cent
 * value. Strings are tolerant of commas and leading/trailing whitespace, and
 * unparseable / non-finite input coerces to 0 rather than throwing — this
 * lets input change handlers pipe raw values straight through without extra
 * guards.
 */
export const toCents = (dollars: number | string): number => {
  if (typeof dollars === "string") {
    const trimmed = dollars.trim().replace(/,/g, "");
    // Empty or a lone dash (user mid-typing a negative number) is 0.
    if (trimmed === "" || trimmed === "-") return 0;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100);
  }
  if (!Number.isFinite(dollars)) return 0;
  return Math.round(dollars * 100);
};

/**
 * Inverse of `toCents`. Returns a fractional dollar amount. Non-finite input
 * coerces to 0 for defensive safety at UI boundaries.
 */
export const fromCents = (cents: number): number => {
  if (!Number.isFinite(cents)) return 0;
  return cents / 100;
};

/**
 * Formats a cent value as USD. Handles negatives ("-$12.34") and, when
 * `withSign` is true, prefixes positives with "+" (used for deltas / change
 * pills in the Plan and Overview UIs).
 */
export const formatMoney = (
  cents: number,
  options: { withSign?: boolean } = {},
): string => {
  if (!Number.isFinite(cents)) cents = 0;
  const negative = cents < 0;
  const abs = Math.abs(cents);
  // Split into whole dollars + remainder so we can drop toLocaleString onto
  // just the integer portion (Number.toLocaleString on 1234.56 would give
  // "1,234.56" but with locale-dependent decimal separators — safer to
  // handcraft the "$D,DDD.CC" shape.
  const dollars = Math.floor(abs / 100);
  const remainder = abs - dollars * 100;
  const formatted = `$${dollars.toLocaleString()}.${remainder.toString().padStart(2, "0")}`;
  if (negative) return `-${formatted}`;
  if (options.withSign && cents > 0) return `+${formatted}`;
  return formatted;
};
