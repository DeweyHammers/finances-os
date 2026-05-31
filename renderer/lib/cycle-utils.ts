import { COLORS } from "./constants";

export const CYCLE_COLORS: Record<string, string> = {
  Q1: COLORS.gross,
  Q2: COLORS.tax,
  Q3: COLORS.net,
  Q4: "#c084fc",
};

export const getCycleColor = (cycle: string) =>
  CYCLE_COLORS[cycle] || COLORS.gross;

export type PaymentCycle = "WEEKLY" | "BI_WEEKLY" | "MONTHLY";

export const ALL_CYCLES = ["Q1", "Q2", "Q3", "Q4"] as const;

export const normalizePaymentCycle = (value: unknown): PaymentCycle => {
  if (value === "WEEKLY" || value === "BI_WEEKLY" || value === "MONTHLY") {
    return value;
  }
  return "WEEKLY";
};

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
