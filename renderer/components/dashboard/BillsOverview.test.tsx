/**
 * BillsOverview — render tests with generic sample data (the repo is public).
 *
 * Pre-saving (CLAUDE.md → "Pre-saving") means one bill can legitimately show
 * TWO cards in the same pay week: its own firing plus a slice saved ahead for
 * next month's first-week firing. Those are different occurrence coords and
 * must render as two cards with distinct React keys (the Oct 2026 duplicate-
 * key console error).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { BillsOverview } from "./BillsOverview";

// Wednesday paydays. Nov 2026: P1 Nov 4-10, P2 11-17, P3 18-24, P4 25 – Dec 1.
// Dec's first payday is Dec 2, so a bill due the 4th fires in Dec P1 too —
// its Nov pre-save coord is 4 + 30 = 34.
const settings = { payDay: 3, paymentCycle: "WEEKLY", wifeWeeklyTargetCents: 25000 };
const bill = { id: "bill4", name: "Sample Bill", amount: 130, dueDate: 4, withdrawalCycle: "Q1" };

describe("BillsOverview — pre-save cards", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders a bill's own firing and its pre-save slice in the same week with distinct keys", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const splits = [
      // Oct saved $55.31 ahead for the Nov 4 firing (coord 35 in Oct's space).
      { billId: "bill4", monthKey: "2026-10", weekIndex: 3, amountCents: 5531, occurrenceCoord: 35 },
      // Nov P1 holds the remainder of the Nov 4 firing …
      { billId: "bill4", monthKey: "2026-11", weekIndex: 0, amountCents: 7469, occurrenceCoord: 4 },
      // … and ALSO a slice saved ahead for the Dec 4 firing, in the same week.
      { billId: "bill4", monthKey: "2026-11", weekIndex: 0, amountCents: 4000, occurrenceCoord: 34 },
      { billId: "bill4", monthKey: "2026-11", weekIndex: 1, amountCents: 9000, occurrenceCoord: 34 },
    ];
    render(<BillsOverview bills={[bill]} settings={settings} viewYear={2026} viewMonth={10} splits={splits} />);

    // Two cards for the bill in Pay Week 1, one per occurrence.
    expect(screen.getAllByText("Sample Bill")).toHaveLength(3); // P1 ×2 + P2 ×1
    expect(screen.getByText(/Split · 4th/)).toBeInTheDocument();
    expect(screen.getAllByText(/Split · Dec 4th/)).toHaveLength(2);
    // "Saved $130.00" twice: the Nov 4 card (its remainder + what October put
    // aside) and the second Dec 4 slice in P2 ($40 + $90).
    expect(screen.getAllByText("Saved $130.00")).toHaveLength(2);

    // No React duplicate-key warning.
    const keyWarnings = errors.mock.calls.filter((c) => String(c[0]).includes("same key"));
    expect(keyWarnings).toEqual([]);
  });
});
