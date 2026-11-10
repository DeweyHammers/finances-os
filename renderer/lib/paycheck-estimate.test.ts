/**
 * paycheck-estimate — the "32 hours this week → what will I be paid?" maths
 * behind the Income page's per-week editor. Generic sample data only:
 * a regular 40-hour paycheck of $800 gross − $80 taxes − $20 dues = $700.
 */
import { describe, it, expect } from "vitest";
import { estimatePaycheck, paycheckBasisOf, regularPaycheck } from "./paycheck-estimate";

const BASIS = { amount: 700, baseHours: 40, taxes: 80, flatDeductions: 20 };

describe("regularPaycheck", () => {
  it("gross is never stored: it is take-home + taxes + flat deductions", () => {
    expect(regularPaycheck(BASIS)).toEqual({ gross: 800, taxes: 80, flatDeductions: 20, takeHome: 700 });
  });

  it("with nothing entered, gross is the take-home itself", () => {
    expect(regularPaycheck({ amount: 700, baseHours: 40 })).toEqual({ gross: 700, taxes: 0, flatDeductions: 0, takeHome: 700 });
  });
});

describe("estimatePaycheck", () => {
  it("the regular hours give back exactly the regular paycheck", () => {
    expect(estimatePaycheck(BASIS, 40)).toEqual({ gross: 800, taxes: 80, flatDeductions: 20, takeHome: 700 });
  });

  it("a short week: gross and taxes shrink with the hours, the dues stay", () => {
    // 32 of 40 hours = 80%: $640 gross − $64 taxes − $20 dues.
    expect(estimatePaycheck(BASIS, 32)).toEqual({ gross: 640, taxes: 64, flatDeductions: 20, takeHome: 556 });
    // Less than 80% of the take-home ($560), because the dues did not shrink.
    expect(estimatePaycheck(BASIS, 32)!.takeHome).toBeLessThan(700 * 0.8);
  });

  it("a long week scales up the same way", () => {
    expect(estimatePaycheck(BASIS, 48)).toEqual({ gross: 960, taxes: 96, flatDeductions: 20, takeHome: 844 });
  });

  it("without flat deductions it is plain proportional scaling (taxes or not)", () => {
    expect(estimatePaycheck({ amount: 700, baseHours: 40 }, 32)!.takeHome).toBe(560);
    expect(estimatePaycheck({ amount: 700, baseHours: 40, taxes: 80 }, 32)).toEqual({
      gross: 624,
      taxes: 64,
      flatDeductions: 0,
      takeHome: 560,
    });
  });

  it("the breakdown always adds up to the cent, whatever the rounding", () => {
    const awkward = { amount: 611.37, baseHours: 40, taxes: 71.93, flatDeductions: 19.5 };
    // (Hours so few that the flat deductions exceed the pay are floored at $0 — next test.)
    for (const hours of [7.5, 13, 24, 31.25, 32, 36, 39.75, 40, 44.5, 60]) {
      const e = estimatePaycheck(awkward, hours)!;
      expect(Math.round(e.gross * 100) - Math.round(e.taxes * 100) - Math.round(e.flatDeductions * 100), `${hours} h`).toBe(
        Math.round(e.takeHome * 100),
      );
    }
    expect(estimatePaycheck(awkward, 40)!.takeHome).toBe(611.37);
  });

  it("no hours = no paycheck; a few hours never go below $0", () => {
    expect(estimatePaycheck(BASIS, 0)).toEqual({ gross: 0, taxes: 0, flatDeductions: 0, takeHome: 0 });
    // 1 hour: $20 gross − $2 taxes − $20 dues would be −$2.
    expect(estimatePaycheck(BASIS, 1)).toEqual({ gross: 20, taxes: 2, flatDeductions: 20, takeHome: 0 });
  });

  it("cannot estimate without regular hours, or from junk hours", () => {
    expect(estimatePaycheck({ amount: 700, baseHours: null }, 32)).toBeNull();
    expect(estimatePaycheck({ amount: 700, baseHours: 0 }, 32)).toBeNull();
    expect(estimatePaycheck(BASIS, NaN)).toBeNull();
    expect(estimatePaycheck(BASIS, -4)).toBeNull();
  });
});

describe("paycheckBasisOf — an Income row off the API", () => {
  it("reads the optional fields loosely; unset or junk means none", () => {
    expect(paycheckBasisOf({ amount: "700", baseHours: "40", baseTaxes: "80", baseFlatDeductions: 20 })).toEqual(BASIS);
    expect(paycheckBasisOf({ amount: 700 })).toEqual({ amount: 700, baseHours: null, taxes: 0, flatDeductions: 0 });
    expect(paycheckBasisOf({ amount: 700, baseHours: 0, baseTaxes: -5, baseFlatDeductions: "abc" })).toEqual({
      amount: 700,
      baseHours: null,
      taxes: 0,
      flatDeductions: 0,
    });
  });
});
