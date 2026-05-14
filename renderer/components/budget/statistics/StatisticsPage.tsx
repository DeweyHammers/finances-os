"use client";

import { useMemo, useState } from "react";
import {
  Box,
  Typography,
  Paper,
  CircularProgress,
  IconButton,
  Tabs,
  Tab,
} from "@mui/material";
import InsightsIcon from "@mui/icons-material/Insights";
import PieChartIcon from "@mui/icons-material/PieChart";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import { useList } from "@refinedev/core";
import { MonthlyStackedBars } from "./MonthlyStackedBars";
import { MonthlyPie } from "./MonthlyPie";
import {
  computeYearlySpending,
  computeYearlyIncome,
  computeKpis,
  MonthlySpend,
  StatsCategoryGroup,
  StatsCategoryItem,
  StatsPayee,
  StatsTransaction,
} from "./stats-utils";
import { formatMoney } from "../../../lib/cents";
import { MONTHS } from "../../../lib/constants";

const sectionPaperSx = {
  p: { xs: 2.5, md: 3.5 },
  borderRadius: 4,
  bgcolor: "rgba(30, 41, 59, 0.5)",
  border: "1px solid rgba(129, 140, 248, 0.1)",
};

type StatsView = "yearly" | "monthly";
type StatsSeries = "spending" | "income";

const SPENDING_ACCENT = "#f87171";
const INCOME_ACCENT = "#34d399";

