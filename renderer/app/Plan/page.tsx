"use client";

/**
 * Plan/page.tsx — Next.js route entry for /Plan (the app's default landing page).
 *
 * Thin wrapper that delegates to BudgetPage — the YNAB-style monthly zero-based
 * budget UI (groups, subsections, items, auto-assign Q1-Q4). Root / redirects
 * here (see app/page.tsx). Real logic lives in components/budget/BudgetPage.
 */

import { BudgetPage } from "../../components/budget/BudgetPage";

export default function Page() {
  return <BudgetPage />;
}
