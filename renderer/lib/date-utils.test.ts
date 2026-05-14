import { describe, it, expect } from "vitest";
import { formatDate, parseISOAsLocal } from "./date-utils";

describe("formatDate", () => {
  it("formats default", () => {
    expect(formatDate("2026-05-15T00:00:00Z")).toBe("May 15, 2026");
  });

  it("respects custom format", () => {
    expect(formatDate("2026-05-15T00:00:00Z", "yyyy-MM-dd")).toBe(
      "2026-05-15",
    );
  });

  it("returns empty for null/undefined", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
    expect(formatDate("")).toBe("");
  });

  it("handles invalid date", () => {
    expect(formatDate("not a date")).toBe("Invalid Date");
  });

  it("treats UTC components as local — January 31 stays January 31", () => {
    // The original bug being fixed: timezone-shifted dates rendering as the
    // wrong day. UTC 2026-01-31 should display as Jan 31, not Jan 30 in PST.
    expect(formatDate("2026-01-31T00:00:00Z")).toBe("Jan 31, 2026");
  });
});

describe("parseISOAsLocal", () => {
  it("parses YYYY-MM-DD strings into local-day Date", () => {
    const d = parseISOAsLocal("2026-05-15");
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(4); // 0-indexed May
    expect(d?.getDate()).toBe(15);
  });

  it("preserves UTC day when parsing full ISO", () => {
    const d = parseISOAsLocal("2026-05-15T00:00:00Z");
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(4);
    expect(d?.getDate()).toBe(15);
  });

  it("returns null for null/empty", () => {
    expect(parseISOAsLocal(null)).toBeNull();
    expect(parseISOAsLocal(undefined)).toBeNull();
    expect(parseISOAsLocal("")).toBeNull();
  });

  it("returns null for invalid", () => {
    expect(parseISOAsLocal("not a date")).toBeNull();
  });
});