export const StatisticsPage = () => {
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getUTCFullYear());
  const [monthIndex, setMonthIndex] = useState(now.getUTCMonth());
  const [view, setView] = useState<StatsView>("yearly");
  const [series, setSeries] = useState<StatsSeries>("spending");

  const { query: txnsQuery } = useList({
    resource: "AccountTransaction",
    pagination: { mode: "off" },
  });
  const { query: itemsQuery } = useList({
    resource: "BudgetCategoryItem",
    pagination: { mode: "off" },
  });
  const { query: groupsQuery } = useList({
    resource: "BudgetCategoryGroup",
    pagination: { mode: "off" },
    sorters: [{ field: "sortOrder", order: "asc" }],
  });
  const { query: payeesQuery } = useList({
    resource: "Payee",
    pagination: { mode: "off" },
  });

  const isLoading =
    txnsQuery.isLoading ||
    itemsQuery.isLoading ||
    groupsQuery.isLoading ||
    payeesQuery.isLoading;

  const transactions = (txnsQuery.data?.data as StatsTransaction[]) || [];
  const items = (itemsQuery.data?.data as StatsCategoryItem[]) || [];
  const groups = (groupsQuery.data?.data as StatsCategoryGroup[]) || [];
  const payees = (payeesQuery.data?.data as StatsPayee[]) || [];

  const yearlySpending = useMemo(
    () =>
      computeYearlySpending({
        year,
        transactions,
        items,
        groups,
      }),
    [year, transactions, items, groups],
  );

  const yearlyIncome = useMemo(
    () =>
      computeYearlyIncome({
        year,
        transactions,
        payees,
      }),
    [year, transactions, payees],
  );

  const spendingKpis = useMemo(() => computeKpis(yearlySpending), [yearlySpending]);
  const incomeKpis = useMemo(() => computeKpis(yearlyIncome), [yearlyIncome]);

  const toWifeKpi = useMemo(() => {
    let total = 0;
    let activeMonths = 0;
    yearlySpending.forEach((m) => {
      const w = m.items.find(
        (it) => it.itemName.trim().toLowerCase() === "to wife",
      );
      if (w && w.cents > 0) {
        total += w.cents;
        activeMonths += 1;
      }
    });
    return {
      total,
      activeMonths,
      avg: activeMonths > 0 ? total / activeMonths : 0,
    };
  }, [yearlySpending]);

  const selectedSpendingMonth: MonthlySpend = yearlySpending[monthIndex];
  const selectedIncomeMonth: MonthlySpend = yearlyIncome[monthIndex];

  const shiftMonth = (delta: number) => {
    const total = monthIndex + delta;
    const newYear = year + Math.floor(total / 12);
    const newMonth = ((total % 12) + 12) % 12;
    if (newYear !== year) setYear(newYear);
    setMonthIndex(newMonth);
  };

  const shiftYear = (delta: number) => setYear((y) => y + delta);

  return (
    <Box
      sx={{
        p: 4,
        display: "flex",
        flexDirection: "column",
        gap: 3,
      }}
    >
      <Box>
        <Typography
          variant="h4"
          sx={{ color: "white", fontWeight: 800, letterSpacing: "-0.5px" }}
        >
          Statistics
        </Typography>
        <Typography sx={{ color: "text.secondary", fontWeight: 500 }}>
          Spending and income trends across the year.
        </Typography>
      </Box>

      {isLoading ? (
        <Box sx={{ display: "flex", justifyContent: "center", p: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        (() => {
          const isSpending = series === "spending";
          const accent = isSpending ? SPENDING_ACCENT : INCOME_ACCENT;
          const seriesTitle = isSpending ? "Spending" : "Income";
          const seriesIcon = isSpending ? (
            <TrendingDownIcon sx={{ fontSize: 22 }} />
          ) : (
            <TrendingUpIcon sx={{ fontSize: 22 }} />
          );
          const yearlyForSeries = isSpending ? yearlySpending : yearlyIncome;
          const kpisForSeries = isSpending ? spendingKpis : incomeKpis;
          const allItemsForSeries = isSpending ? items : payees;
          const monthForSeries = isSpending
            ? selectedSpendingMonth
            : selectedIncomeMonth;
          const itemsLabel = isSpending ? "ITEMS" : "SOURCES";
          const emptyTotalLabel = isSpending
            ? "No spending recorded"
            : "No income recorded";
          const emptyMonthLabel = isSpending
            ? `No spending in ${MONTHS[monthIndex]} ${year}`
            : `No income in ${MONTHS[monthIndex]} ${year}`;

          return (
            <Paper elevation={0} sx={sectionPaperSx}>
              <Tabs
                value={series}
                onChange={(_, v) => setSeries(v)}
                sx={{
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                  "& .MuiTab-root": {
                    textTransform: "none",
                    fontWeight: 800,
                    fontSize: "1rem",
                    color: "text.secondary",
                    minHeight: 48,
                    px: 3,
                  },
                  "& .MuiTab-root.Mui-selected[data-series='spending']": {
                    color: SPENDING_ACCENT,
                  },
                  "& .MuiTab-root.Mui-selected[data-series='income']": {
                    color: INCOME_ACCENT,
                  },
                  "& .MuiTabs-indicator": {
                    height: 3,
                    borderRadius: "3px 3px 0 0",
                    backgroundColor: accent,
                  },
                }}
              >
                <Tab
                  value="spending"
                  icon={<TrendingDownIcon sx={{ fontSize: 20 }} />}
                  iconPosition="start"
                  label="Spending"
                  data-series="spending"
                />
                <Tab
                  value="income"
                  icon={<TrendingUpIcon sx={{ fontSize: 20 }} />}
                  iconPosition="start"
                  label="Income"
                  data-series="income"
                />
              </Tabs>

              <Tabs
                value={view}
                onChange={(_, v) => setView(v)}
                sx={{
                  mt: 2,
                  mb: 3,
                  minHeight: 36,
                  "& .MuiTab-root": {
                    textTransform: "none",
                    fontWeight: 600,
                    fontSize: "0.82rem",
                    color: "text.secondary",
                    minHeight: 32,
                    py: 0.5,
                    px: 2,
                    borderRadius: 1.5,
                    mr: 1,
                    "&.Mui-selected": {
                      color: "white",
                      bgcolor: "rgba(129, 140, 248, 0.15)",
                    },
                  },
                  "& .MuiTabs-indicator": { display: "none" },
                }}
              >
                <Tab
                  value="yearly"
                  icon={<InsightsIcon sx={{ fontSize: 16 }} />}
                  iconPosition="start"
                  label="Yearly Overview"
                />
                <Tab
                  value="monthly"
                  icon={<PieChartIcon sx={{ fontSize: 16 }} />}
                  iconPosition="start"
                  label="Month-to-Month"
                />
              </Tabs>

              {view === "yearly" && (
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                  }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 2,
                      flexWrap: "wrap",
                    }}
                  >
                    <Typography
                      sx={{
                        color: "text.secondary",
                        fontSize: "0.8rem",
                        fontStyle: "italic",
                      }}
                    >
                      Click a bar to jump into that month&apos;s breakdown.
                    </Typography>
                    <ChevronPill
                      label={String(year)}
                      onPrev={() => shiftYear(-1)}
                      onNext={() => shiftYear(1)}
                      prevAria="Previous year"
                      nextAria="Next year"
                    />
                  </Box>

                  <YearlySection
                    title={seriesTitle}
                    icon={seriesIcon}
                    accent={accent}
                    year={year}
                    data={yearlyForSeries}
                    kpis={kpisForSeries}
                    allItems={allItemsForSeries}
                    emptyTotalLabel={emptyTotalLabel}
                    extraTiles={
                      isSpending
                        ? [
                            {
                              label: "To Wife",
                              value:
                                toWifeKpi.total > 0
                                  ? formatMoney(toWifeKpi.total)
                                  : "—",
                              hint:
                                toWifeKpi.activeMonths > 0
                                  ? `${toWifeKpi.activeMonths} active ${
                                      toWifeKpi.activeMonths === 1
                                        ? "month"
                                        : "months"
                                    }`
                                  : "no activity",
                            },
                            {
                              label: "To Wife Average",
                              value: formatMoney(Math.round(toWifeKpi.avg)),
                              hint:
                                toWifeKpi.activeMonths > 0
                                  ? `per active month`
                                  : undefined,
                            },
                          ]
                        : []
                    }
                    onMonthClick={(idx) => {
                      setMonthIndex(idx);
                      setView("monthly");
                    }}
                  />
                </Box>
              )}

              {view === "monthly" && (
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                  }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 2,
                      flexWrap: "wrap",
                    }}
                  >
                    <Typography
                      sx={{
                        color: "text.secondary",
                        fontSize: "0.8rem",
                        fontStyle: "italic",
                      }}
                    >
                      Hover a slice or row to highlight that{" "}
                      {isSpending ? "item" : "source"}.
                    </Typography>
                    <ChevronPill
                      label={`${MONTHS[monthIndex]} ${year}`}
                      onPrev={() => shiftMonth(-1)}
                      onNext={() => shiftMonth(1)}
                      prevAria="Previous month"
                      nextAria="Next month"
                    />
                  </Box>

                  <MonthlySection
                    title={seriesTitle}
                    icon={seriesIcon}
                    accent={accent}
                    month={monthForSeries}
                    year={year}
                    allItems={allItemsForSeries}
                    itemsLabel={itemsLabel}
                    emptyLabel={emptyMonthLabel}
                  />
                </Box>
              )}
            </Paper>
          );
        })()
      )}
    </Box>
  );
};

