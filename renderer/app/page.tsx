"use client";

import { useList, BaseRecord, useOne } from "@refinedev/core";
import {
  Grid,
  Box,
  CircularProgress,
  Divider,
  Alert,
  AlertTitle,
} from "@mui/material";
import { BillsOverview } from "../components/dashboard/BillsOverview";
import { PersonalOverview } from "../components/dashboard/PersonalOverview";
import { YearlyOverview } from "../components/dashboard/YearlyOverview";
import { CashFlowOverview } from "../components/dashboard/CashFlowOverview";
import { UpworkHubStatus } from "../components/dashboard/UpworkHubStatus";
import { EddStatus } from "../components/dashboard/EddStatus";
import { IncomeGapAnalysis } from "../components/dashboard/IncomeGapAnalysis";
import { SHORT_MONTHS, COLORS } from "../lib/constants";
import { useState } from "react";

export default function Dashboard() {
  const [showAlert, setShowAlert] = useState(true);

  const { query: billsQuery } = useList<BaseRecord>({
    resource: "Bill",
  });
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
  const { query: contractsQuery } = useList<BaseRecord>({
    resource: "Contract",
  });
  const { query: earningsQuery } = useList<BaseRecord>({
    resource: "Earning",
  });
  const { query: withdrawalsQuery } = useList<BaseRecord>({
    resource: "Withdrawal",
  });
  const { query: deductibleExpensesQuery } = useList<BaseRecord>({
    resource: "DeductibleExpense",
  });
  const { query: eddPaymentsQuery } = useList<BaseRecord>({
    resource: "EddPayment",
  });

  if (
    billsQuery.isLoading ||
    personalQuery.isLoading ||
    yearlyQuery.isLoading ||
    settingsQuery.isLoading ||
    contractsQuery.isLoading ||
    earningsQuery.isLoading ||
    withdrawalsQuery.isLoading ||
    deductibleExpensesQuery.isLoading ||
    eddPaymentsQuery.isLoading
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
  const contracts = (contractsQuery.data?.data || []) as any[];
  const earnings = (earningsQuery.data?.data || []) as any[];
  const withdrawals = (withdrawalsQuery.data?.data || []) as any[];
  const eddPayments = (eddPaymentsQuery.data?.data || []) as any[];

  const isUpworkActive = settings.upworkActive !== false;
  const isEddActive = !!settings.eddActive;

  // --- INCOME ALERT CALCULATIONS ---
  const today = new Date();
  //today.setFullYear(2026, 3, 1); // <--- UNCOMMENT THIS LINE TO TEST APRIL 1st

  const currentMonth = today.getMonth(); // 0-11
  const currentYear = today.getFullYear();

  // End of month date
  const endOfMonth = new Date(currentYear, currentMonth + 1, 0);

  // 1. Total Needed This Month (Take Home Target)
  const monthlyBillsTotal = bills.reduce(
    (acc, b) => acc + (Number(b.amount) || 0),
    0,
  );
  const monthlyPersonalTotal = personalBills.reduce(
    (acc, p) => acc + (Number(p.amount) || 0),
    0,
  );
  const currentYearlyTotal = yearlyCosts
    .filter((y) => Number(y.month) === currentMonth + 1)
    .reduce((acc, y) => acc + (Number(y.amount) || 0), 0);

  const wifeAmount = Number(settings.wifeMonthlyAmount) || 0;

  // We don't add expenseHoldAmount to totalNeeded here because it's a deduction from income,
  // not a bill to be paid. We will deduct it from our projected spendable income.
  const totalNeeded =
    monthlyBillsTotal + monthlyPersonalTotal + currentYearlyTotal + wifeAmount;

  // 2. Spendable Income Calculations (Taking Holds into account)
  const taxRate = Number(settings.upworkTaxProvisionPercent) || 0;
  const minWithdrawal = Number(settings.upworkMinWithdrawalAmount) || 0;
  const expensesHoldPerWithdrawal = settings.upworkExpensesHoldActive
    ? Number(settings.upworkExpensesHoldAmount) || 0
    : 0;

  // Function to determine if a Net amount earned on 'workDate' will hit the bank by 'endOfMonth'
  const isSpendableThisMonth = (workDate: Date, type: "HOURLY" | "FIXED") => {
    const d = new Date(workDate);
    let availabilityDate: Date;

    if (type === "HOURLY") {
      // Hourly: 10 days after the work week ends (Saturday)
      const weekEnd = new Date(d);
      weekEnd.setDate(d.getDate() + (6 - d.getDay()));
      availabilityDate = new Date(weekEnd);
      availabilityDate.setDate(weekEnd.getDate() + 10);
    } else {
      // Fixed: 5 day hold after milestone/payment
      availabilityDate = new Date(d);
      availabilityDate.setDate(d.getDate() + 5);
    }

    return availabilityDate <= endOfMonth;
  };

  // Upwork Earned Spendable (from entries and manual income log)
  const unwithdrawnEarningsNet = earnings
    .filter((e) => !e.isWithdrawn)
    .reduce((acc, e) => acc + (Number(e.amount) || 0), 0);

  const upworkEarnedSpendableNet =
    unwithdrawnEarningsNet +
    contracts.reduce((acc, c) => {
      const spendableEntries = (c.entries || []).filter((e: any) =>
        isSpendableThisMonth(new Date(e.date), c.type),
      );
      return (
        acc +
        spendableEntries.reduce(
          (sum: number, e: any) => sum + (Number(e.netPay) || 0),
          0,
        )
      );
    }, 0);

  // Hourly Potential Spendable (Saturdays remaining in month that haven't been logged yet)
  let hourlyPotentialNet = 0;
  const tempDate = new Date(today);
  while (tempDate <= endOfMonth) {
    if (tempDate.getDay() === 6) {
      // It's a Saturday
      const availabilityDate = new Date(tempDate);
      availabilityDate.setDate(tempDate.getDate() + 10);

      if (availabilityDate <= endOfMonth) {
        // Only count potential if there isn't ALREADY an entry for this specific Saturday
        contracts
          .filter((c) => c.status === "ACTIVE" && c.type === "HOURLY")
          .forEach((c) => {
            const entryForThisWeek = (c.entries || []).find((e: any) => {
              const eDate = new Date(e.date);
              return eDate.toDateString() === tempDate.toDateString();
            });

            if (!entryForThisWeek) {
              hourlyPotentialNet +=
                (Number(c.netRate) || 0) * (Number(c.weeklyHours) || 0);
            }
          });
      }
    }
    tempDate.setDate(tempDate.getDate() + 1);
  }

  // Fixed Potential Spendable
  const fixedPotentialNet = contracts
    .filter((c) => c.status === "ACTIVE" && c.type === "FIXED")
    .reduce((acc, c) => {
      if (isSpendableThisMonth(today, "FIXED")) {
        const earnedNet = (c.entries || []).reduce(
          (sum: number, e: any) => sum + (Number(e.netPay) || 0),
          0,
        );
        return acc + Math.max(0, (Number(c.netRate) || 0) - earnedNet);
      }
      return acc;
    }, 0);

  const totalProjectedSpendableNet =
    upworkEarnedSpendableNet + hourlyPotentialNet + fixedPotentialNet;

  // Apply Withdrawal Rules
  let finalSpendableTakeHome = 0;
  let isBelowMinimum = false;

  if (totalProjectedSpendableNet >= minWithdrawal) {
    const numWithdrawals = 2; // Assuming Bi-Weekly
    const totalTax = totalProjectedSpendableNet * taxRate;
    const totalExpensesHold = expensesHoldPerWithdrawal * numWithdrawals;
    finalSpendableTakeHome = Math.max(
      0,
      totalProjectedSpendableNet - totalTax - totalExpensesHold,
    );
  } else if (totalProjectedSpendableNet > 0) {
    isBelowMinimum = true;
  }

  const renderIncomeAlert = () => {
    if (!showAlert || settings.eddActive || settings.w2Active) return null;

    const alertSx = {
      mb: 4,
      borderRadius: 2,
      border: "1px solid",
      "& .MuiAlert-message": {
        color: "#f8fafc",
        fontSize: "1rem",
        width: "100%",
      },
      "& strong": { color: "white", fontWeight: 900, fontSize: "1.1rem" },
    };

    const targetBreakdown = `Target includes Bills, Personal, ${SHORT_MONTHS[currentMonth]} Yearly, and Wife Allowance.`;

    const formatCurrency = (amount: number) =>
      amount.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

    const shortfallTakeHome = totalNeeded - finalSpendableTakeHome;
    const shortfallNet = shortfallTakeHome / (1 - taxRate);

    const breakdownText = (
      <Box sx={{ mt: 1, fontSize: "0.85rem", opacity: 0.9 }}>
        <Grid container spacing={1}>
          <Grid size={{ xs: 8 }}>• Logged & Spendable (Net):</Grid>
          <Grid size={{ xs: 4 }} sx={{ textAlign: "right" }}>
            ${formatCurrency(upworkEarnedSpendableNet)}
          </Grid>

          <Grid size={{ xs: 8 }}>• Unlogged Potential (Net):</Grid>
          <Grid size={{ xs: 4 }} sx={{ textAlign: "right" }}>
            ${formatCurrency(hourlyPotentialNet + fixedPotentialNet)}
          </Grid>

          <Grid size={{ xs: 12 }}>
            <Divider sx={{ my: 0.5, borderColor: "rgba(255,255,255,0.1)" }} />
          </Grid>

          <Grid size={{ xs: 8 }}>Total Projected Spendable Net:</Grid>
          <Grid size={{ xs: 4 }} sx={{ textAlign: "right" }}>
            ${formatCurrency(totalProjectedSpendableNet)}
          </Grid>

          {isBelowMinimum ? (
            <Grid
              size={{ xs: 12 }}
              sx={{ color: COLORS.tax, mt: 1, fontWeight: 700 }}
            >
              ⚠️ Balance is below your ${formatCurrency(minWithdrawal)} minimum
              withdrawal limit. Nothing will be sent to your bank this month.
            </Grid>
          ) : (
            <>
              <Grid size={{ xs: 8 }}>
                • Tax Provision ({(taxRate * 100).toFixed(0)}%):
              </Grid>
              <Grid size={{ xs: 4 }} sx={{ textAlign: "right" }}>
                -${formatCurrency(totalProjectedSpendableNet * taxRate)}
              </Grid>

              <Grid size={{ xs: 8 }}>• Expense Reserve (Bi-Weekly):</Grid>
              <Grid size={{ xs: 4 }} sx={{ textAlign: "right" }}>
                -${formatCurrency(expensesHoldPerWithdrawal * 2)}
              </Grid>

              <Grid size={{ xs: 8 }}>
                <strong>Projected Spendable Take Home:</strong>
              </Grid>
              <Grid size={{ xs: 4 }} sx={{ textAlign: "right" }}>
                <strong>${formatCurrency(finalSpendableTakeHome)}</strong>
              </Grid>
            </>
          )}
        </Grid>
      </Box>
    );

    if (finalSpendableTakeHome < totalNeeded) {
      return (
        <Alert
          severity="error"
          variant="outlined"
          onClose={() => setShowAlert(false)}
          sx={{
            ...alertSx,
            bgcolor: "rgba(244, 63, 94, 0.1)",
            borderColor: "rgba(244, 63, 94, 0.4)",
            "& .MuiAlert-icon": { color: "#f43f5e", fontSize: "1.5rem" },
          }}
        >
          <AlertTitle
            sx={{ fontWeight: 900, color: "#f43f5e", fontSize: "1.2rem" }}
          >
            Spendable Income Gap Detected!
          </AlertTitle>
          Based on Upwork hold times, you are projected to be short by{" "}
          <strong>${formatCurrency(shortfallNet)} Net</strong> ($
          {formatCurrency(shortfallTakeHome)} Take Home) to cover this month's
          bills.
          {breakdownText}
          <Box sx={{ mt: 1, fontSize: "0.75rem", opacity: 0.7 }}>
            {targetBreakdown}
            <br />
            <em>*Includes 10-day hold for Hourly and 5-day hold for Fixed.</em>
          </Box>
        </Alert>
      );
    }

    return null;
  };
  // Case 1: Both Off
  if (!isUpworkActive && !isEddActive) {
    return (
      <Box sx={{ p: 4, display: "flex", flexDirection: "column", gap: 4 }}>
        {renderIncomeAlert()}
        <Box sx={{ display: "flex", justifyContent: "center" }}>
          <CashFlowOverview
            settings={settings}
            bills={bills}
            personalBills={personalBills}
            contracts={contracts}
            earnings={earnings}
            withdrawals={withdrawals}
          />
        </Box>
        <Grid container spacing={4} sx={{ alignItems: "flex-start" }}>
          <Grid size={{ xs: 12, lg: 6 }}>
            <BillsOverview bills={bills} settings={settings} />
          </Grid>
          <Grid size={{ xs: 12, lg: 6 }}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <PersonalOverview
                personalBills={personalBills}
                settings={settings}
              />
              <YearlyOverview yearlyCosts={yearlyCosts} months={SHORT_MONTHS} />
            </Box>
          </Grid>
        </Grid>
      </Box>
    );
  }

  // Case 2: EDD On, UpWork Off
  if (!isUpworkActive && isEddActive) {
    return (
      <Box sx={{ p: 4, display: "flex", flexDirection: "column", gap: 4 }}>
        {renderIncomeAlert()}
        <Box sx={{ display: "flex", justifyContent: "center" }}>
          <CashFlowOverview
            settings={settings}
            bills={bills}
            personalBills={personalBills}
            contracts={contracts}
            earnings={earnings}
            withdrawals={withdrawals}
          />
        </Box>
        <Grid container spacing={4} sx={{ alignItems: "flex-start" }}>
          <Grid size={{ xs: 12, lg: 6 }}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <BillsOverview bills={bills} settings={settings} />
              <PersonalOverview
                personalBills={personalBills}
                settings={settings}
              />
            </Box>
          </Grid>
          <Grid size={{ xs: 12, lg: 6 }}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <EddStatus settings={settings} eddPayments={eddPayments} />
              <YearlyOverview yearlyCosts={yearlyCosts} months={SHORT_MONTHS} />
            </Box>
          </Grid>
        </Grid>
      </Box>
    );
  }

  // Case 3: UpWork On (Standard)
  return (
    <Box sx={{ p: 4, display: "flex", flexDirection: "column", gap: 4 }}>
      {renderIncomeAlert()}
      {/* Top Section: Cash Flow Engine */}
      <Box sx={{ display: "flex", justifyContent: "center" }}>
        <CashFlowOverview
          settings={settings}
          bills={bills}
          personalBills={personalBills}
          contracts={contracts}
          earnings={earnings}
          withdrawals={withdrawals}
        />
      </Box>

      {/* Main Dashboard Grid */}
      <Grid container spacing={4} sx={{ alignItems: "flex-start" }}>
        {/* Left Column: Stacked Overviews */}
        <Grid size={{ xs: 12, lg: 5 }}>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <BillsOverview bills={bills} settings={settings} />
            <PersonalOverview
              personalBills={personalBills}
              settings={settings}
            />
            <YearlyOverview yearlyCosts={yearlyCosts} months={SHORT_MONTHS} />
          </Box>
        </Grid>

        {/* Right Column: UpWork Hub & Analysis */}
        <Grid size={{ xs: 12, lg: 7 }}>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <UpworkHubStatus
              settings={settings}
              contracts={contracts}
              earnings={earnings}
              withdrawals={withdrawals}
            />
            {isUpworkActive && !settings.eddActive && !settings.w2Active && (
              <IncomeGapAnalysis
                settings={settings}
                bills={bills}
                personalBills={personalBills}
                yearlyCosts={yearlyCosts}
              />
            )}
            {settings.eddActive && (
              <EddStatus settings={settings} eddPayments={eddPayments} />
            )}
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
}
