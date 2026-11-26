/**
 * EditItemModal — the pencil on a Plan envelope.
 *
 * An item that comes from a Bill or from Personal entries is synced with its
 * source, so its name cannot be changed here (user decision, Nov 25 2026):
 * the field is locked, nothing is saved, and the only action opens the page
 * where the name is managed. A custom item is renamed as before.
 * Generic sample data only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const pushMock = vi.fn();
const updateMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/Plan",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@refinedev/core", () => ({
  useUpdate: () => ({ mutate: updateMock }),
}));

import { EditItemModal } from "./EditItemModal";

const item = (over: Record<string, unknown>) => ({
  id: "i1",
  groupId: "g1",
  name: "Storage unit",
  sortOrder: 0,
  sourceType: "BILL",
  sourceBillId: "b1",
  assignedCents: 0,
  activityCents: 0,
  availableCents: 0,
  ...over,
});

describe("EditItemModal", () => {
  beforeEach(() => {
    pushMock.mockReset();
    updateMock.mockReset();
  });

  it("an item from a Bill shows its name locked, with no Save", () => {
    render(<EditItemModal open item={item({})} onClose={vi.fn()} />);
    const field = screen.getByLabelText("Name") as HTMLInputElement;
    expect(field.value).toBe("Storage unit");
    expect(field).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    // The banner says where the name is managed; there is no second line under the field.
    expect(screen.getByText(/managed on the Bills page and stay in sync here/)).toBeInTheDocument();
    expect(document.querySelector(".MuiFormHelperText-root")).toBeNull();
  });

  it("its only action opens the Bills page — nothing is written", () => {
    const onClose = vi.fn();
    render(<EditItemModal open item={item({})} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Bills" }));
    expect(pushMock).toHaveBeenCalledWith("/Bill");
    expect(onClose).toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("an item from Personal entries is locked the same way and points at the Personal page", () => {
    render(
      <EditItemModal
        open
        item={item({ name: "Groceries", sourceType: "PERSONAL_NAME", sourceBillId: null, sourcePersonalName: "Groceries" })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Personal" }));
    expect(pushMock).toHaveBeenCalledWith("/Personal");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("a custom item is still renamed here", () => {
    render(
      <EditItemModal
        open
        item={item({ name: "Rainy day", sourceType: "CUSTOM", sourceBillId: null, customAmountCents: 2500 })}
        onClose={vi.fn()}
      />,
    );
    const field = screen.getByLabelText("Display Name") as HTMLInputElement;
    expect(field).not.toBeDisabled();
    fireEvent.change(field, { target: { value: "  Emergency fund " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][0]).toMatchObject({
      resource: "BudgetCategoryItem",
      id: "i1",
      values: { name: "Emergency fund" },
    });
    expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
  });
});
