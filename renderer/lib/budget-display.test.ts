import { describe, it, expect } from "vitest";
import { resolveItemDisplay } from "./budget-display";

const bills = [
  { id: "b1", name: "Electric", amount: 150, dueDate: 5, withdrawalCycle: "Q1" },
  { id: "b2", name: "Water", amount: 42.5, dueDate: 22, withdrawalCycle: "Q3" },
];

const personals = [
  { name: "Gas", amount: 50, withdrawalCycle: "Q1" },
  { name: "Coffee", amount: 12.34, withdrawalCycle: "Q2" },
];

describe("resolveItemDisplay — BILL", () => {
  it("uses live bill name & amount when the bill is renamed", () => {
    // BudgetCategoryItem.name is the *snapshot* taken when the item was created.
    // After the Bill is renamed, the live source overrides the snapshot.
    const renamedBills = [{ ...bills[0], name: "Electric (PG&E)" }];
    const d = resolveItemDisplay(
      { name: "Electric", sourceType: "BILL", sourceBillId: "b1" },
      renamedBills,
      personals,
    );
    expect(d.liveName).toBe("Electric (PG&E)");
    expect(d.displayName).toContain("Electric (PG&E)");
    expect(d.displayName).toContain("$150.00");
    expect(d.cycles).toEqual(["Q1"]);
  });

  it("uses live bill amount when the amount changes", () => {
    const updated = [{ ...bills[0], amount: 200.5 }];
    const d = resolveItemDisplay(
      { name: "Electric", sourceType: "BILL", sourceBillId: "b1" },
      updated,
      personals,
    );
    expect(d.displayName).toContain("$200.50");
  });

  it("formats due day with ordinal suffix", () => {
    const d = resolveItemDisplay(
      { name: "Water", sourceType: "BILL", sourceBillId: "b2" },
      bills,
      personals,
    );
    expect(d.displayName).toContain("22nd");
  });

  it("falls back to the stored item name when the bill is gone", () => {
    const d = resolveItemDisplay(
      { name: "Old name", sourceType: "BILL", sourceBillId: "missing" },
      bills,
      personals,
    );
    expect(d.liveName).toBe("Old name");
    expect(d.displayName).toBe("Old name");
    expect(d.cycles).toEqual([]);
  });
});

describe("resolveItemDisplay — PERSONAL_NAME", () => {
  it("uses the live personal entry when matched by name", () => {
    const d = resolveItemDisplay(
      {
        name: "Old Personal",
        sourceType: "PERSONAL_NAME",
        sourcePersonalName: "Gas",
      },
      bills,
      personals,
    );
    expect(d.liveName).toBe("Gas");
    expect(d.displayName).toContain("$50.00");
  });

  it("never emits a cycle chip — Personal items are aggregates across cycles", () => {
    const d = resolveItemDisplay(
      {
        name: "Old Personal",
        sourceType: "PERSONAL_NAME",
        sourcePersonalName: "Gas",
      },
      bills,
      personals,
    );
    expect(d.cycles).toEqual([]);
  });

  it("falls back to the sourcePersonalName when no Personal record matches", () => {
    const d = resolveItemDisplay(
      {
        name: "Stored",
        sourceType: "PERSONAL_NAME",
        sourcePersonalName: "Vanished",
      },
      bills,
      personals,
    );
    expect(d.liveName).toBe("Vanished");
    expect(d.displayName).toBe("Vanished");
    expect(d.cycles).toEqual([]);
  });

  it("uses the stored item name when no sourcePersonalName is set", () => {
    const d = resolveItemDisplay(
      { name: "Stored", sourceType: "PERSONAL_NAME" },
      bills,
      personals,
    );
    expect(d.liveName).toBe("Stored");
    expect(d.displayName).toBe("Stored");
  });
});

describe("resolveItemDisplay — CUSTOM", () => {
  it("returns the stored name and custom cycle", () => {
    const d = resolveItemDisplay(
      {
        name: "Vacation Fund",
        sourceType: "CUSTOM",
        customCycle: "Q2",
      },
      bills,
      personals,
    );
    expect(d.liveName).toBe("Vacation Fund");
    expect(d.displayName).toBe("Vacation Fund");
    expect(d.cycles).toEqual(["Q2"]);
  });

  it("returns empty cycles when customCycle is null", () => {
    const d = resolveItemDisplay(
      { name: "Generic Pot", sourceType: "CUSTOM", customCycle: null },
      bills,
      personals,
    );
    expect(d.cycles).toEqual([]);
  });
});
