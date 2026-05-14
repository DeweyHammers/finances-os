"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";
import { AccountLedger } from "../../components/accounts/AccountLedger";

function CashContent() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params?.get("id");

  useEffect(() => {
    if (!id) router.replace("/");
  }, [id, router]);

  if (!id) return null;
  return <AccountLedger accountId={id} />;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <CashContent />
    </Suspense>
  );
}
