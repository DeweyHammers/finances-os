// tour.mjs — builds the docs/ tour: starts from an EMPTY app and fills it,
// step by step, with a made-up person's finances, taking a 1920×1080
// screenshot at every step.
//
//   node scripts/demo/create-db.mjs          # (re)start from an empty DB
//   npx tsx scripts/demo/serve.ts            # demo API on prisma/demo/demo.db
//   (cd renderer && npx next dev -p 8888)    # the app UI
//   node scripts/demo/tour.mjs               # → docs/img/tour/*.png
//
// EVERYTHING here is fictional ("Alex", round numbers, generic payees). The
// repo is public: never put real names, amounts or employers in this file.
//
// The story runs on a frozen clock (October 2026, weekly Friday paydays) so
// the pictures are identical on every run. One item of each kind is entered
// through the real UI forms (so the tour shows the form); the rest go in
// through the same REST API the forms use.
import path from "node:path";
import fs from "node:fs";
import { execSync, spawn, spawnSync } from "node:child_process";
import { launch } from "./cdp.mjs";

const OUT = path.join("docs", "img", "tour");
// `DEMO_API_PORT` matches serve.ts: run the demo API on another port (and the
// renderer with NEXT_PUBLIC_API_URL) while the installed app still owns 5858.
const API = `http://127.0.0.1:${process.env.DEMO_API_PORT ?? 5858}/api`;

// The sync step connects the demo app to a MOCK of the cloud protocol
// (tests/helpers/libsql-sync-server-child.ts, the same one the sync tests
// run) on this port, so the tour never needs a real Turso account. The URL
// and token typed into the Settings form for the picture are fictional; the
// real connection is made through the API against the mock. The demo app
// keeps its sync.json and local copy in prisma/demo/, never beside dev.db.
const SYNC_MOCK_PORT = 18081;
const SYNC_MOCK_URL = `http://127.0.0.1:${SYNC_MOCK_PORT}`;
const SYNC_URL_SHOWN = "libsql://finances-alex.turso.io";
const SYNC_TOKEN_SHOWN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.alex-demo-token";

// ── Fake data ────────────────────────────────────────────────────────────
const INCOME = { name: "Paycheck", amount: 1150, paymentCycle: "WEEKLY", payDay: 5 }; // Fridays
const BILLS = [
  // [name, amount, due day] — the first one is typed into the UI form.
  ["Rent", 1400, 1],
  ["Gym Membership", 35, 5],
  ["Car Insurance", 128, 8],
  ["Electric", 95, 12],
  ["Car Payment", 310, 15],
  ["Internet", 65, 18],
  ["Phone", 55, 22],
  ["Streaming", 16, 27],
];
const PERSONALS = [
  // Every-pay-week allowances (repeatWeekly) — the first is typed into the UI.
  { name: "Groceries", amount: 125, repeatWeekly: true },
  { name: "Gas", amount: 45, repeatWeekly: true },
  { name: "Fun Money", amount: 40, repeatWeekly: true },
  // A monthly total spread across the pay weeks.
  { name: "Household", amount: 120, splitAcrossWeeks: true },
  // "Pay yourself first": a fixed weekly transfer to savings. Modeled as a
  // weekly personal (not a Custom Plan item): a no-cycle Custom item gets a
  // flat amount from every Auto-assign but the ⚠ badge expects it monthly,
  // so it would be flagged over-funded by week 2.
  { name: "Savings", amount: 100, repeatWeekly: true },
];
const YEARLY = [
  // [name, amount, month, day] — the first is typed into the UI.
  ["Car Registration", 180, 3, 10],
  ["Website & Domain", 120, 1, 5],
  ["Warehouse Club", 65, 5, 1],
  ["Holiday Gifts", 400, 12, 1],
];

// ── Helpers ──────────────────────────────────────────────────────────────
async function api(method, resource, body) {
  const res = await fetch(`${API}/${resource}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${resource} → ${res.status} ${await res.text()}`);
  return res.json();
}
const post = (r, b) => api("POST", r, b);

let shotNo = 0;
async function shot(page, name) {
  shotNo++;
  const file = path.join(OUT, `${String(shotNo).padStart(2, "0")}-${name}.png`);
  await page.shot(file);
  // The page's text next to every picture (scripts/demo/out/ is gitignored):
  // docs/index.html quotes numbers from these shots, so this is where to read
  // them after a re-run instead of squinting at the PNGs.
  fs.mkdirSync(path.join("scripts", "demo", "out"), { recursive: true });
  fs.writeFileSync(path.join("scripts", "demo", "out", `${name}.txt`), await page.text());
  console.log(`  📸 ${file}`);
}

