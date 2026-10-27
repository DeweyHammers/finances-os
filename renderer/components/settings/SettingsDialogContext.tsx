"use client";

/**
 * SettingsDialogContext — how Settings opens.
 *
 * On a desktop-width window Settings is a POPUP (Obsidian / Discord style):
 * it opens over whatever page is current and closes back to it. Below the
 * sider breakpoint (phones, very narrow windows) it is a normal page at
 * /Settings?tab=…, because a dialog the size of the screen is just a page
 * with a worse back button (user decision, Oct 27 2026).
 *
 * `openSettings(tab)` applies that rule, so every caller — the sider's
 * Settings item, the Overview's surplus pill (→ Budget), the /Settings route
 * — just says which tab it wants. Mounted once in app/providers.tsx together
 * with <SettingsDialog />.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMediaQuery, useTheme } from "@mui/material";
import { useRouter } from "next/navigation";
import { SIDER_BREAKPOINT } from "../../lib/constants";
import { loadBackups, loadMeta } from "../../lib/meta-api";

export type SettingsTab = "general" | "budget" | "data" | "sync";

export const SETTINGS_TABS: readonly SettingsTab[] = ["general", "budget", "data", "sync"];

/** The tab for a `?tab=` value; anything unknown opens General. */
export function resolveSettingsTab(value: string | null | undefined): SettingsTab {
  return SETTINGS_TABS.includes(value as SettingsTab) ? (value as SettingsTab) : "general";
}

/** The /Settings URL for a tab (the page form, used below the breakpoint). */
export function settingsHref(tab: SettingsTab): string {
  return `/Settings?tab=${tab}`;
}

interface SettingsDialogValue {
  /** True below the sider breakpoint: Settings is a page there, never a dialog. */
  asPage: boolean;
  /** Dialog open (always false while `asPage`). */
  open: boolean;
  tab: SettingsTab;
  /** Open Settings on `tab` (General when omitted): dialog or page per `asPage`. */
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  setTab: (tab: SettingsTab) => void;
}

const SettingsDialogContext = createContext<SettingsDialogValue | null>(null);

export function SettingsDialogProvider({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const asPage = useMediaQuery(theme.breakpoints.down(SIDER_BREAKPOINT));
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SettingsTab>("general");

  // Warm the app-facts and backup caches once at start, so the popup's
  // first render already has them (lib/meta-api.ts → "App-session cache").
  useEffect(() => {
    loadMeta().catch(() => {});
    loadBackups().catch(() => {});
  }, []);

  const openSettings = useCallback(
    (next?: SettingsTab) => {
      // Without a tab, Settings always starts on General (user feedback,
      // Oct 27 2026: reopening on the last tab was confusing); callers that
      // want a tab name it (the surplus pill → Budget).
      const target = next ?? "general";
      setTab(target);
      if (asPage) router.push(settingsHref(target));
      else setOpen(true);
    },
    [asPage, router],
  );
  const closeSettings = useCallback(() => setOpen(false), []);

  const value = useMemo(
    () => ({ asPage, open: open && !asPage, tab, openSettings, closeSettings, setTab }),
    [asPage, open, tab, openSettings, closeSettings],
  );
  return <SettingsDialogContext.Provider value={value}>{children}</SettingsDialogContext.Provider>;
}

/**
 * The Settings opener. Outside the provider (a component rendered on its
 * own, e.g. the Overview in its lock-in tests) it falls back to the page
 * form: "open Settings" navigates to /Settings?tab=….
 */
export function useSettingsDialog(): SettingsDialogValue {
  const ctx = useContext(SettingsDialogContext);
  const router = useRouter();
  return useMemo<SettingsDialogValue>(
    () =>
      ctx ?? {
        asPage: true,
        open: false,
        tab: "general",
        openSettings: (tab?: SettingsTab) => router.push(settingsHref(tab ?? "general")),
        closeSettings: () => {},
        setTab: () => {},
      },
    [ctx, router],
  );
}
