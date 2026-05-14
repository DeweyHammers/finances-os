import { describe, it, expect } from "vitest";

// transformBody is the only pure function we need to test here. The rest of
// api-server.ts opens Prisma + a real DB which we don't want to spin up just
// for unit tests. Importing the file exercises the top-level express setup but
// transformBody is pure once imported.
import { transformBody } from "./api-server";

describe("transformBody", () => {
  it("coerces amount/dueDate to numbers", () => {
    const out = transformBody({ amount: "26.99", dueDate: "28" });
    expect(out.amount).toBe(26.99);
    expect(out.dueDate).toBe(28);
  });

  it("coerces budget cents fields", () => {
    const out = transformBody({
      inflowCents: "5000",
      outflowCents: "0",
      customAmountCents: "12000",
      assignedCents: "100",
      sortOrder: "3",
    });
    expect(out.inflowCents).toBe(5000);
    expect(out.outflowCents).toBe(0);
    expect(out.customAmountCents).toBe(12000);
    expect(out.assignedCents).toBe(100);
    expect(out.sortOrder).toBe(3);
  });

  it("parses YYYY-MM-DD strings as UTC dates", () => {
    const out = transformBody({ date: "2026-05-15" });
    expect(out.date).toBeInstanceOf(Date);
    expect((out.date as Date).toISOString()).toBe("2026-05-15T00:00:00.000Z");
  });

  it("parses datetime-local strings", () => {
    const out = transformBody({ date: "2026-05-15T08:30" });
    expect(out.date).toBeInstanceOf(Date);
    expect((out.date as Date).toISOString()).toBe("2026-05-15T08:30:00.000Z");
  });

  it("parses full ISO strings", () => {
    const out = transformBody({ date: "2026-05-15T08:30:00.000Z" });
    expect(out.date).toBeInstanceOf(Date);
  });

  it("preserves non-numeric ID strings", () => {
    const out = transformBody({ id: "cuid_abc123" });
    expect(out.id).toBe("cuid_abc123");
  });

  it("does not coerce arbitrary numeric strings as numbers", () => {
    // payeeId is an opaque string id even if it happens to look numeric — we
    // only coerce known-numeric keys
    const out = transformBody({ payeeId: "12345" });
    expect(out.payeeId).toBe("12345");
  });

  it("trims string values", () => {
    const out = transformBody({ name: "  Hello  " });
    expect(out.name).toBe("Hello");
  });

  it("preserves non-string values", () => {
    const out = transformBody({ closed: false, sortOrder: 0, nested: null });
    expect(out.closed).toBe(false);
    expect(out.sortOrder).toBe(0);
    expect(out.nested).toBe(null);
  });
});
