"use client";

/**
 * Statistics/page.tsx — Next.js route entry for /Statistics.
 *
 * Thin wrapper that delegates to StatisticsPage — yearly stacked bar chart plus
 * a month-filterable pie chart of budget activity. Real logic lives in
 * components/budget/statistics/StatisticsPage.
 */

import { StatisticsPage } from "../../components/budget/statistics/StatisticsPage";

export default function Page() {
  return <StatisticsPage />;
}
