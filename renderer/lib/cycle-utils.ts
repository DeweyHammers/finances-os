/**
 * cycle-utils — Payment-cycle vocabulary and cycle-code palette.
 *
 * The app supports three payment cadences (`PaymentCycle`) which determine
 * how many quarter-codes (Q1..Q4) are legal. A bill/personal's
 * `withdrawalCycle` field stores which quarter it hits. Switching cadences
 * (e.g. WEEKLY → BI_WEEKLY) collapses the cycle domain, so records with
 * now-invalid codes must be migrated to Q1 — see `cyclesRemovedByChange`
 * and `project_weekly_conversion.md` memory for the flow.
 */
import { COLORS } from "./constants";

/** Fixed color per quarter — used by chart legends and cycle chips. */
export const CYCLE_COLORS: Record<string, string> = {
  Q1: COLORS.gross,
  Q2: COLORS.tax,
  Q3: COLORS.net,
  Q4: "#c084fc",
};

/** Safe lookup — unknown cycle codes fall back to the Q1 (indigo) shade. */
export const getCycleColor = (cycle: string) =>
  CYCLE_COLORS[cycle] || COLORS.gross;

export type PaymentCycle = "WEEKLY" | "BI_WEEKLY" | "MONTHLY";

/** Superset of every cycle code the app has ever supported. */
export const ALL_CYCLES = ["Q1", "Q2", "Q3", "Q4"] as const;

/**
 * Coerces arbitrary values (settings coming out of Prisma, URL params, etc.)
 * to a valid PaymentCycle. Defaults to WEEKLY — the most granular option —
 * so an unrecognized value never silently truncates records.
 */
export const normalizePaymentCycle = (value: unknown): PaymentCycle => {
  if (value === "WEEKLY" || value === "BI_WEEKLY" || value === "MONTHLY") {
    return value;
  }
  return "WEEKLY";
};

/**
 * Returns the ordered list of quarter codes valid for the given payment
 * cycle. WEEKLY = 4, BI_WEEKLY = 2, MONTHLY = 1. Used everywhere the UI
 * enumerates cycles (chips, filters, auto-assign passes).
 */
export const getCyclesForPaymentCycle = (
  paymentCycle?: string | null,
): string[] => {
  const pc = normalizePaymentCycle(paymentCycle);
  if (pc === "BI_WEEKLY") return ["Q1", "Q2"];
  if (pc === "MONTHLY") return ["Q1"];
  return ["Q1", "Q2", "Q3", "Q4"];
};

export interface CycleOption {
  value: string;
  label: string;
}

/**
 * Same as `getCyclesForPaymentCycle` but returns Select-style {value,label}
 * objects with human-readable week-range hints (e.g. "Q1 (Weeks 1-2)"
 * under BI_WEEKLY). Used by cycle dropdowns in Bill/Personal forms.
 */
export const getCycleOptionsForPaymentCycle = (
  paymentCycle?: string | null,
): CycleOption[] => {
  const pc = normalizePaymentCycle(paymentCycle);
  if (pc === "BI_WEEKLY") {
    return [
      { value: "Q1", label: "Q1 (Weeks 1-2)" },
      { value: "Q2", label: "Q2 (Weeks 3-4)" },
    ];
  }
  if (pc === "MONTHLY") {
    return [{ value: "Q1", label: "Q1 (Monthly)" }];
  }
  return [
    { value: "Q1", label: "Q1 (Week 1)" },
    { value: "Q2", label: "Q2 (Week 2)" },
    { value: "Q3", label: "Q3 (Week 3)" },
    { value: "Q4", label: "Q4 (Week 4)" },
  ];
};

/**
 * Returns the set of cycle codes that are no longer valid when switching
 * from `from` to `to`. Used to warn users that records on those cycles
 * will be rolled forward to Q1.
 */
export const cyclesRemovedByChange = (
  from: string | null | undefined,
  to: string | null | undefined,
): string[] => {
  const before = new Set(getCyclesForPaymentCycle(from));
  const after = new Set(getCyclesForPaymentCycle(to));
  return Array.from(before).filter((c) => !after.has(c));
};
