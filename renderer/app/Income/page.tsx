"use client";

/**
 * /Income route — thin Next.js entry point.
 *
 * Actual page logic lives in
 * components/app-settings/sections/IncomePage.tsx (which itself wraps the
 * embeddable IncomesSection). Kept as a one-liner so routing stays
 * separated from view logic, matching the pattern used by every other
 * route in this app.
 */

import { IncomePage } from "../../components/app-settings/sections/IncomePage";

export default function Page() {
  return <IncomePage />;
}
