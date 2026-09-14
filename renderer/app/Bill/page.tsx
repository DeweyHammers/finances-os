"use client";

/**
 * Bill/page.tsx — Next.js route entry for /Bill.
 *
 * Thin wrapper that delegates to the BillList component. Real CRUD UI (list,
 * create, edit, delete for recurring monthly bills) lives in
 * components/bills/list.
 */

import { BillList } from "../../components/bills/list";

export default function Page() {
  return <BillList />;
}
