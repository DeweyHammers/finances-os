import { describe, it, expect } from "vitest";
import { getCycleColor, getCyclesForPaymentCycle } from "./cycle-utils";

describe("getCyclesForPaymentCycle", () => {
  it("returns Q1-Q4 regardless of input (current weekly model)", () => {
    expect(getCyclesForPaymentCycle()).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(getCyclesForPaymentCycle("WEEKLY")).toEqual(["Q1", "Q2", "Q3", "Q4"]);
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
