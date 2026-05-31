import { describe, it, expect } from "vitest";
import {
  getCycleColor,
  getCyclesForPaymentCycle,
  getCycleOptionsForPaymentCycle,
  normalizePaymentCycle,
  cyclesRemovedByChange,
} from "./cycle-utils";

describe("normalizePaymentCycle", () => {
  it("keeps known values", () => {
    expect(normalizePaymentCycle("WEEKLY")).toBe("WEEKLY");
    expect(normalizePaymentCycle("BI_WEEKLY")).toBe("BI_WEEKLY");
    expect(normalizePaymentCycle("MONTHLY")).toBe("MONTHLY");
  });

  it("defaults to WEEKLY for unknown/missing", () => {
    expect(normalizePaymentCycle(undefined)).toBe("WEEKLY");
    expect(normalizePaymentCycle(null)).toBe("WEEKLY");
    expect(normalizePaymentCycle("")).toBe("WEEKLY");
    expect(normalizePaymentCycle("WHAT")).toBe("WEEKLY");
  });
});

describe("getCyclesForPaymentCycle", () => {
  it("WEEKLY returns Q1-Q4", () => {
    expect(getCyclesForPaymentCycle("WEEKLY")).toEqual(["Q1", "Q2", "Q3", "Q4"]);
  });

  it("BI_WEEKLY returns Q1, Q2 only", () => {
    expect(getCyclesForPaymentCycle("BI_WEEKLY")).toEqual(["Q1", "Q2"]);
  });

  it("MONTHLY returns Q1 only", () => {
    expect(getCyclesForPaymentCycle("MONTHLY")).toEqual(["Q1"]);
  });

  it("defaults to WEEKLY (Q1-Q4) for unknown/missing", () => {
    expect(getCyclesForPaymentCycle()).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(getCyclesForPaymentCycle(undefined)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(getCyclesForPaymentCycle("WHAT")).toEqual(["Q1", "Q2", "Q3", "Q4"]);
  });
});

describe("getCycleOptionsForPaymentCycle", () => {
  it("WEEKLY labels each Q with a week number", () => {
    const opts = getCycleOptionsForPaymentCycle("WEEKLY");
    expect(opts.map((o) => o.value)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(opts[0].label).toMatch(/Week\s*1/i);
    expect(opts[3].label).toMatch(/Week\s*4/i);
  });

  it("BI_WEEKLY labels reflect two-week chunks", () => {
    const opts = getCycleOptionsForPaymentCycle("BI_WEEKLY");
    expect(opts.map((o) => o.value)).toEqual(["Q1", "Q2"]);
    expect(opts[0].label).toMatch(/Weeks\s*1-2/i);
    expect(opts[1].label).toMatch(/Weeks\s*3-4/i);
  });

  it("MONTHLY returns a single option", () => {
    const opts = getCycleOptionsForPaymentCycle("MONTHLY");
    expect(opts.map((o) => o.value)).toEqual(["Q1"]);
  });
});

describe("cyclesRemovedByChange", () => {
  it("WEEKLY -> BI_WEEKLY drops Q3, Q4", () => {
    expect(cyclesRemovedByChange("WEEKLY", "BI_WEEKLY")).toEqual(["Q3", "Q4"]);
  });

  it("BI_WEEKLY -> WEEKLY drops nothing", () => {
    expect(cyclesRemovedByChange("BI_WEEKLY", "WEEKLY")).toEqual([]);
  });

  it("WEEKLY -> MONTHLY drops Q2, Q3, Q4", () => {
    expect(cyclesRemovedByChange("WEEKLY", "MONTHLY")).toEqual([
      "Q2",
      "Q3",
      "Q4",
    ]);
  });

  it("BI_WEEKLY -> BI_WEEKLY drops nothing", () => {
    expect(cyclesRemovedByChange("BI_WEEKLY", "BI_WEEKLY")).toEqual([]);
  });
});

describe("getCycleColor", () => {
  it("returns distinct colors for each Q", () => {
    const c1 = getCycleColor("Q1");
    const c2 = getCycleColor("Q2");
    const c3 = getCycleColor("Q3");
    const c4 = getCycleColor("Q4");
    const set = new Set([c1, c2, c3, c4]);
    expect(set.size).toBe(4);
  });

  it("Q4 uses the lavender override (not too close to Q3 teal)", () => {
    expect(getCycleColor("Q4")).toBe("#c084fc");
  });

  it("falls back to default for unknown cycles", () => {
    expect(getCycleColor("Q9")).toBeDefined();
  });
});
