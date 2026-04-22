"use client";

import { useState, useEffect } from "react";

export const usePaymentCycle = () => {
  const [paymentCycle, setPaymentCycle] = useState("BI_WEEKLY");
  const [isLoading, setIsLoading] = useState(true);

  const fetchSettings = async () => {
    try {
      const res = await fetch("http://localhost:8888/api/AppSettings/global");
      if (res.ok) {
        const data = await res.json();
        if (data.paymentCycle) {
          setPaymentCycle(data.paymentCycle);
        }
      }
    } catch (e) {
      console.error("Failed to fetch payment cycle", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const getCycleOptions = () => {
    if (paymentCycle === "WEEKLY") {
      return [
        { value: "Q1", label: "Q1 (Week 1)" },
        { value: "Q2", label: "Q2 (Week 2)" },
        { value: "Q3", label: "Q3 (Week 3)" },
        { value: "Q4", label: "Q4 (Week 4)" },
      ];
    }
    if (paymentCycle === "BI_WEEKLY") {
      return [
        { value: "Q1", label: "Q1 (Mid-Month)" },
        { value: "Q2", label: "Q2 (End-of-Month)" },
      ];
    }
    return [{ value: "MONTH", label: "Monthly" }];
  };

  return {
    paymentCycle,
    options: getCycleOptions(),
    isLoading,
  };
};
