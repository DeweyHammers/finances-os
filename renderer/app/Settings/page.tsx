"use client";

/**
 * /Settings route — thin Next.js entry point for /Settings?tab=<general|
 * budget|data|sync>.
 *
 * Like Cash/page.tsx it has one piece of routing logic: it reads the `tab`
 * query parameter (which section is open) and hands it to the page. Actual
 * page logic lives in components/settings/SettingsPage.tsx, matching the
 * route-wrapper convention used by every other route in this app.
 */

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { SettingsPage } from "../../components/settings/SettingsPage";

// Split out so it can sit under <Suspense>: useSearchParams() suspends during
// static export / hydration and needs the boundary above its call site.
function SettingsContent() {
  const params = useSearchParams();
  return <SettingsPage tab={params?.get("tab") ?? undefined} />;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SettingsContent />
    </Suspense>
  );
}
