"use strict";

// One-off: run the auto-balance algorithm against dev.db.
// Mirrors renderer/lib/pay-period-utils.balancePayWeeks so we don't need to
// bundle renderer code for node. Writes BillSplit rows per (billId, monthKey,
// weekIndex). Delete-then-insert for the month.

const path = require("path");
const { PrismaClient } = require("@prisma/client");
process.env.DATABASE_URL = `file:${path.resolve(__dirname, "../prisma/dev.db").replace(/\\/g, "/")}`;

const prisma = new PrismaClient();

const monthKeyOf = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;
const MIN_SPLIT_CENTS = 2500;

function listPayDays(y, m, payWeekday, biWeekly) {
  const dim = new Date(y, m + 1, 0).getDate();
  const days = [];
  for (let d = 1; d <= dim; d++) {
    if (new Date(y, m, d).getDay() === payWeekday) days.push(d);
  }
  return biWeekly ? days.filter((_, i) => i % 2 === 0) : days;
}

function getPayPeriodsForMonth(year, month, payWeekday, biWeekly) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthPayDays = listPayDays(year, month, payWeekday, biWeekly);
  if (monthPayDays.length === 0) return [];
  const nextYear = month === 11 ? year + 1 : year;
  const nextMonth = month === 11 ? 0 : month + 1;
  const nextPayDays = listPayDays(nextYear, nextMonth, payWeekday, biWeekly);
  const nextFirst = nextPayDays.length > 0 ? nextPayDays[0] : null;
  const starts = [...monthPayDays];
  const ends = starts.slice(1).map((s) => s - 1);
  if (nextFirst != null && nextFirst > 1) ends.push(daysInMonth + (nextFirst - 1));
  else ends.push(daysInMonth);
  return starts.map((startDay, i) => ({
    key: `P${i + 1}`, index: i, startDay, endDay: ends[i], daysInMonth,
  }));
}

function distributeBillLevel(amountCents, existingBillsCents) {
  const N = existingBillsCents.length;
  if (N === 0) return [];
  if (amountCents <= 0) return new Array(N).fill(0);
  const included = new Set();
  for (let i = 0; i < N; i++) included.add(i);
  while (included.size > 0) {
    let sum = 0;
    for (const i of included) sum += existingBillsCents[i];
    const target = (sum + amountCents) / included.size;
    let excluded = false;
    for (const i of Array.from(included)) {
      if (existingBillsCents[i] >= target) { included.delete(i); excluded = true; }
    }
    if (!excluded) break;
  }
  const result = new Array(N).fill(0);
  if (included.size === 0) {
    const share = amountCents / N;
    const floors = new Array(N).fill(Math.floor(share));
    let leftover = amountCents - floors.reduce((a, b) => a + b, 0);
    for (let i = 0; i < N && leftover > 0; i++) { floors[i] += 1; leftover -= 1; }
    return floors;
  }
  let sum = 0;
  for (const i of included) sum += existingBillsCents[i];
  const target = (sum + amountCents) / included.size;
  const ideals = [];
  for (const i of included) ideals.push({ i, ideal: target - existingBillsCents[i] });
  let placed = 0;
  for (const x of ideals) {
    const f = Math.floor(x.ideal);
    result[x.i] = Math.max(0, f);
    placed += result[x.i];
  }
  let leftover = amountCents - placed;
  ideals.sort((a, b) => (b.ideal - Math.floor(b.ideal)) - (a.ideal - Math.floor(a.ideal)));
  for (const x of ideals) {
    if (leftover <= 0) break;
    result[x.i] += 1;
    leftover -= 1;
  }
  return result;
}

