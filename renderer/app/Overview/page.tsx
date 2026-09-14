"use client";

/**
 * /Overview route — thin Next.js entry point.
 *
 * Actual page logic lives in components/dashboard/OverviewPage.tsx.
 * This file exists only because Next.js requires a `page.tsx` at every
 * routable path. Keep it as a one-liner so routing concerns stay
 * separated from view concerns (matches the pattern used by
 * /Plan → BudgetPage and /Statistics → StatisticsPage).
 */

import { OverviewPage } from "../../components/dashboard/OverviewPage";

export default function Page() {
  return <OverviewPage />;
}
