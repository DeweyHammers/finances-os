import path from "path";
import fs from "fs";
import os from "os";
import { exec } from "child_process";
import { app, ipcMain } from "electron";
import serve from "electron-serve";
import { createWindow } from "./helpers/create-window";

const isProd = process.env.NODE_ENV === "production";
const signalFile = path.join(os.tmpdir(), "finances-os-active.signal");

// Hide console window on Windows in development
if (!isProd && process.platform === "win32") {
  const hideConsoleCommand =
    'powershell -command "Start-Sleep -Milliseconds 100; Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public class Win32 { [DllImport(\\\"kernel32.dll\\\")] public static extern IntPtr GetConsoleWindow(); [DllImport(\\\"user32.dll\\\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); }\'; [Win32]::ShowWindow([Win32]::GetConsoleWindow(), 0)"';
  exec(hideConsoleCommand);
}

if (isProd) {
  serve({ directory: "app" });
} else {
  app.setPath("userData", `${app.getPath("userData")} (development)`);
}

(async () => {
  await app.whenReady();

  // Ensure any old signal file is gone at start
  if (fs.existsSync(signalFile)) {
    try {
      fs.unlinkSync(signalFile);
    } catch (e) {}
  }

  const mainWindow = createWindow({
    width: 1000,
    height: 600,
    show: false, // Don't show until ready
    backgroundColor: "#0f172a", // Match your dark theme
    icon: path.join(import.meta.dirname, "../resources/icon.png"),
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.js"),
    },
  });

  mainWindow.maximize();
  mainWindow.setBackgroundColor("#0f172a");

  const launchTime = Date.now();
  const finalizeLaunch = () => {
    const elapsed = Date.now() - launchTime;
    const remaining = Math.max(0, 3500 - elapsed);

    setTimeout(() => {
      // SIGNAL SPLASH TO SELF-DESTRUCT BY DELETING THE FILE
      if (!isProd) {
        if (fs.existsSync(signalFile)) {
          try {
            fs.unlinkSync(signalFile);
          } catch (e) {}
        }

        // Fallback: Broad PowerShell kill
        exec(
          "powershell -Command \"Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like '*pre-splash*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }\"",
        );
      }

      setTimeout(() => {
        mainWindow.show();
        mainWindow.focus();
      }, 500);
    }, remaining);
  };

  if (isProd) {
    await mainWindow.loadURL("app://./");
    finalizeLaunch();
  } else {
    const port = process.argv[2];
    const url = `http://localhost:${port}/`;

    const loadURLWithRetry = async (retries = 30) => {
      for (let i = 0; i < retries; i++) {
        try {
          await new Promise((resolve, reject) => {
            const req = require("http").get(url, (res: any) => {
              if (res.statusCode === 200) resolve(true);
              else reject();
            });
            req.on("error", reject);
            req.end();
          });

          await mainWindow.loadURL(url);
          mainWindow.once("ready-to-show", finalizeLaunch);
          return;
        } catch (e) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      await mainWindow.loadURL(
        `data:text/html,<html><body style="background:#0f172a;color:white;font-family:sans-serif;padding:20px;"><h1>Failed to load dev server at ${url}</h1><p>Please check if the dev server is running.</p></body></html>`,
      );
      finalizeLaunch();
    };

    await loadURLWithRetry();
  }
})();

app.on("window-all-closed", () => {
  app.quit();
});

const cleanup = () => {
  if (!isProd) {
    if (fs.existsSync(signalFile)) {
      try {
        fs.unlinkSync(signalFile);
      } catch (e) {}
    }
    exec(
      "powershell -Command \"Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like '*pre-splash*' -or $_.CommandLine -like '*hide-terminal.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }\"",
    );
    exec(
      `powershell -Command "Get-WmiObject Win32_Process -Filter \\"ParentProcessId = ${process.pid}\\" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`,
    );
  }
};

app.on("before-quit", cleanup);
process.on("exit", cleanup);

ipcMain.on("message", async (event, arg) => {
  event.reply("message", `${arg} World!`);
});
