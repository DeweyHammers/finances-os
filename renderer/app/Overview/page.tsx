"use client";

import { useList, BaseRecord, useOne } from "@refinedev/core";
import { Box, CircularProgress } from "@mui/material";
import { BillsOverview } from "../../components/dashboard/BillsOverview";
import { PersonalOverview } from "../../components/dashboard/PersonalOverview";
import { YearlyOverview } from "../../components/dashboard/YearlyOverview";
import { CashFlowOverview } from "../../components/dashboard/CashFlowOverview";
import { SHORT_MONTHS } from "../../lib/constants";

export default function Overview() {
  const { query: billsQuery } = useList<BaseRecord>({ resource: "Bill" });
  const { query: personalQuery } = useList<BaseRecord>({ resource: "Personal" });
  const { query: yearlyQuery } = useList<BaseRecord>({ resource: "YearlyCost" });
  const { query: settingsQuery } = useOne<BaseRecord>({
    resource: "AppSettings",
    id: "global",
  });

  if (
    billsQuery.isLoading ||
    personalQuery.isLoading ||
    yearlyQuery.isLoading ||
    settingsQuery.isLoading
  ) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 8 }}>
        <CircularProgress size={60} thickness={4} />
      </Box>
    );
  }

  const bills = (billsQuery.data?.data || []) as any[];
  const personalBills = (personalQuery.data?.data || []) as any[];
  const yearlyCosts = (yearlyQuery.data?.data || []) as any[];
  const settings = settingsQuery.data?.data || {};

  return (
    <Box sx={{ p: 4, display: "flex", flexDirection: "column", gap: 4 }}>
      <Box sx={{ display: "flex", justifyContent: "center" }}>
        <CashFlowOverview
          settings={settings}
          bills={bills}
          personalBills={personalBills}
        />
      </Box>
      <BillsOverview bills={bills} settings={settings} />
      <PersonalOverview personalBills={personalBills} settings={settings} />
      <YearlyOverview yearlyCosts={yearlyCosts} months={SHORT_MONTHS} />
    </Box>
  );
}
