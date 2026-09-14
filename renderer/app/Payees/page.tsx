"use client";

/**
 * Payees/page.tsx — Next.js route entry for /Payees.
 *
 * Thin wrapper that delegates to PayeesList. Payees are the counterparties on
 * account transactions (used by the YNAB-style Cash ledger). Real logic lives
 * in components/payees/list.
 */

import { PayeesList } from "../../components/payees/list";

export default function Page() {
  return <PayeesList />;
}