function balancePayWeeks({ bills, periods, incomePerPeriodCents, fixedExpensesPerPeriodCents, targetSurplusCents, todayCoord = 0, lockedAllocations = [] }) {
  const N = periods.length;
  if (N === 0) return { allocations: [], perWeekBillCents: [], feasible: bills.length === 0, unplaced: bills.map((b) => b.id) };
  const daysInMonth = periods[0].daysInMonth;
  const firstStart = periods[0].startDay;
  const lastEnd = periods[N - 1].endDay;
  const occ = (D) => {
    const next = D + daysInMonth;
    if (next >= firstStart && next <= lastEnd) return next;
    if (D >= firstStart && D <= lastEnd) return D;
    if (D < firstStart && next > lastEnd) return next; // orphan fallback
    return null;
  };
  const lockedWeeks = new Set();
  for (let i = 0; i < N; i++) {
    if (todayCoord > 0 && periods[i].endDay <= todayCoord) lockedWeeks.add(i);
  }
  const budget = periods.map((_, i) => (incomePerPeriodCents[i] ?? 0) - (fixedExpensesPerPeriodCents[i] ?? 0) - targetSurplusCents);
  const perWeek = new Array(N).fill(0);
  for (const la of lockedAllocations) {
    if (la.weekIndex >= 0 && la.weekIndex < N) perWeek[la.weekIndex] += la.amountCents;
  }
  const lockedCentsPerBill = new Map();
  for (const la of lockedAllocations) {
    lockedCentsPerBill.set(la.billId, (lockedCentsPerBill.get(la.billId) ?? 0) + la.amountCents);
  }
  const unplaced = [];
  const eligibleWeeks = (coord) => {
    const out = [];
    for (let i = 0; i < N; i++) if (!lockedWeeks.has(i) && periods[i].startDay <= coord) out.push(i);
    return out;
  };
  const naturalWeekIdx = (coord) => {
    for (let i = 0; i < N; i++) {
      if (!lockedWeeks.has(i) && coord >= periods[i].startDay && coord <= periods[i].endDay) return i;
    }
    let last = -1;
    for (let i = 0; i < N; i++) {
      if (!lockedWeeks.has(i) && periods[i].startDay <= coord) last = i;
    }
    if (last >= 0) return last;
    for (let i = N - 1; i >= 0; i--) { if (!lockedWeeks.has(i)) return i; }
    return N - 1;
  };
  const withMeta = [];
  for (const b of bills) {
    const coord = occ(b.dueDate);
    if (coord == null) { unplaced.push(b.id); continue; }
    const lockedCents = lockedCentsPerBill.get(b.id) ?? 0;
    const remainingCents = Math.round(b.amount * 100) - lockedCents;
    const eligible = eligibleWeeks(coord);
    if (remainingCents <= 0 || eligible.length === 0) continue;
    withMeta.push({ bill: b, coord, eligible, naturalIdx: naturalWeekIdx(coord), amountCents: remainingCents });
  }
  const placement = new Map();
  for (const w of withMeta) {
    placement.set(w.bill.id, [{ weekIndex: w.naturalIdx, cents: w.amountCents }]);
    perWeek[w.naturalIdx] += w.amountCents;
  }
  const shortfallOf = (i) => Math.max(0, -(budget[i] - perWeek[i]));
  const maxShortfall = () => { let m = 0; for (let i = 0; i < N; i++) m = Math.max(m, shortfallOf(i)); return m; };
  const splitAttempted = new Set();
  let lastMax = maxShortfall();
  while (lastMax > 0) {
    let worstWeek = -1, worstShort = 0;
    for (let i = 0; i < N; i++) {
      const s = shortfallOf(i);
      if (s > worstShort) { worstShort = s; worstWeek = i; }
    }
    if (worstWeek < 0) break;
    const meta = new Map(withMeta.map((w) => [w.bill.id, w]));
    const candidates = Array.from(placement.entries())
      .filter(([id, allocs]) => allocs.some((a) => a.weekIndex === worstWeek) && !splitAttempted.has(id))
      .map(([id, allocs]) => ({ id, allocs, w: meta.get(id) }))
      .filter((x) => x.w && !x.w.bill.neverSplit && x.w.eligible.length >= 2 && x.w.amountCents >= MIN_SPLIT_CENTS)
      .sort((a, b) => b.w.amountCents - a.w.amountCents);
    if (candidates.length === 0) break;
    const pick = candidates[0];
    splitAttempted.add(pick.id);
    const existing = pick.w.eligible.map((i) => {
      let e = perWeek[i];
      for (const a of pick.allocs) if (a.weekIndex === i) e -= a.cents;
      return e;
    });
    const budgetE = pick.w.eligible.map((i) => budget[i]);
    const over = existing.map((e, k) => e - budgetE[k]);
    const alloc = distributeBillLevel(pick.w.amountCents, over);
    for (const a of pick.allocs) perWeek[a.weekIndex] -= a.cents;
    const newAllocs = [];
    for (let k = 0; k < pick.w.eligible.length; k++) {
      const wIdx = pick.w.eligible[k];
      const cents = alloc[k];
      if (cents > 0) { newAllocs.push({ weekIndex: wIdx, cents }); perWeek[wIdx] += cents; }
    }
    if (newAllocs.length === 0) {
      for (const a of pick.allocs) perWeek[a.weekIndex] += a.cents;
      break;
    }
    placement.set(pick.id, newAllocs);
    const newMax = maxShortfall();
    if (newMax >= lastMax) {
      for (const a of newAllocs) perWeek[a.weekIndex] -= a.cents;
      for (const a of pick.allocs) perWeek[a.weekIndex] += a.cents;
      placement.set(pick.id, pick.allocs);
      break;
    }
    lastMax = newMax;
  }
  const allocations = [];
  for (const [id, allocs] of placement.entries()) {
    for (const a of allocs) allocations.push({ billId: id, weekIndex: a.weekIndex, amountCents: a.cents });
  }
  return { allocations, perWeekBillCents: perWeek, feasible: maxShortfall() === 0, unplaced };
}