const StatTile = ({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) => (
  <Box
    sx={{
      p: 2,
      borderRadius: 2,
      bgcolor: "rgba(15, 23, 42, 0.5)",
      border: "1px solid rgba(255,255,255,0.05)",
    }}
  >
    <Typography
      sx={{
        fontSize: "0.7rem",
        fontWeight: 800,
        letterSpacing: 1,
        color: "text.secondary",
        textTransform: "uppercase",
        mb: 0.5,
      }}
    >
      {label}
    </Typography>
    <Typography
      sx={{
        fontSize: "1.4rem",
        fontWeight: 800,
        color: "white",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {value}
    </Typography>
    {hint && (
      <Typography
        sx={{
          fontSize: "0.72rem",
          color: "text.secondary",
          fontWeight: 600,
          mt: 0.25,
        }}
      >
        {hint}
      </Typography>
    )}
  </Box>
);

const ChevronPill = ({
  label,
  onPrev,
  onNext,
  prevAria,
  nextAria,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  prevAria: string;
  nextAria: string;
}) => (
  <Box
    sx={{
      display: "flex",
      alignItems: "center",
      gap: 1,
      px: 1,
      py: 0.5,
      borderRadius: 2,
      bgcolor: "rgba(15, 23, 42, 0.5)",
      border: "1px solid rgba(129, 140, 248, 0.15)",
    }}
  >
    <IconButton
      onClick={onPrev}
      aria-label={prevAria}
      sx={{
        color: "primary.light",
        "&:hover": { bgcolor: "rgba(129, 140, 248, 0.18)" },
      }}
    >
      <NavigateBeforeIcon sx={{ fontSize: 28 }} />
    </IconButton>
    <Typography
      sx={{
        minWidth: 140,
        textAlign: "center",
        fontWeight: 800,
        color: "white",
        fontSize: "0.95rem",
        letterSpacing: 0.3,
      }}
    >
      {label}
    </Typography>
    <IconButton
      onClick={onNext}
      aria-label={nextAria}
      sx={{
        color: "primary.light",
        "&:hover": { bgcolor: "rgba(129, 140, 248, 0.18)" },
      }}
    >
      <NavigateNextIcon sx={{ fontSize: 28 }} />
    </IconButton>
  </Box>
);

const SectionHeader = ({
  title,
  icon,
  accent,
}: {
  title: string;
  icon: React.ReactNode;
  accent: string;
}) => (
  <Box
    sx={{
      display: "flex",
      alignItems: "center",
      gap: 1.25,
      mb: 2.5,
      pb: 1.5,
      borderBottom: `1px solid ${accent}22`,
    }}
  >
    <Box
      sx={{
        color: accent,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 36,
        height: 36,
        borderRadius: 1.5,
        bgcolor: `${accent}18`,
        border: `1px solid ${accent}33`,
      }}
    >
      {icon}
    </Box>
    <Typography
      variant="h6"
      sx={{
        color: "white",
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: 0.5,
      }}
    >
      {title}
    </Typography>
  </Box>
);

const innerCardSx = (accent: string) => ({
  p: { xs: 2.5, md: 3 },
  borderRadius: 3,
  bgcolor: "rgba(15, 23, 42, 0.55)",
  border: `1px solid ${accent}30`,
  borderTop: `3px solid ${accent}`,
  boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
});

const YearlySection = ({
  title,
  icon,
  accent,
  year,
  data,
  kpis,
  allItems,
  emptyTotalLabel,
  onMonthClick,
  extraTiles = [],
}: {
  title: string;
  icon: React.ReactNode;
  accent: string;
  year: number;
  data: MonthlySpend[];
  kpis: ReturnType<typeof computeKpis>;
  allItems: { id: string; name?: string }[];
  emptyTotalLabel: string;
  onMonthClick?: (idx: number) => void;
  extraTiles?: { label: string; value: string; hint?: string }[];
}) => (
  <Paper elevation={0} sx={innerCardSx(accent)}>
    <SectionHeader title={title} icon={icon} accent={accent} />
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "1fr",
          sm: "repeat(2, 1fr)",
          md: `repeat(${3 + extraTiles.length}, 1fr)`,
        },
        gap: 2,
        mb: 3,
      }}
    >
      <StatTile
        label={`${year} Total`}
        value={
          kpis.total > 0 ? formatMoney(kpis.total) : emptyTotalLabel
        }
      />
      <StatTile
        label="Monthly Average"
        value={formatMoney(Math.round(kpis.avg))}
        hint={
          kpis.nonZeroMonths > 0
            ? `over ${kpis.nonZeroMonths} active ${kpis.nonZeroMonths === 1 ? "month" : "months"}`
            : "no activity"
        }
      />
      <StatTile
        label="Highest Month"
        value={
          kpis.highest && kpis.highest.totalCents > 0
            ? formatMoney(kpis.highest.totalCents)
            : "—"
        }
        hint={
          kpis.highest && kpis.highest.totalCents > 0
            ? `${MONTHS[kpis.highest.monthIndex]} ${year}`
            : undefined
        }
      />
      {extraTiles.map((t) => (
        <StatTile
          key={t.label}
          label={t.label}
          value={t.value}
          hint={t.hint}
        />
      ))}
    </Box>
    <MonthlyStackedBars
      data={data}
      allItems={allItems}
      year={year}
      onMonthClick={onMonthClick}
    />
  </Paper>
);

const MonthlySection = ({
  title,
  icon,
  accent,
  month,
  year,
  allItems,
  itemsLabel,
  emptyLabel,
}: {
  title: string;
  icon: React.ReactNode;
  accent: string;
  month: MonthlySpend | undefined;
  year: number;
  allItems: { id: string; name?: string }[];
  itemsLabel: string;
  emptyLabel: string;
}) => (
  <Paper elevation={0} sx={innerCardSx(accent)}>
    <SectionHeader title={title} icon={icon} accent={accent} />
    {month ? (
      <MonthlyPie
        month={month}
        year={year}
        allItems={allItems}
        itemsLabel={itemsLabel}
        emptyLabel={emptyLabel}
      />
    ) : null}
  </Paper>
);
