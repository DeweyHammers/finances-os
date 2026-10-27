"use client";

/**
 * /Settings route — `/Settings?tab=<general|budget|data|sync>`.
 *
 * Below the sider breakpoint (phones) this IS the Settings page, with the
 * open tab in the URL. On a desktop-width window Settings is a popup instead
 * (components/settings/SettingsDialog.tsx), so the route opens the dialog on
 * the requested tab and sends the page back to the root route (→ Plan); the
 * dialog state lives above the routes (app/providers.tsx) and survives that.
 * Links and the demo tour can therefore use the URL in both modes.
 */

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SettingsPage } from "../../components/settings/SettingsPage";
import {
  resolveSettingsTab,
  settingsHref,
  useSettingsDialog,
} from "../../components/settings/SettingsDialogContext";

// Split out so it can sit under <Suspense>: useSearchParams() suspends during
// static export / hydration and needs the boundary above its call site.
function SettingsContent() {
  const params = useSearchParams();
  const router = useRouter();
  const { asPage, openSettings } = useSettingsDialog();
  const tab = resolveSettingsTab(params?.get("tab"));

  // The page/dialog decision needs the real window width, which the static
  // export can't know: render nothing until mounted, then decide once.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!mounted || asPage) return;
    // Leave the route first, open once the page underneath has settled:
    // opening during the navigation left the dialog's fade-in stuck at
    // opacity 0 (the suspended route tree swallowed the transition).
    router.replace("/");
    const id = setTimeout(() => openSettings(tab), 250);
    return () => clearTimeout(id);
  }, [mounted, asPage, tab, openSettings, router]);

  if (!mounted || !asPage) return null;
  return <SettingsPage tab={tab} onTabChange={(next) => router.push(settingsHref(next))} />;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SettingsContent />
    </Suspense>
  );
}
