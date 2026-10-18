import { describe, it, expect } from "vitest";

// transformBody is the only pure function we need to test here. The rest of
// api-server.ts opens Prisma + a real DB which we don't want to spin up just
// for unit tests. Importing the file exercises the top-level express setup but
// transformBody is pure once imported.
import { transformBody, isAllowedOrigin, isAllowedHost } from "./api-server";

describe("transformBody", () => {
  it("coerces amount/dueDate to numbers", () => {
    const out = transformBody({ amount: "24.95", dueDate: "15" });
    expect(out.amount).toBe(24.95);
    expect(out.dueDate).toBe(15);
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

  it("coerces payDay and payWeekOffset to numbers", () => {
    const out = transformBody({ payDay: "3", payWeekOffset: "1" });
    expect(out.payDay).toBe(3);
    expect(out.payWeekOffset).toBe(1);
  });
});

// Network-exposure guards — the API has no auth, so only the app's own
// renderer may reach it (see "Network exposure" in api-server.ts).
describe("isAllowedOrigin", () => {
  it("allows the PROD app:// renderer in both modes", () => {
    expect(isAllowedOrigin("app://.", true)).toBe(true);
    expect(isAllowedOrigin("app://.", false)).toBe(true);
  });

  it("allows the dev renderer only outside production", () => {
    expect(isAllowedOrigin("http://localhost:8888", false)).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:8888", false)).toBe(true);
    expect(isAllowedOrigin("http://localhost:8888", true)).toBe(false);
  });

  it("rejects arbitrary websites and look-alikes", () => {
    expect(isAllowedOrigin("https://evil.example", false)).toBe(false);
    expect(isAllowedOrigin("http://localhost.evil.example:8888", false)).toBe(false);
    expect(isAllowedOrigin("null", false)).toBe(false);
  });
});

describe("isAllowedHost", () => {
  it("accepts the loopback listener addresses", () => {
    expect(isAllowedHost("127.0.0.1:5858")).toBe(true);
    expect(isAllowedHost("localhost:5858")).toBe(true);
  });

  it("rejects rebinding hosts, LAN addresses and missing hosts", () => {
    expect(isAllowedHost("evil.example:5858")).toBe(false);
    expect(isAllowedHost("192.168.1.20:5858")).toBe(false);
    expect(isAllowedHost(undefined)).toBe(false);
  });
});