/** Poll the page text until it matches (e.g. Optimize's result toast). */
async function waitForText(page, re, maxMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (re.test(await page.text())) return;
    await page.sleep(500);
  }
  throw new Error(`timed out waiting for ${re}`);
}

/** Poll until the page text no longer matches. */
async function waitForNoText(page, re, maxMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (!re.test(await page.text())) return;
    await page.sleep(500);
  }
  throw new Error(`timed out waiting for ${re} to disappear`);
}

/** Scroll whichever element actually scrolls the page content. */
async function scrollMain(page, y) {
  await page.evaluate(`(() => {
    const els = [document.scrollingElement, ...document.querySelectorAll("main, main *")];
    const el = els.find(e => e && e.scrollHeight > e.clientHeight + 50 &&
      getComputedStyle(e).overflowY !== "visible") || document.scrollingElement;
    el.scrollTo(0, ${y});
  })()`);
  await page.sleep(500);
}

/** In the Auto-assign popover, click the (current) pay-week button. */
async function clickPeriodButton(page) {
  await page.evaluate(`(() => {
    const cap = [...document.querySelectorAll(".MuiPopover-paper span, .MuiPopover-paper p")]
      .find(e => e.textContent.trim().toLowerCase() === "auto-assign for pay week");
    const btn = cap.parentElement.querySelector("button");
    btn.click();
  })()`);
  await page.sleep(800);
  await page.settle();
  await page.sleep(500);
}

