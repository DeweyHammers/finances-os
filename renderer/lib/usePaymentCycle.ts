/**
 * usePaymentCycle — React hook resolving the app's active payment cadence.
 *
 * Reads the primary Income record (source of truth) with a fall back to the
 * legacy AppSettings.paymentCycle / payDay fields for backward compatibility
 * with databases that predate the multi-income refactor. Returns the
 * normalized cadence + derived cycle codes/options + payday weekday so
 * consumers don't need to duplicate the fallback logic.
 *
 * Consumers include: Overview page (pay-period computation), BudgetPage
 * (auto-assign passes), Statistics filters, and any Bill/Personal form that
 * needs cycle Select options.
 */
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
  // 60s staleTime keeps this hook cheap when many components mount it on
  // the same route (Overview + BudgetPage + SurplusTargetPill all read it).
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
  // payDay is 0..6 (Sun..Sat). Default 3 = Wednesday, matching the app's
  // historical default before the Income table was introduced.
  const payDay = Number(primaryIncome?.payDay ?? settings?.payDay ?? 3);

  return {
    paymentCycle,
    cycles: getCyclesForPaymentCycle(paymentCycle),
    options: getCycleOptionsForPaymentCycle(paymentCycle),
    payDay,
    isLoading: settingsQuery.isLoading || incomesQuery.isLoading,
  };
};
