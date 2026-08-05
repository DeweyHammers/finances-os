"use client";

import { useOne, useList } from "@refinedev/core";
import {
  getCycleOptionsForPaymentCycle,
  getCyclesForPaymentCycle,
  normalizePaymentCycle,
  PaymentCycle,
  CycleOption,
} from "./cycle-utils";

interface UsePaymentCycleResult {
  paymentCycle: PaymentCycle;
  cycles: string[];
  options: CycleOption[];
  payDay: number;
  isLoading: boolean;
}

export const usePaymentCycle = (): UsePaymentCycleResult => {
  const { query: settingsQuery } = useOne({
    resource: "AppSettings",
    id: "global",
    queryOptions: { staleTime: 60_000 },
  });
  const { query: incomesQuery } = useList({
    resource: "Income",
    pagination: { mode: "off" },
    queryOptions: { staleTime: 60_000 },
  });

  const incomes = (incomesQuery.data?.data as any[]) ?? [];
  const primaryIncome = incomes.find((i) => i.isPrimary);
  const settings = settingsQuery.data?.data as any;

  // Primary income's cycle/payDay drives the app; fall back to AppSettings
  // for backward compat when no income records exist yet.
  const rawCycle =
    primaryIncome?.paymentCycle ?? settings?.paymentCycle;
  const paymentCycle = normalizePaymentCycle(rawCycle);
  const payDay = Number(primaryIncome?.payDay ?? settings?.payDay ?? 3);

  return {
    paymentCycle,
    cycles: getCyclesForPaymentCycle(paymentCycle),
    options: getCycleOptionsForPaymentCycle(paymentCycle),
    payDay,
    isLoading: settingsQuery.isLoading || incomesQuery.isLoading,
  };
};
