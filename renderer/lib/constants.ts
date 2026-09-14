/**
 * constants — App-wide color palette and month-name lookups.
 *
 * Colors are hex tokens shared by chart primitives (Statistics, CashFlow
 * bars, income breakdown pies) so a single tweak propagates everywhere.
 * The paired `cycle-utils.CYCLE_COLORS` map derives Q1..Q4 shades from these
 * base tokens. Month arrays are indexed 0..11 to line up directly with
 * `Date.getMonth()` — never re-order them.
 */
export const COLORS = {
  gross: "#818cf8", // Indigo — gross income / Q1 accent
  net: "#2dd4bf", // Teal — net income / Q3 accent
  tax: "#fbbf24", // Amber — tax portion / Q2 accent
  hand: "#10b981", // Emerald — take-home / positive hand-cash indicator
};

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
