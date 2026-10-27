"use client";

/**
 * /Settings route — thin Next.js entry point.
 *
 * Actual page logic lives in components/settings/SettingsPage.tsx, matching
 * the route-wrapper convention used by every other route in this app.
 */

import { SettingsPage } from "../../components/settings/SettingsPage";

export default function Page() {
  return <SettingsPage />;
}
