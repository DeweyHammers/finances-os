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

// ── Dialog surfaces (Nov 25 2026) ──
// Every dialog has two grounds: the form on the dialog's own surface (the
// theme's `background.paper`), and a slightly darker BAND for what frames it —
// the title and button rows of the form dialogs (theme override in
// app/providers.tsx) and the tab column of the Settings popup
// (components/settings). One pair of values so they can never drift apart:
// the app canvas colour laid half-transparent over the surface, so it reads as
// "a bit darker than the form" on any paper colour, and its hairline.
export const DIALOG_BAND_BG = "rgba(15, 23, 42, 0.5)";
export const DIALOG_BAND_BORDER = "rgba(148, 163, 184, 0.14)";

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

/**
 * MUI breakpoint key below which the sider becomes a drawer, the top bar
 * shows the hamburger and Settings is a page instead of a popup. `md` =
 * 900px. Lives here (not in CustomSider) so components that CustomSider
 * itself imports can read it without an import cycle.
 */
export const SIDER_BREAKPOINT = "md" as const;
