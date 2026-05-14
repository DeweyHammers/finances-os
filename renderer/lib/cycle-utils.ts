import { COLORS } from "./constants";

export const CYCLE_COLORS: Record<string, string> = {
  Q1: COLORS.gross,
  Q2: COLORS.tax,
  Q3: COLORS.net,
  Q4: "#c084fc",
};

export const getCycleColor = (cycle: string) =>
  CYCLE_COLORS[cycle] || COLORS.gross;

export const getCyclesForPaymentCycle = (_paymentCycle?: string) => [
  "Q1",
  "Q2",
  "Q3",
  "Q4",
];
