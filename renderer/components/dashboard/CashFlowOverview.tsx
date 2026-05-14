import { FC } from "react";
import { Box, Grid, Typography, Paper } from "@mui/material";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import { getCycleColor, getCyclesForPaymentCycle } from "../../lib/cycle-utils";

interface CashFlowOverviewProps {
  settings: any;
  bills: any[];
  personalBills: any[];
}

export const CashFlowOverview: FC<CashFlowOverviewProps> = ({
  settings,
  bills,
  personalBills,
}) => {
  if (!settings) return null;
  const cycles = getCyclesForPaymentCycle();

  const getCycleIncome = () => Number(settings.w2Amount) || 0;

  const getCycleExpenses = (cycle: string) => {
    const cycleBills = bills.filter((b) => b.withdrawalCycle === cycle);
    const cyclePersonal = personalBills.filter((b) => b.withdrawalCycle === cycle);
    return (
      cycleBills.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0) +
      cyclePersonal.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0)
    );
  };

  const cycleData = cycles.map((cycle) => {
    const income = getCycleIncome();
    const expenses = getCycleExpenses(cycle);
    return { cycle, income, expenses, allowance: income - expenses };
  });

  const totalAllowance = cycleData.reduce((acc, curr) => acc + curr.allowance, 0);

  const AmountDisplay = ({
    amount,
    color,
    size = "large",
  }: {
    amount: number;
    color: string;
    size?: "medium" | "large";
  }) => {
    const absAmount = Math.abs(amount);
    const integerPart = Math.floor(absAmount).toLocaleString();
    const decimalPart = absAmount.toFixed(2).split(".")[1];
    const isLarge = size === "large";

    return (
      <Box
        sx={{
          display: "inline-flex",
          alignItems: "baseline",
          justifyContent: "center",
          color: color,
          width: "100%",
          mt: 2,
          pt: 3,
          borderTop: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <Typography
          sx={{
            fontSize: isLarge ? "1.4rem" : "1.1rem",
            fontWeight: 900,
            mr: 0.5,
            opacity: 0.6,
            lineHeight: 1,
          }}
        >
          $
        </Typography>
        <Typography
          sx={{
            fontSize: isLarge ? "3.2rem" : "2.2rem",
            fontWeight: 900,
            letterSpacing: "-1.5px",
            lineHeight: 1,
          }}
        >
          {integerPart}
        </Typography>
        <Typography
          sx={{
            fontSize: isLarge ? "1.6rem" : "1.2rem",
            fontWeight: 800,
            ml: 0.2,
            opacity: 0.8,
            lineHeight: 1,
          }}
        >
          .{decimalPart}
        </Typography>
      </Box>
    );
  };

  const AllowanceCard = ({ cycle, amount, income, expenses }: any) => {
    const cycleColor = getCycleColor(cycle);

    return (
      <Paper
        elevation={0}
        sx={{
          p: 3,
          borderRadius: 4,
          display: "flex",
          flexDirection: "column",
          bgcolor: "rgba(30, 41, 59, 0.4)",
          border: `1px solid ${amount < 0 ? "rgba(244, 63, 94, 0.2)" : "rgba(129, 140, 248, 0.1)"}`,
          textAlign: "center",
          flex: 1,
          width: "100%",
          justifyContent: "space-between",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 4,
            bgcolor: amount < 0 ? "#f43f5e" : cycleColor,
            opacity: 0.8,
          }}
        />

        <Box>
          <Typography
            variant="caption"
            sx={{
              fontWeight: 900,
              color: "text.secondary",
              letterSpacing: "2px",
              mb: 3,
              textTransform: "uppercase",
              display: "block",
            }}
          >
            {cycle} ALLOWANCE
          </Typography>

          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid size={{ xs: 6 }}>
              <Typography
                variant="caption"
                sx={{
                  display: "block",
                  color: "text.secondary",
                  fontWeight: 800,
                  fontSize: "0.65rem",
                  mb: 0.5,
                }}
              >
                INCOME
              </Typography>
              <Typography
                variant="body1"
                sx={{ fontWeight: 900, color: "success.light" }}
              >
                ${income.toFixed(0)}
              </Typography>
            </Grid>

            <Grid size={{ xs: 6 }}>
              <Typography
                variant="caption"
                sx={{
                  display: "block",
                  color: "text.secondary",
                  fontWeight: 800,
                  fontSize: "0.65rem",
                  mb: 0.5,
                }}
              >
                EXPENSES
              </Typography>
              <Typography
                variant="body1"
                sx={{ fontWeight: 900, color: "#f43f5e" }}
              >
                ${expenses.toFixed(0)}
              </Typography>
            </Grid>
          </Grid>
        </Box>

        <Box sx={{ mt: "auto" }}>
          <AmountDisplay
            amount={amount}
            color={amount < 0 ? "#f43f5e" : cycleColor}
            size={cycles.length > 2 ? "medium" : "large"}
          />
        </Box>
      </Paper>
    );
  };

  return (
    <Box sx={{ mb: 6, width: "100%", maxWidth: "1400px" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 4 }}>
        <Box
          sx={{
            display: "flex",
            p: 1,
            borderRadius: 2,
            bgcolor: "primary.main",
            boxShadow: "0 0 20px rgba(129, 140, 248, 0.4)",
          }}
        >
          <AccountBalanceWalletIcon
            sx={{ color: "white", fontSize: "1.8rem" }}
          />
        </Box>
        <Typography
          variant="h4"
          sx={{ fontWeight: 900, letterSpacing: "-1px", color: "white" }}
        >
          Cash Flow & Allowance
        </Typography>
      </Box>

      <Grid container spacing={3} sx={{ alignItems: "stretch", mb: 3 }}>
        <Grid
          size={{ xs: 12, sm: 8, md: 6 }}
          offset={{ xs: 0, sm: 2, md: 3 }}
          sx={{ display: "flex" }}
        >
          <Paper
            elevation={0}
            sx={{
              p: 3,
              borderRadius: 4,
              bgcolor:
                totalAllowance < 0
                  ? "rgba(244, 63, 94, 0.1)"
                  : "rgba(61, 188, 131, 0.1)",
              border: `1px solid ${totalAllowance < 0 ? "rgba(244, 63, 94, 0.3)" : "rgba(61, 188, 131, 0.3)"}`,
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              flex: 1,
              width: "100%",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <Box
              sx={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: 4,
                bgcolor: totalAllowance < 0 ? "#f43f5e" : "#3DBC83",
                opacity: 0.8,
              }}
            />

            <Box>
              <Typography
                variant="caption"
                sx={{
                  color: "text.secondary",
                  fontWeight: 900,
                  letterSpacing: "2px",
                  textTransform: "uppercase",
                  display: "block",
                  mb: 2,
                }}
              >
                REMAINING SURPLUS
              </Typography>

              <Typography
                variant="h6"
                sx={{
                  fontWeight: 900,
                  color: "white",
                  letterSpacing: "1px",
                  lineHeight: 1.2,
                }}
              >
                WIFE'S ALLOWANCE
              </Typography>
            </Box>

            <Box sx={{ mt: "auto" }}>
              <AmountDisplay
                amount={totalAllowance}
                color={totalAllowance < 0 ? "#f43f5e" : "#3DBC83"}
                size="large"
              />
            </Box>
          </Paper>
        </Grid>
      </Grid>

      <Grid container spacing={3} sx={{ alignItems: "stretch" }} columns={cycles.length}>
        {cycleData.map((data) => (
          <Grid key={data.cycle} size={1} sx={{ display: "flex" }}>
            <AllowanceCard
              cycle={data.cycle}
              amount={data.allowance}
              income={data.income}
              expenses={data.expenses}
            />
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};
