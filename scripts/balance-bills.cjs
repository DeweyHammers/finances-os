"use strict";

// One-off: run the auto-balance algorithm against dev.db for the current month.
// Mirrors renderer/lib/pay-period-utils.balanceBillsGreedy so we don't need to
// bundle renderer code for node. Delete-then-insert overrides per (billId, monthKey).

const path = require("path");
const { PrismaClient } = require("@prisma/client");
process.env.DATABASE_URL = `file:${path.resolve(__dirname, "../prisma/dev.db").replace(/\\/g, "/")}`;

const prisma = new PrismaClient();

const monthKeyOf = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;

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
    key: `P${i + 1}`,
    index: i,
    startDay,
    endDay: ends[i],
    daysInMonth,
  }));
}

function balanceBillsGreedy({ bills, periods, incomePerPeriodCents, fixedExpensesPerPeriodCents, targetSurplusCents }) {
  const N = periods.length;
  if (N === 0) return { assignments: [], perWeekBillCents: [], feasible: bills.length === 0, unplaced: bills.map((b) => b.id) };
  const daysInMonth = periods[0].daysInMonth;
  const firstStart = periods[0].startDay;
  const lastEnd = periods[N - 1].endDay;
  const occ = (D) => {
    const next = D + daysInMonth;
    if (next >= firstStart && next <= lastEnd) return next;
    if (D >= firstStart && D <= lastEnd) return D;
    return null;
  };
  const budget = periods.map((_, i) => (incomePerPeriodCents[i] ?? 0) - (fixedExpensesPerPeriodCents[i] ?? 0) - targetSurplusCents);
  const perWeek = new Array(N).fill(0);
  const unplaced = [];
  const eligibleCount = (coord) => {
    let n = 0;
    for (let i = 0; i < N; i++) if (periods[i].startDay <= coord) n++;
    return n;
  };
  const withCoord = bills
    .map((b) => ({ bill: b, coord: occ(b.dueDate) }))
    .filter((x) => {
      if (x.coord == null) { unplaced.push(x.bill.id); return false; }
      return true;
    })
    .sort((a, b) => {
      const ea = eligibleCount(a.coord);
      const eb = eligibleCount(b.coord);
      if (ea !== eb) return ea - eb;
      return b.bill.amount - a.bill.amount;
    });
  const assignments = [];
  let feasible = true;
  for (const { bill, coord } of withCoord) {
    const amt = Math.round(bill.amount * 100);
    let bestIdx = -1, bestRoom = -Infinity;
    for (let i = 0; i < N; i++) {
      if (periods[i].startDay > coord) continue;
      const room = budget[i] - perWeek[i];
      if (room > bestRoom) { bestRoom = room; bestIdx = i; }
    }
    if (bestIdx < 0) { unplaced.push(bill.id); feasible = false; continue; }
    if (bestRoom < amt) feasible = false;
    assignments.push({ billId: bill.id, weekIndex: bestIdx });
    perWeek[bestIdx] += amt;
  }
  return { assignments, perWeekBillCents: perWeek, feasible, unplaced };
}

async function balanceMonth(year, month) {
  const [bills, personals, incomes, settings, existingOverrides] = await Promise.all([
    prisma.bill.findMany(),
    prisma.personal.findMany(),
    prisma.income.findMany(),
    prisma.appSettings.findUnique({ where: { id: "global" } }),
    prisma.billPayWeekOverride.findMany({ where: { monthKey: monthKeyOf(year, month) } }),
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

  const result = balanceBillsGreedy({
    bills: bills.map((b) => ({ id: b.id, amount: Number(b.amount), dueDate: Number(b.dueDate) })),
    periods,
    incomePerPeriodCents,
    fixedExpensesPerPeriodCents: personalPerPeriodCents,
    targetSurplusCents: target,
  });

  await prisma.$transaction([
    prisma.billPayWeekOverride.deleteMany({ where: { monthKey: monthKeyOf(year, month) } }),
    ...result.assignments.map((a) =>
      prisma.billPayWeekOverride.create({
        data: { billId: a.billId, monthKey: monthKeyOf(year, month), weekIndex: a.weekIndex },
      }),
    ),
  ]);

  const billsById = Object.fromEntries(bills.map((b) => [b.id, b]));
  const fmt = (c) => `$${(c / 100).toFixed(2)}`;
  console.log(`\n═══ ${monthKeyOf(year, month)} — target ${fmt(target)}/wk ═══`);
  periods.forEach((p, i) => {
    const surplus = incomePerPeriodCents[i] - personalPerPeriodCents[i] - result.perWeekBillCents[i];
    console.log(
      `  P${i + 1} (day ${p.startDay}–${p.endDay}): income ${fmt(incomePerPeriodCents[i])}, personal ${fmt(personalPerPeriodCents[i])}, bills ${fmt(result.perWeekBillCents[i])}  →  surplus ${fmt(surplus)}`,
    );
  });
  console.log(`  Placed ${result.assignments.length} bills; existing overrides wiped: ${existingOverrides.length}; feasible: ${result.feasible}`);
  if (result.unplaced.length) {
    console.log(`  Unplaced bills (occurrence outside month view): ${result.unplaced.map((id) => billsById[id]?.name || id).join(", ")}`);
  }
  console.log("  Assignments:");
  result.assignments
    .slice()
    .sort((a, b) => a.weekIndex - b.weekIndex)
    .forEach((a) => {
      const b = billsById[a.billId];
      console.log(`    P${a.weekIndex + 1}  ${b?.name || a.billId}  ${fmt(Math.round(Number(b?.amount || 0) * 100))}  (due day ${b?.dueDate})`);
    });
}

async function main() {
  const args = process.argv.slice(2);
  const months = args.length > 0 ? args : [`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`];
  for (const mk of months) {
    const [y, m] = mk.split("-").map(Number);
    await balanceMonth(y, m - 1);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
