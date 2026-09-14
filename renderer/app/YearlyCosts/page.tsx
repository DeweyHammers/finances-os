"use client";

/**
 * YearlyCosts/page.tsx — Next.js route entry for /YearlyCosts.
 *
 * Thin wrapper that delegates to YearlyCostList. Yearly costs are one-off /
 * annual expenses (e.g., insurance premiums, subscriptions billed yearly) that
 * factor into the long-view planning. Real logic lives in
 * components/yearly-costs/list.
 */

import { YearlyCostList } from "../../components/yearly-costs/list";

export default function YearlyCostsPage() {
  return <YearlyCostList />;
}
