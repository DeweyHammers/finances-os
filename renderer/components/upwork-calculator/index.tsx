"use client";

import { useState, useMemo } from "react";
import { useList, BaseRecord, useOne } from "@refinedev/core";
import { Box, Typography, Grid, CircularProgress } from "@mui/material";
import CalculateIcon from "@mui/icons-material/Calculate";

// Sub-components
import HourlyJobsSection from "./HourlyJobsSection";
import GapFillerSection from "./GapFillerSection";
import BiddingStrategySection from "./BiddingStrategySection";
import RevenueSummaryCard from "./RevenueSummaryCard";
import GapAnalysisSection from "./GapAnalysisSection";
import StrategyResultCards from "./StrategyResultCards";

interface HourlyJob {
  id: string;
  rate: number | "";
  hoursPerWeek: number | "";
  isSecured: boolean;
}

export const UpworkCalculatorComponent = () => {
  // 1. Inputs State
  const [hourlyJobs, setHourlyJobs] = useState<HourlyJob[]>([]);
  const [avgFixedJobValue, setAvgFixedJobValue] = useState<number | "">(""); // Gross
  const [winRate, setWinRate] = useState<number>(13.0); // Directly control win rate %
  const [connectsPerBid, setConnectsPerBid] = useState<number | "">(15);

  // Helper to handle numeric input changes
  const handleNumChange =
    (setter: (val: number | "") => void) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setter(val === "" ? "" : Number(val));
    };

  // 2. Dynamic List Handlers
  const addHourlyJob = () => {
    setHourlyJobs([
      ...hourlyJobs,
      { id: crypto.randomUUID(), rate: "", hoursPerWeek: "", isSecured: false },
    ]);
  };

  const removeHourlyJob = (id: string) => {
    setHourlyJobs(hourlyJobs.filter((j) => j.id !== id));
  };

  const updateHourlyJob = (id: string, field: keyof HourlyJob, value: any) => {
    setHourlyJobs(
      hourlyJobs.map((j) => (j.id === id ? { ...j, [field]: value } : j)),
    );
  };

  // 3. Fetch Live Data
  const { query: billsQuery } = useList<BaseRecord>({ resource: "Bill" });
  const { query: personalQuery } = useList<BaseRecord>({
    resource: "Personal",
  });
  const { query: yearlyQuery } = useList<BaseRecord>({
    resource: "YearlyCost",
  });
  const { query: settingsQuery } = useOne<BaseRecord>({
    resource: "AppSettings",
    id: "global",
  });

  const isLoading =
    billsQuery.isLoading ||
    personalQuery.isLoading ||
    yearlyQuery.isLoading ||
    settingsQuery.isLoading;

  const data = useMemo(() => {
    if (isLoading) return null;

    const bills = billsQuery.data?.data || [];
    const personal = personalQuery.data?.data || [];
    const yearly = yearlyQuery.data?.data || [];
    const settings = settingsQuery.data?.data || {};

    const today = new Date();
    const currentMonth = today.getMonth() + 1;

    const monthlyBillsTotal = bills.reduce(
      (acc, b) => acc + (Number(b.amount) || 0),
      0,
    );
    const monthlyPersonalTotal = personal.reduce(
      (acc, p) => acc + (Number(p.amount) || 0),
      0,
    );
    const currentYearlyTotal = yearly
      .filter((y) => Number(y.month) === currentMonth)
      .reduce((acc, y) => acc + (Number(y.amount) || 0), 0);

    const wifeAmount = Number(settings.wifeMonthlyAmount) || 0;
    const taxRate = Number(settings.upworkTaxProvisionPercent) || 0;
    const upworkFee = 0.1; // Standard 10%
    const expenseHold = settings.upworkExpensesHoldActive
      ? Number(settings.upworkExpensesHoldAmount) || 0
      : 0;
    const monthlyExpenseHold = expenseHold * 2; // Assuming Bi-Weekly withdrawals

    const totalNeededTakeHome =
      monthlyBillsTotal +
      monthlyPersonalTotal +
      currentYearlyTotal +
      wifeAmount;

    const totalNeededNet =
      (totalNeededTakeHome + monthlyExpenseHold) / (1 - taxRate);
    const totalNeededGross = totalNeededNet / (1 - upworkFee);

    return {
      takeHome: totalNeededTakeHome,
      net: totalNeededNet,
      gross: totalNeededGross,
      taxRate,
      upworkFee,
      monthlyExpenseHold,
    };
  }, [
    isLoading,
    billsQuery.data,
    personalQuery.data,
    yearlyQuery.data,
    settingsQuery.data,
  ]);

  const calculations = useMemo(() => {
    if (!data) return null;

    const winRateDecimal = winRate / 100;

    const hourlyGrossTotal = hourlyJobs.reduce((acc, job) => {
      const rate = Number(job.rate) || 0;
      const hours = Number(job.hoursPerWeek) || 0;
      return acc + rate * hours * 4;
    }, 0);

    const remainingGross = Math.max(0, data.gross - hourlyGrossTotal);

    const fixedJobsNeeded =
      Number(avgFixedJobValue) > 0
        ? remainingGross / Number(avgFixedJobValue)
        : 0;

    const unsecuredHourlyCount = hourlyJobs.filter((j) => !j.isSecured).length;
    const totalJobsToWin = Math.ceil(unsecuredHourlyCount + fixedJobsNeeded);

    const bidsNeeded = winRateDecimal > 0 ? totalJobsToWin / winRateDecimal : 0;
    const totalConnectsNeeded = bidsNeeded * (Number(connectsPerBid) || 0);
    const billableConnects = Math.max(0, totalConnectsNeeded - 100);
    const connectsCost = billableConnects * 0.15;
    const reserveRemaining = data.monthlyExpenseHold - connectsCost;

    return {
      winRate: winRateDecimal,
      hourlyGrossTotal,
      remainingGross,
      fixedJobsNeeded,
      unsecuredHourlyCount,
      totalJobsToWin,
      bidsNeeded,
      totalConnectsNeeded,
      billableConnects,
      connectsCost,
      reserveRemaining,
      weeklyGrossTarget: data.gross / 4,
    };
  }, [data, hourlyJobs, avgFixedJobValue, winRate, connectsPerBid]);

  if (isLoading) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
        }}
      >
        <CircularProgress size={60} thickness={4} />
      </Box>
    );
  }

  const formatCurrency = (val: number) =>
    val.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  return (
    <Box sx={{ p: 4, maxWidth: 1400, margin: "0 auto" }}>
      <Box sx={{ mb: 4, display: "flex", alignItems: "center", gap: 2 }}>
        <CalculateIcon sx={{ fontSize: 40, color: "primary.main" }} />
        <Typography variant="h4" sx={{ fontWeight: 900 }}>
          UpWork Strategy Calculator
        </Typography>
      </Box>

      <Grid container spacing={4}>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <HourlyJobsSection
              hourlyJobs={hourlyJobs}
              addHourlyJob={addHourlyJob}
              removeHourlyJob={removeHourlyJob}
              updateHourlyJob={updateHourlyJob}
              formatCurrency={formatCurrency}
            />

            <GapFillerSection
              avgFixedJobValue={avgFixedJobValue}
              handleNumChange={handleNumChange}
              setAvgFixedJobValue={setAvgFixedJobValue}
            />

            <BiddingStrategySection
              winRate={winRate}
              setWinRate={setWinRate}
              connectsPerBid={connectsPerBid}
              handleNumChange={handleNumChange}
              setConnectsPerBid={setConnectsPerBid}
            />
          </Box>
        </Grid>

        <Grid size={{ xs: 12, lg: 6 }}>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <RevenueSummaryCard data={data} formatCurrency={formatCurrency} />

            <GapAnalysisSection
              data={data}
              calculations={calculations}
              formatCurrency={formatCurrency}
            />

            <StrategyResultCards
              calculations={calculations}
              formatCurrency={formatCurrency}
            />
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
};
