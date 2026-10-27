// empty-check.mjs — smoke test: open every page of a brand-new, EMPTY app.
//
// Run against a fresh prisma/demo.db (create-db.mjs) with serve.ts + the
// renderer running. Each route is screenshotted to scripts/demo/out/empty/
// and any crash, console error or failed API call is reported. Exit code 1
// if anything went wrong, so it can be scripted.
import path from "node:path";
import { launch } from "./cdp.mjs";

// AppSettings GET 404s until the first save on a fresh DB — expected (the UI has fallbacks).
const EXPECTED = /API 404: .*\/api\/AppSettings\/global$/;
// Text that means a page rendered garbage or crashed.
const BAD_TEXT = /Application error|Unhandled Runtime Error|could not be found|\bNaN\b|\bundefined\b|Infinity/;
const ROUTES = [
  "/", "/Overview", "/Plan", "/Statistics", "/Cash",
  "/Bill", "/Personal", "/YearlyCosts", "/Income", "/Payees", "/Settings",
];
const OUT = path.join("scripts", "demo", "out", "empty");

const page = await launch({ width: 1920, height: 1080 });
const report = [];
try {
  for (const route of ROUTES) {
    const before = page.problems.length;
    await page.goto(route);
    const name = route === "/" ? "root" : route.slice(1);
    await page.shot(path.join(OUT, `${name}.png`));
    const text = await page.text();
    const m = text.match(new RegExp(`.{0,60}(${BAD_TEXT.source}).{0,60}`));
    report.push({
      route,
      problems: page.problems.slice(before).filter((p) => !EXPECTED.test(p)),
      suspiciousText: m ? m[0] : null,
    });
  }
} finally {
  await page.close();
}

let bad = 0;
for (const r of report) {
  const ok = r.problems.length === 0 && !r.suspiciousText;
  if (!ok) bad++;
  console.log(`${ok ? "OK  " : "FAIL"} ${r.route}`);
  for (const p of r.problems) console.log(`       ${p}`);
  if (r.suspiciousText) console.log(`       text: ${r.suspiciousText}`);
}
process.exit(bad ? 1 : 0);
