import { describe, it, expect } from "vitest";
import { toCents, fromCents, formatMoney } from "./cents";

describe("toCents", () => {
  it("converts dollars number to cents", () => {
    expect(toCents(1)).toBe(100);
    expect(toCents(26.99)).toBe(2699);
    expect(toCents(0)).toBe(0);
    expect(toCents(-50)).toBe(-5000);
  });

  it("converts dollar strings to cents", () => {
    expect(toCents("1.50")).toBe(150);
    expect(toCents("1,234.56")).toBe(123456);
    expect(toCents("-19.99")).toBe(-1999);
  });

  it("handles edge inputs", () => {
    expect(toCents("")).toBe(0);
    expect(toCents("-")).toBe(0);
    expect(toCents("not a number")).toBe(0);
    expect(toCents(NaN)).toBe(0);
    expect(toCents(Infinity)).toBe(0);
  });

  it("rounds correctly to avoid float drift", () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(2.005)).toBe(201);
  });
});

describe("fromCents", () => {
  it("converts cents to dollars", () => {
    expect(fromCents(100)).toBe(1);
    expect(fromCents(2699)).toBe(26.99);
    expect(fromCents(0)).toBe(0);
    expect(fromCents(-5000)).toBe(-50);
  });

  it("handles non-finite", () => {
    expect(fromCents(NaN)).toBe(0);
    expect(fromCents(Infinity)).toBe(0);
  });
});

describe("formatMoney", () => {
  it("formats positive cents as dollars", () => {
    expect(formatMoney(2699)).toBe("$26.99");
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(100)).toBe("$1.00");
  });

  it("formats negative cents", () => {
    expect(formatMoney(-2699)).toBe("-$26.99");
  });

  it("includes thousands separator", () => {
    expect(formatMoney(123456)).toBe("$1,234.56");
    expect(formatMoney(900000000)).toBe("$9,000,000.00");
  });

  it("pads single-digit cents", () => {
    expect(formatMoney(105)).toBe("$1.05");
    expect(formatMoney(101)).toBe("$1.01");
  });

  it("optionally shows + sign for positive amounts", () => {
    expect(formatMoney(2699, { withSign: true })).toBe("+$26.99");
    expect(formatMoney(0, { withSign: true })).toBe("$0.00");
    expect(formatMoney(-2699, { withSign: true })).toBe("-$26.99");
  });

  it("handles non-finite", () => {
    expect(formatMoney(NaN)).toBe("$0.00");
  });
});

describe("toCents <-> fromCents round-trip", () => {
  it("preserves common values", () => {
    [0, 0.01, 0.1, 1, 26.99, 1234.56, -19.99].forEach((v) => {
      expect(fromCents(toCents(v))).toBe(v);
    });
  });
});