/** Start the sync mock in its own process and wait until it answers. */
async function startSyncMock() {
  const proc = spawn("npx", ["tsx", "tests/helpers/libsql-sync-server-child.ts", "--port", String(SYNC_MOCK_PORT)], {
    stdio: "ignore",
    shell: true,
  });
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${SYNC_MOCK_URL}/info`);
      return proc;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  killTree(proc);
  throw new Error("the sync mock never came up");
}

/** Kill a `shell: true` child and everything it spawned (Windows: the whole tree). */
function killTree(proc) {
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
  else proc.kill();
}

/**
 * "Forget this device" if the demo API is synced — at the start (a previous
 * run that died mid-step would otherwise leave the API on a copy of a cloud
 * that no longer exists) and at the end (so the demo DB is local again).
 */
async function forgetSync() {
  const status = await api("GET", "sync");
  if (status.configured) await post("sync/disconnect");
}

// ── The tour ─────────────────────────────────────────────────────────────
await forgetSync();
execSync("node scripts/demo/create-db.mjs", { stdio: "ignore" });
const page = await launch({ width: 1920, height: 1080 });
let syncMock = null;
try {
  // Day 0: Thursday Oct 1 2026, the day Alex installs the app.
  await page.setClock("2026-10-01T09:00:00");

  console.log("Step 1 · a brand-new, empty app");
  await page.goto("/Overview");
  await shot(page, "empty-overview");

  console.log("Step 2 · add income");
  await page.goto("/Income");
  await page.clickText("Add Your First Income");
  await page.fill("Name", INCOME.name);
  await page.fill("Amount per period", INCOME.amount);
  await page.clickText("Weekly", "[role=dialog] button");
  await page.clickText("Fri", "[role=dialog] button");
  await shot(page, "income-form");
  await page.click(".MuiDialogActions-root button:last-child");
  await shot(page, "income-list");

  console.log("Step 3 · add bills");
  await page.goto("/Bill");
  await shot(page, "bills-empty");
  await page.clickText("Create New Bill");
  await page.fill("Bill Name", BILLS[0][0]);
  await page.fill("Amount", BILLS[0][1]);
  await page.fill("Due Day", BILLS[0][2]);
  await shot(page, "bill-form");
  await page.click(".MuiDialogActions-root button:last-child");
  for (const [name, amount, dueDate] of BILLS.slice(1)) {
    await post("Bill", { name, amount, dueDate });
  }
  await page.goto("/Bill");
  await shot(page, "bills-list");

  console.log("Step 4 · add personal expenses");
  await page.goto("/Personal");
  await page.clickText("Create New Personal");
  await page.fill("Personal Bill Name", PERSONALS[0].name);
  await page.fill("Amount", PERSONALS[0].amount);
  await page.clickText("Every Pay Week", "[role=dialog] button");
  await shot(page, "personal-form");
  await page.click(".MuiDialogActions-root button:last-child");
  for (const p of PERSONALS.slice(1)) await post("Personal", p);
  await page.goto("/Personal");
  await shot(page, "personal-list");

  console.log("Step 5 · add yearly costs");
  await page.goto("/YearlyCosts");
  for (const [name, amount, month, day] of YEARLY) {
    await post("YearlyCost", { name, amount, month, day });
  }
  await page.goto("/YearlyCosts");
  await shot(page, "yearly-list");

  console.log("Step 6 · Overview + Optimize");
  await page.goto("/Overview");
  await shot(page, "overview-before-optimize");
  await page.clickText("Optimize");
  // Optimize plans 36 months and writes a few hundred rows; its success toast
  // only lives 3 s, so wait for the writes to finish and the alert to clear.
  await page.settle(2000, 180000);
  await waitForNoText(page, /Bills were added or updated|Optimize failed/, 60000);
  await page.sleep(3500); // let the success toast fade out of the picture
  await shot(page, "overview-optimized");
  await scrollMain(page, 1000);
  await shot(page, "overview-bills");

  console.log("Step 7 · add a cash account");
  await page.clickText("Add Account");
  await page.fill("Account Nickname", "Checking");
  await page.fill("Starting Balance", 1800);
  await shot(page, "account-form");
  await page.click(".MuiDialogActions-root button:last-child");
  const [checking] = await api("GET", "Account");

  console.log("Step 8 · build the Plan");
  await page.goto("/Plan");
  await page.clickText("Create your first group");
  await page.fill("Group Name", "Bills");
  await shot(page, "plan-group-form");
  await page.click(".MuiDialogActions-root button:last-child");
  const groups = { Bills: (await api("GET", "BudgetCategoryGroup"))[0] };
  groups.Everyday = await post("BudgetCategoryGroup", { name: "Everyday", sortOrder: 1 });
  groups.Goals = await post("BudgetCategoryGroup", { name: "Goals", sortOrder: 2 });
  const items = {};
  let order = 0;
  for (const b of await api("GET", "Bill?_sort=dueDate&_order=asc")) {
    items[b.name] = await post("BudgetCategoryItem", {
      groupId: groups.Bills.id, name: b.name, sortOrder: order++,
      sourceType: "BILL", sourceBillId: b.id,
    });
  }
  for (const p of PERSONALS) {
    items[p.name] = await post("BudgetCategoryItem", {
      groupId: (p.name === "Savings" ? groups.Goals : groups.Everyday).id,
      name: p.name, sortOrder: order++,
      sourceType: "PERSONAL_NAME", sourcePersonalName: p.name,
    });
  }
  await page.goto("/Plan");
  await shot(page, "plan-empty-envelopes");

  // ── October: five Friday paydays, spending in between ──
  const payee = {};
  const payeeId = async (name) => (payee[name] ??= (await post("Payee", { name })).id);
  const txn = async (date, payeeName, itemName, dollars) =>
    post("AccountTransaction", {
      accountId: checking.id, date, payeeId: await payeeId(payeeName),
      categoryItemId: items[itemName].id, outflowCents: Math.round(dollars * 100),
    });
  const SPENDING = {
    // spending that happens BEFORE each payday (keyed by that payday)
    "2026-10-09": [["2026-10-03", "FreshMart", "Groceries", 96.4], ["2026-10-04", "Fuel Stop", "Gas", 41.2],
                   ["2026-10-05", "City Gym", "Gym Membership", 35], ["2026-10-08", "SafeDrive Insurance", "Car Insurance", 128]],
    "2026-10-16": [["2026-10-10", "FreshMart", "Groceries", 112.75], ["2026-10-11", "Movie Theater", "Fun Money", 28],
                   ["2026-10-12", "Power & Light Co", "Electric", 91.37], ["2026-10-14", "Fuel Stop", "Gas", 44.1],
                   ["2026-10-15", "Auto Lender", "Car Payment", 310]],
    "2026-10-23": [["2026-10-17", "FreshMart", "Groceries", 104.9], ["2026-10-18", "FiberNet", "Internet", 65],
                   ["2026-10-19", "Home Goods", "Household", 46.8], ["2026-10-22", "Mobile Co", "Phone", 55]],
    "2026-10-30": [["2026-10-24", "FreshMart", "Groceries", 121.05], ["2026-10-25", "Fuel Stop", "Gas", 39.6],
                   ["2026-10-26", "Pizza Place", "Fun Money", 32.5], ["2026-10-27", "StreamBox", "Streaming", 16],
                   ["2026-10-29", "Home Goods", "Household", 38.25]],
  };
  for (const payday of ["2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30"]) {
    console.log(`Step 9 · payday ${payday}`);
    for (const t of SPENDING[payday] ?? []) await txn(...t);
    await page.setClock(`${payday}T09:00:00`);
    const first = payday === "2026-10-02";
    if (first) {
      // The first paycheck goes in through the real Cash form so the tour can
      // show HOW a paycheck is recorded: an inflow with the memo "Income" and
      // no category (the memo is what tells the app a paycheck has arrived —
      // see "Payday gating" in CLAUDE.md). The Date field already defaults to
      // "today", which the frozen clock has set to this payday.
      await page.goto(`/Cash?id=${checking.id}`);
      await page.clickText("Add Transaction");
      await page.fill("Payee", "Employer Payroll");
      // Enter commits the typed name (a new payee gets POSTed). Wait for that
      // before typing anything else: the form merges the new payee id into a
      // snapshot of its state taken when Enter was pressed, so a memo typed in
      // the meantime would be wiped (and the Save button is disabled until
      // the payee exists).
      await page.press("Enter");
      await page.settle();
      await page.fill("Memo", "Income");
      await page.fill("Inflow", INCOME.amount);
      await shot(page, "paycheck-form");
      await page.click(".MuiDialogActions-root button:last-child");
      // Remember the payee the form just created, so the later paydays
      // (posted through the API) reuse it instead of making a duplicate.
      payee["Employer Payroll"] = (await api("GET", "Payee")).find((p) => p.name === "Employer Payroll").id;
    } else {
      await post("AccountTransaction", {
        accountId: checking.id, date: payday, payeeId: await payeeId("Employer Payroll"),
        memo: "Income", inflowCents: INCOME.amount * 100,
      });
    }
    await page.goto("/Plan");
    if (first) await shot(page, "plan-payday");
    await page.clickText("Assign");
    await page.clickText("Auto", ".MuiPopover-paper div");
    if (first) await shot(page, "plan-auto-assign");
    await clickPeriodButton(page);
    if (first) await shot(page, "plan-funded");
  }

  console.log("Step 10 · end of the month");
  await page.setClock("2026-10-30T18:00:00");
  await page.goto("/Plan");
  await shot(page, "plan-month-end");
  await page.goto(`/Cash?id=${checking.id}`);
  await shot(page, "cash-ledger");
  await page.goto("/Overview");
  await shot(page, "overview-month-end");

  console.log("Step 11 · what if? (sandbox)");
  // Alex wonders what cancelling the gym would do to next month. Try it on a
  // COPY of the data: "Try a sandbox" (Settings -> Data) copies the database
  // and reloads the page with the amber banner; the real data is untouched
  // until Keep.
  // The /Settings URL is the page form of Settings on every width (in-app it
  // is a popup on desktop), so the tour can land on the Data tab directly.
  await page.goto("/Settings?tab=data");
  await page.clickText("Try a sandbox");
  await page.sleep(1500);
  await page.settle();
  await waitForText(page, /You're working on a copy/);
  const gym = (await api("GET", "Bill")).find((b) => b.name === "Gym Membership");
  await api("DELETE", `Bill/${gym.id}`);
  await page.goto("/Overview");
  await waitForText(page, /Bills were added or updated/);
  await page.clickText("Optimize");
  await page.settle(2000, 180000);
  await waitForNoText(page, /Bills were added or updated|Optimize failed/, 60000);
  await page.sleep(3500);
  // November is where the change shows (October's weeks are all locked).
  await page.click('button:has(svg[data-testid="NavigateNextIcon"])');
  await page.sleep(800);
  await page.settle();
  await shot(page, "sandbox-whatif");
  await page.clickText("Discard");
  await page.sleep(600);
  await page.settle();
  await shot(page, "sandbox-discard");
  await page.clickText("Discard changes");
  await page.sleep(1500);
  await page.settle();
  await page.goto("/Overview");
  await waitForNoText(page, /You're working on a copy/);

  await page.goto("/Statistics");
  await page.clickText("Month-to-Month");
  await shot(page, "statistics-month");
  await page.clickText("Yearly Overview");
  await shot(page, "statistics-year");

  console.log("Step 12 · sync across devices");
  // The Settings form, filled with a made-up Turso URL and token (not
  // submitted: the picture is what matters).
  await page.goto("/Settings?tab=sync");
  await page.fill("Database URL", SYNC_URL_SHOWN);
  await page.fill("Token", SYNC_TOKEN_SHOWN);
  await shot(page, "sync-settings");
  // The real thing, against the mock: the data is uploaded and the green
  // "Synced" status appears at the bottom of the sidebar.
  syncMock = await startSyncMock();
  await post("sync/connect", { url: SYNC_MOCK_URL, token: "alex-demo-token" });
  await page.goto("/Overview");
  await waitForText(page, /Synced/);
  await shot(page, "sync-status");
} finally {
  await page.close();
  // Back to local only, whatever happened above; then stop the mock.
  try {
    await forgetSync();
  } catch (e) {
    console.warn(`(could not forget the sync setup: ${e.message})`);
  }
  if (syncMock) killTree(syncMock);
  if (page.problems.length) {
    console.log("\nProblems seen during the tour:");
    for (const p of page.problems) console.log("  " + p);
  }
}
