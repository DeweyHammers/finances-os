// cdp.mjs — tiny headless-Chrome driver for the demo tour (no Puppeteer dep).
//
// Launches Chrome/Edge headless with a THROWAWAY profile in the OS temp dir
// (fresh localStorage every run, never the user's real browser profile) and
// talks to it over the Chrome DevTools Protocol with Node's built-in WebSocket.
//
// Every console error, uncaught exception and failed API request is recorded
// in `page.problems`, so a capture run doubles as a smoke test.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const PORT = 9333;
export const BASE_URL = "http://localhost:8888";
// Port of the demo API (serve.ts `--port` / DEMO_API_PORT), so failed API
// calls are still caught when the tour runs beside the installed app.
const API_PORT = process.env.DEMO_API_PORT ?? "5858";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ width = 1440, height = 900 } = {}) {
  const exe = process.env.CHROME_PATH ?? BROWSERS.find((p) => fs.existsSync(p));
  if (!exe) throw new Error("No Chrome/Edge found; set CHROME_PATH");

  const profile = path.join(os.tmpdir(), "finances-os-demo-chrome");
  fs.rmSync(profile, { recursive: true, force: true });

  const proc = spawn(exe, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: "ignore" });

  // Wait for the DevTools endpoint, then attach to the first page target.
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === "page");
    } catch {}
    if (!target) await sleep(200);
  }
  if (!target) throw new Error("Chrome DevTools endpoint never came up");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let nextId = 1;
  const pending = new Map();
  const problems = [];
  // Requests still waiting for a response. Long-lived streams (Next's dev
  // hot-reload EventSource, websockets) never finish, so they're excluded —
  // otherwise every settle() would sit out its full timeout.
  const inflightIds = new Set();
  // `hot-update`: the first time `next dev` compiles a route (every route, in
  // a fresh checkout or worktree) the page asks for
  // /_next/static/webpack/webpack.<hash>.hot-update.js and Chrome never
  // reports that request as finished or failed. It stayed in the set for the
  // rest of the run, so every settle() sat out its full 20 s: about a minute
  // per picture again on Nov 25 2026, in a new worktree.
  const isLongLived = (p) =>
    p.type === "EventSource" || p.type === "WebSocket" ||
    /webpack-hmr|hot-update|_next\/static\/development|__nextjs|turbopack-hmr/.test(p.request?.url ?? "");
  // Only the app's own requests (the UI on localhost, the demo API on
  // 127.0.0.1) count for settle(). The page also makes one request to a
  // third-party host (Refine's telemetry ping); if that host is slow to
  // answer, every settle() would sit out its full 20 s — which is what a run
  // on Nov 25 2026 looked like: about a minute per picture, and a 2-second
  // toast the tour waits for had gone before it looked.
  const isLocal = (p) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(p.request?.url ?? "");

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      return;
    }
    const p = msg.params;
    switch (msg.method) {
      case "Runtime.exceptionThrown":
        problems.push(`exception: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`);
        break;
      case "Runtime.consoleAPICalled":
        if (p.type === "error") {
          problems.push(`console.error: ${p.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 400)}`);
        }
        break;
      case "Network.requestWillBeSent":
        if (!isLongLived(p) && isLocal(p)) inflightIds.add(p.requestId);
        break;
      case "Network.loadingFinished":
      case "Network.loadingFailed": inflightIds.delete(p.requestId); break;
      case "Network.responseReceived":
        if (p.response.url.includes(`:${API_PORT}/`) && p.response.status >= 400) {
          problems.push(`API ${p.response.status}: ${p.response.url}`);
        }
        break;
    }
  };

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: 1, mobile: false,
  });
  // The app is dark-themed; make sure nothing renders in light mode.
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "dark" }],
  });

  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.text} :: ${expression.slice(0, 120)}`);
    return r.result.value;
  };

  /** Wait until no network requests are in flight for `quietMs`. */
  const settle = async (quietMs = 700, maxMs = 20000) => {
    const start = Date.now();
    let quietSince = Date.now();
    while (Date.now() - start < maxMs) {
      if (inflightIds.size > 0) quietSince = Date.now();
      else if (Date.now() - quietSince >= quietMs) return;
      await sleep(100);
    }
  };

  // Hide Next.js's dev-only overlay ("1 Issue" badge / build indicator) so it
  // never shows up in tour screenshots. Errors are still captured in `problems`.
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `document.addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = "nextjs-portal { display: none !important; }";
      document.head.appendChild(s);
    });`,
  });

  let clockScriptId = null;

  /** Re-run `check` until it returns truthy (pages load data async). */
  const retry = async (check, maxMs = 15000) => {
    const start = Date.now();
    for (;;) {
      const v = await check();
      if (v || Date.now() - start > maxMs) return v;
      await sleep(250);
    }
  };

  const page = {
    send, evaluate, settle, problems,
    /**
     * Freeze the app's notion of "today" (from the next navigation on).
     * The story is told on fixed dates so pay weeks, locking and
     * "current week" highlights are the same on every run, whatever the real
     * date is. Time still ticks forward from the given instant.
     */
    async setClock(isoLocal) {
      if (clockScriptId) {
        await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: clockScriptId });
      }
      const { identifier } = await send("Page.addScriptToEvaluateOnNewDocument", {
        source: `(() => {
          const Real = Date;
          const offset = new Real(${JSON.stringify(isoLocal)}).getTime() - Real.now();
          class FakeDate extends Real {
            constructor(...a) { a.length ? super(...a) : super(Real.now() + offset); }
            static now() { return Real.now() + offset; }
          }
          globalThis.Date = FakeDate;
        })();`,
      });
      clockScriptId = identifier;
    },
    /** Type into the MUI TextField whose label starts with `label`. */
    async fill(label, value) {
      const ok = await retry(() => evaluate(`(() => {
        const want = ${JSON.stringify(label)};
        const lab = [...document.querySelectorAll("label")]
          .filter(l => l.offsetParent !== null)
          .find(l => l.textContent.replace(/[*\\u2009\\s]+$/, "").trim().startsWith(want));
        const input = lab && (document.getElementById(lab.htmlFor) || lab.parentElement.querySelector("input,textarea"));
        if (!input) return false;
        input.focus();
        input.select?.();
        return true;
      })()`));
      if (!ok) throw new Error(`fill: no field labelled "${label}"`);
      // Select-all + insertText goes through React's real input events.
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
      await send("Input.insertText", { text: String(value) });
      await sleep(150);
    },
    /** Press a single key (e.g. "Enter") in the focused element. */
    async press(key, code = key, vk = 13) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
      await sleep(150);
    },
    /** Click the first visible element matching a CSS selector. */
    async click(selector) {
      const ok = await retry(() => evaluate(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.offsetParent !== null);
        if (!el) return false;
        el.click();
        return true;
      })()`));
      if (!ok) throw new Error(`click: nothing matching ${selector}`);
      await sleep(300);
      await settle();
      await sleep(300);
    },
    sleep,
    async goto(route) {
      // Requests of the page being left can no longer hold anything up, and
      // one that never reports back (see isLongLived) must not outlive it.
      inflightIds.clear();
      await send("Page.navigate", { url: `${BASE_URL}${route}` });
      await sleep(500);
      await settle();
      // Wait out loading spinners (pages render a CircularProgress first).
      await retry(() => evaluate(
        "![...document.querySelectorAll('.MuiCircularProgress-root')].some(e => e.offsetParent !== null)",
      ));
      await settle();
      await sleep(600); // let MUI transitions / charts finish
    },
    /** Viewport screenshot → PNG file. */
    async shot(file) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(file, Buffer.from(data, "base64"));
    },
    /** Click the first visible element whose text (or aria-label) matches. */
    async clickText(text, selector = "button, [role=button], [role=tab], a, li") {
      const ok = await retry(() => evaluate(`(() => {
        const want = ${JSON.stringify(text)};
        const els = [...document.querySelectorAll(${JSON.stringify(selector)})]
          .filter(e => e.offsetParent !== null);
        const el = els.find(e => (e.innerText || "").trim() === want)
          || els.find(e => e.getAttribute("aria-label") === want)
          || els.find(e => (e.innerText || "").trim().startsWith(want));
        if (!el) return false;
        el.click();
        return true;
      })()`));
      if (!ok) throw new Error(`clickText: nothing matching "${text}"`);
      await sleep(300);
      await settle();
      await sleep(300);
    },
    async text() {
      return evaluate("document.body.innerText");
    },
    async close() {
      try { ws.close(); } catch {}
      proc.kill();
      await sleep(300);
      // Chrome can still hold the profile dir for a moment after the kill
      // (EPERM on Windows); retry, and never let cleanup fail the run.
      try {
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
      } catch (e) {
        console.warn(`(could not remove throwaway profile ${profile}: ${e.code ?? e.message})`);
      }
    },
  };
  return page;
}
