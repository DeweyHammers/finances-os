"use client";

/**
 * Personal/page.tsx — Next.js route entry for /Personal.
 *
 * Thin wrapper that delegates to PersonalList. Personal items (Gas, Spending,
 * etc.) are per-pay-period allowances that flow into the auto-assign logic on
 * the Plan page. Real logic lives in components/personal/list.
 */

import { PersonalList } from "../../components/personal/list";

export default function PersonalPage() {
  return <PersonalList />;
}
