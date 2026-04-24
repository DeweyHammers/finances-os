import path from "path";
import fs from "fs";
import { exec, execSync } from "child_process";
import { app, ipcMain, protocol, session } from "electron";
import serve from "electron-serve";
import { createWindow } from "./helpers/create-window";
import { startServer } from "./api-server";

const isProd = process.env.NODE_ENV === "production";

// 1. MUST register schemes at the very top
if (isProd) {
  protocol.registerSchemesAsPrivileged([
    { scheme: "app", privileges: { standard: true, secure: true, allowServiceWorkers: true, supportFetchAPI: true, corsEnabled: true } }
  ]);
  // 2. MUST call serve at top level
  serve({ directory: "app" });
}

// Global cleanup function
const cleanup = () => {
  console.log("Cleanup triggered");
  if (!isProd) {
    try {
      // Clean up ports only in dev
      execSync(`powershell -Command "Get-NetTCPConnection -LocalPort 8888 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`);
    } catch (e) {}
  }
};

(async () => {
  console.log("App starting...");
  await app.whenReady();

  // 3. Start API server after ready
  startServer(5858);

  if (isProd) {
    // Setup logging
    const logFile = path.join(app.getPath("userData"), "app.log");
    const logStream = fs.createWriteStream(logFile, { flags: "a" });
    process.stdout.write = logStream.write.bind(logStream) as any;
    process.stderr.write = logStream.write.bind(logStream) as any;
    console.log("--- App started ---");

    // 4. Handle index.html redirection
    session.defaultSession.webRequest.onBeforeRequest({ urls: ["app://./*"] }, (details, callback) => {
      let { url } = details;
      if (url.endsWith("/")) {
        url += "index.html";
        callback({ redirectURL: url });
      } else {
        callback({});
      }
    });
  }

  const mainWindow = createWindow({
    width: 1000,
    height: 600,
    show: false,
    backgroundColor: "#0f172a",
    icon: path.join(__dirname, "../resources/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.maximize();
  mainWindow.setBackgroundColor("#0f172a");

  if (isProd) {
    await mainWindow.loadURL("app://./");
    mainWindow.show();
    mainWindow.focus();
  } else {
    const port = process.argv[2] || "8888";
    const url = `http://localhost:${port}/`;
    console.log(`Loading URL: ${url}`);

    const loadURLWithRetry = async (retries = 40) => {
      for (let i = 0; i < retries; i++) {
        try {
          await new Promise((resolve, reject) => {
            const http = require("http");
            const req = http.get(url, (res: any) => {
              if (res.statusCode === 200) resolve(true);
              else reject();
            });
            req.on("error", reject);
            req.setTimeout(500, reject);
            req.end();
          });

          console.log("Dev server is up, loading...");
          await mainWindow.loadURL(url);
          mainWindow.show();
          mainWindow.focus();
          return;
        } catch (e) {
          console.log(`Dev server not ready, retry ${i + 1}...`);
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }
      mainWindow.show();
      mainWindow.focus();
    };
    await loadURLWithRetry();
  }
})();

app.on("window-all-closed", () => {
  cleanup();
  app.quit();
});

app.on("before-quit", cleanup);
process.on("exit", cleanup);

ipcMain.on("message", (event, arg) => {
  event.reply("message", `${arg} World!`);
});
