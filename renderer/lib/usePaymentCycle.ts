"use client";

import { useOne } from "@refinedev/core";
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
  isLoading: boolean;
}

export const usePaymentCycle = (): UsePaymentCycleResult => {
  const { query } = useOne({
    resource: "AppSettings",
    id: "global",
    queryOptions: { staleTime: 60_000 },
  });

  const raw = (query.data?.data as any)?.paymentCycle;
  const paymentCycle = normalizePaymentCycle(raw);

  return {
    paymentCycle,
    cycles: getCyclesForPaymentCycle(paymentCycle),
    options: getCycleOptionsForPaymentCycle(paymentCycle),
    isLoading: query.isLoading,
  };
};
