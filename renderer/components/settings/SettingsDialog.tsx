"use client";

/**
 * SettingsDialog — the Settings popup for desktop-width windows: a near
 * full-window modal like Discord's settings (nav column flush left, content
 * beside it, X in the corner) that Esc, the backdrop and the X close. Below
 * the sider breakpoint it renders nothing — Settings is the /Settings page
 * there (see SettingsDialogContext). The content is SettingsPage in its
 * dialog form; open state and tab come from the context.
 */
import { Dialog } from "@mui/material";
import { SettingsPage } from "./SettingsPage";
import { useSettingsDialog } from "./SettingsDialogContext";

export const SettingsDialog = () => {
  const { asPage, open, tab, setTab, closeSettings } = useSettingsDialog();
  if (asPage) return null;

  return (
    <Dialog
      open={open}
      onClose={closeSettings}
      maxWidth={false}
      aria-labelledby="settings-dialog-title"
      slotProps={{
        paper: {
          sx: {
            // Large but not wall-to-wall: a clear margin of page around it.
            width: "min(calc(100vw - 96px), 1240px)",
            height: "min(calc(100vh - 96px), 820px)",
            maxWidth: "none",
            m: 0,
            bgcolor: "#0f172a",
            backgroundImage: "none",
            border: "1px solid rgba(129, 140, 248, 0.2)",
            borderRadius: 2,
            boxShadow: "0 24px 64px rgba(0, 0, 0, 0.6)",
            display: "flex",
            flexDirection: "row",
            overflow: "hidden",
          },
        },
        backdrop: { sx: { bgcolor: "rgba(2, 6, 23, 0.75)" } },
      }}
    >
      <SettingsPage tab={tab} onTabChange={setTab} onClose={closeSettings} />
    </Dialog>
  );
};
