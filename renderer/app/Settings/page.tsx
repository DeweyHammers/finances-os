"use client";

/**
 * /Settings route — `/Settings?tab=<general|budget|data|sync>`, the PAGE form
 * of Settings with the open tab in the URL.
 *
 * In-app, Settings opens as a popup on desktop widths (the sider item and the
 * Overview's surplus pill go through SettingsDialogContext); below the sider
 * breakpoint those open this page instead. The URL itself always renders the
 * page, on every width: links and the demo tour can rely on it, and opening a
 * dialog in the middle of a fresh page load left its fade-in stuck at
 * opacity 0 (tried Oct 27 2026, with delays either side of the redirect).
 */

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SettingsPage } from "../../components/settings/SettingsPage";
import { resolveSettingsTab, settingsHref } from "../../components/settings/SettingsDialogContext";

// Split out so it can sit under <Suspense>: useSearchParams() suspends during
// static export / hydration and needs the boundary above its call site.
function SettingsContent() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = resolveSettingsTab(params?.get("tab"));
  return <SettingsPage tab={tab} onTabChange={(next) => router.push(settingsHref(next))} />;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SettingsContent />
    </Suspense>
  );
}