async function balanceMonth(year, month, { force = false } = {}) {
  const [bills, personals, incomes, settings, existingSplits] = await Promise.all([
    prisma.bill.findMany(),
    prisma.personal.findMany(),
    prisma.income.findMany(),
    prisma.appSettings.findUnique({ where: { id: "global" } }),
    prisma.billSplit.findMany({ where: { monthKey: monthKeyOf(year, month) } }),
  ]);

  const primary = incomes.find((i) => i.isPrimary);
  if (!primary) throw new Error("No primary income set");
  const payWeekday = Number(primary.payDay);
  const biWeekly = primary.paymentCycle === "BI_WEEKLY";
  const target = Number(settings?.wifeWeeklyTargetCents ?? 30000);
  const periods = getPayPeriodsForMonth(year, month, payWeekday, biWeekly);
  if (periods.length === 0) throw new Error(`No pay periods in ${monthKeyOf(year, month)}`);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const collectPaydays = (payDay, isBW, offset) => {
    const all = [];
    for (let d = 1; d <= daysInMonth; d++) {
      if (new Date(year, month, d).getDay() === payDay) all.push(d);
    }
    return isBW ? all.filter((_, i) => i % 2 === offset) : all;
  };

  const incomePerPeriodCents = periods.map((p) => {
    let total = 0;
    incomes.forEach((income) => {
      const pd = Number(income.payDay ?? payWeekday);
      const bw = (income.paymentCycle ?? primary.paymentCycle) === "BI_WEEKLY";
      const off = Number(income.payWeekOffset ?? 0);
      if (collectPaydays(pd, bw, off).some((d) => d >= p.startDay && d <= p.endDay)) {
        total += Math.round((Number(income.amount) || 0) * 100);
      }
    });
    return total;
  });

  const personalPerPeriodCents = periods.map((p) => {
    let total = 0;
    personals.forEach((pb) => {
      let fires = false;
      if (pb.repeatWeekly) fires = true;
      else if (pb.weekOfMonth != null) fires = `P${pb.weekOfMonth}` === p.key;
      else {
        const D = Number(pb.dueDate);
        const nextCoord = D + p.daysInMonth;
        fires = (D >= p.startDay && D <= p.endDay) || (nextCoord >= p.startDay && nextCoord <= p.endDay);
      }
      if (fires) total += Math.round((Number(pb.amount) || 0) * 100);
    });
    return total;
  });

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  // `--force` bypasses locking so you can fully rewrite a month.
  const todayCoord = (!force && isCurrentMonth) ? today.getDate() : 0;
  const lockedWeekIndices = new Set(
    periods.filter((p) => todayCoord > 0 && p.endDay <= todayCoord).map((p) => p.index),
  );

  // Natural week for each bill (ignoring locking) — used to distinguish
  // correct locked rows from Phase 2 artifacts that should be cleaned up.
  const naturalWeekForBill = (dueDate) => {
    const daysInMonth = periods[0].daysInMonth;
    const firstStart = periods[0].startDay;
    const lastEnd = periods[periods.length - 1].endDay;
    const nextCoord = dueDate + daysInMonth;
    let coord = null;
    if (nextCoord >= firstStart && nextCoord <= lastEnd) coord = nextCoord;
    else if (dueDate >= firstStart && dueDate <= lastEnd) coord = dueDate;
    else if (dueDate < firstStart && nextCoord > lastEnd) coord = nextCoord;
    if (coord == null) return periods.length - 1;
    for (let i = 0; i < periods.length; i++) {
      if (coord >= periods[i].startDay && coord <= periods[i].endDay) return i;
    }
    return periods.length - 1;
  };
  const billsByIdMap = Object.fromEntries(bills.map((b) => [b.id, b]));
  const isNaturalRow = (billId, weekIndex) => {
    const bill = billsByIdMap[billId];
    if (!bill) return false;
    return naturalWeekForBill(Number(bill.dueDate)) === weekIndex;
  };

  // Only lock rows where the bill naturally belongs in that locked week.
  const lockedAllocations = existingSplits
    .filter((s) => lockedWeekIndices.has(s.weekIndex) && isNaturalRow(s.billId, s.weekIndex))
    .map((s) => ({ billId: s.billId, weekIndex: s.weekIndex, amountCents: s.amountCents }));

  const result = balancePayWeeks({
    bills: bills.map((b) => ({ id: b.id, amount: Number(b.amount), dueDate: Number(b.dueDate), neverSplit: Boolean(b.neverSplit) })),
    periods,
    incomePerPeriodCents,
    fixedExpensesPerPeriodCents: personalPerPeriodCents,
    targetSurplusCents: target,
    todayCoord,
    lockedAllocations,
  });

  // Delete non-locked rows AND non-natural artifacts in locked weeks.
  const toDelete = existingSplits.filter(
    (s) => !lockedWeekIndices.has(s.weekIndex) || !isNaturalRow(s.billId, s.weekIndex),
  );
  await prisma.$transaction([
    ...toDelete.map((s) => prisma.billSplit.delete({ where: { id: s.id } })),
    ...result.allocations.map((a) =>
      prisma.billSplit.create({
        data: { billId: a.billId, monthKey: monthKeyOf(year, month), weekIndex: a.weekIndex, amountCents: a.amountCents },
      }),
    ),
  ]);

  const billsById = Object.fromEntries(bills.map((b) => [b.id, b]));
  const fmt = (c) => `$${(c / 100).toFixed(2)}`;
  console.log(`\n═══ ${monthKeyOf(year, month)} — target ${fmt(target)}/wk ═══`);
  periods.forEach((p, i) => {
    const surplus = incomePerPeriodCents[i] - personalPerPeriodCents[i] - result.perWeekBillCents[i];
    console.log(`  P${i + 1} (day ${p.startDay}–${p.endDay}): bills ${fmt(result.perWeekBillCents[i])}  →  surplus ${fmt(surplus)}`);
  });
  console.log(`  Wrote ${result.allocations.length} split rows; wiped ${existingSplits.length} existing; feasible: ${result.feasible}`);
  if (result.unplaced.length) {
    console.log(`  Unplaced: ${result.unplaced.map((id) => billsById[id]?.name || id).join(", ")}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const monthArgs = args.filter((a) => a !== "--force");
  const months = monthArgs.length > 0 ? monthArgs : [`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`];
  for (const mk of months) {
    const [y, m] = mk.split("-").map(Number);
    await balanceMonth(y, m - 1, { force });
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
