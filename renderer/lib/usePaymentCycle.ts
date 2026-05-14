"use client";

export const usePaymentCycle = () => ({
  paymentCycle: "WEEKLY",
  options: [
    { value: "Q1", label: "Q1 (Week 1)" },
    { value: "Q2", label: "Q2 (Week 2)" },
    { value: "Q3", label: "Q3 (Week 3)" },
    { value: "Q4", label: "Q4 (Week 4)" },
  ],
  isLoading: false,
});
