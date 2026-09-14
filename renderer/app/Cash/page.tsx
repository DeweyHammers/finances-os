"use client";

/**
 * Cash/page.tsx — Next.js route entry for /Cash?id=<accountId>.
 *
 * Renders the YNAB-style account ledger (transactions list, running balance)
 * for a specific Account. Unlike the other route files, this one has real
 * routing logic: it reads the required `id` query param and bounces back to /
 * (Plan) if it's missing. The AccountLedger component owns all UI/CRUD.
 */

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";
import { AccountLedger } from "../../components/accounts/AccountLedger";

// ── Inner content component ──
// Split out so we can wrap it in <Suspense>. useSearchParams() suspends during
// static export / hydration, and Next.js requires the boundary to be an
// ancestor of the hook call site.
function CashContent() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params?.get("id");

  // Guard: without an account id there's nothing to render. Redirect to root
  // (which itself redirects to /Plan) rather than showing an empty screen or
  // throwing. Runs on mount and whenever id changes.
  useEffect(() => {
    if (!id) router.replace("/");
  }, [id, router]);

  // Render nothing for the tick between mount and the redirect kicking in —
  // avoids AccountLedger receiving an empty accountId.
  if (!id) return null;
  return <AccountLedger accountId={id} />;
}

export default function Page() {
  // Suspense boundary required by useSearchParams() in Next 14 app router.
  return (
    <Suspense fallback={null}>
      <CashContent />
    </Suspense>
  );
}
