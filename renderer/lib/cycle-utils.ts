import { COLORS } from "./constants";

export const CYCLE_COLORS: Record<string, string> = {
  Q1: COLORS.gross, // Indigo
  Q2: COLORS.tax,   // Amber
  Q3: "#a855f7",    // Purple
  Q4: "#06b6d4",    // Cyan
  MONTH: COLORS.hand, // Emerald
};

export const getCycleColor = (cycle: string) =>
  CYCLE_COLORS[cycle] || COLORS.gross;

export const getCyclesForPaymentCycle = (paymentCycle: string) => {
  if (paymentCycle === "WEEKLY") return ["Q1", "Q2", "Q3", "Q4"];
  if (paymentCycle === "BI_WEEKLY") return ["Q1", "Q2"];
  return ["MONTH"];
};
