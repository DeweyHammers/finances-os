/**
 * updater.ts — the Electron-only half of in-app updates: hands
 * electron-updater's `autoUpdater` to main/updates.ts as its engine.
 *
 * Only the PACKAGED app gets an engine. `npm run dev` has no
 * resources/app-update.yml (electron-updater would look for a
 * dev-app-update.yml and fail), so there the Settings row falls back to the
 * link-only GitHub check — exactly what the hosted server does.
 *
 * What electron-updater does for us, configured here:
 *  - reads `latest.yml` from the newest GitHub Release of
 *    DeweyHammers/finances-os (provider + owner/repo come from
 *    resources/app-update.yml, baked in by electron-builder.yml → publish);
 *  - downloads the NSIS installer named in it to its own cache folder
 *    (%LOCALAPPDATA%\finances-os-updater\pending), checking the sha512 and
 *    using the .blockmap for a differential download when it can;
 *  - `quitAndInstall(true, true)` runs that installer with /S (silent) and
 *    relaunches the app afterwards.
 *
 * The app is unsigned, and electron-updater skips its publisher check when
 * no `publisherName` is configured — so an unsigned installer is accepted
 * (the sha512 from latest.yml is still verified).
 */
import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { checkForUpdate, registerUpdateEngine, setInstallBlock } from "./updates";
import { readSmartAppControlState } from "./smart-app-control";

/**
 * What Settings → General shows instead of Download while Smart App
 * Control is on (see main/smart-app-control.ts for the why).
 */
export const SMART_APP_CONTROL_MESSAGE =
  "Smart App Control is on for this PC, and it won't run an installer that an app starts " +
  "(Finances OS isn't code-signed yet). Download the installer from the Release page and run it " +
  "from your browser; your data stays where it is.";

/**
 * One quiet check after startup, so Settings can say "Version X is
 * available" without a click. It is a single small HTTPS fetch (the
 * Release's latest.yml), never a download, and a failure (offline) is
 * swallowed — see CheckOptions.silent.
 */
export const STARTUP_CHECK_DELAY_MS = 20_000;

export function initUpdater(): void {
  if (!app.isPackaged) {
    console.log("[Updates] not a packaged build — in-app updates off (link-only check)");
    return;
  }
  // Every step waits for the user: no download on check, no install on
  // quit. "Restart to update" is the only way an installer runs.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  // Goes to app.log in PROD (main.ts redirects stdout/stderr there).
  autoUpdater.logger = console;

  registerUpdateEngine(autoUpdater);

  // Smart App Control (Windows 11) blocks the silent installer and the app
  // would quit for nothing — found out on the first live update, Oct 29
  // 2026. Read once; the row then points at the Release page instead.
  readSmartAppControlState()
    .then((sac) => {
      if (sac === "on") {
        console.log("[Updates] Smart App Control is on — in-app install off, Release page link instead");
        setInstallBlock({ code: "SMART_APP_CONTROL", message: SMART_APP_CONTROL_MESSAGE });
      }
    })
    .catch(() => {
      /* unknown → treated as off, see smart-app-control.ts */
    });

  const t = setTimeout(() => {
    checkForUpdate({ silent: true }).catch(() => {
      /* silent: already folded into the status */
    });
  }, STARTUP_CHECK_DELAY_MS);
  // Never keep the process alive just for this.
  t.unref();
}
