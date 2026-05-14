import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PayeeAutocomplete } from "./PayeeAutocomplete";

const useListMock = vi.fn();
const useCreateMock = vi.fn();

vi.mock("@refinedev/core", () => ({
  useList: (...args: any[]) => useListMock(...args),
  useCreate: () => useCreateMock(),
}));

const setListData = (rows: any[]) => {
  useListMock.mockReturnValue({
    query: { data: { data: rows }, isLoading: false },
  });
};

describe("PayeeAutocomplete", () => {
  let createMutate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    useListMock.mockReset();
    useCreateMock.mockReset();
    createMutate = vi.fn();
    useCreateMock.mockReturnValue({ mutate: createMutate });
    setListData([]);
  });

  it("selects an existing payee from the dropdown", async () => {
    setListData([
      { id: "p1", name: "Old Navy" },
      { id: "p2", name: "Steam" },
    ]);

    const onChange = vi.fn();
    render(<PayeeAutocomplete value={null} onChange={onChange} />);

    await userEvent.click(screen.getByLabelText(/payee/i));
    await userEvent.click(await screen.findByText("Steam"));

    expect(onChange).toHaveBeenCalledWith("p2");
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("creates a new payee when typing a name not in the list", async () => {
    setListData([{ id: "p1", name: "Steam" }]);
    createMutate.mockImplementation((_args, callbacks) => {
      callbacks?.onSuccess?.({ data: { id: "p-new", name: "Old Navy" } });
    });

    const onChange = vi.fn();
    render(<PayeeAutocomplete value={null} onChange={onChange} />);

    const input = screen.getByLabelText(/payee/i);
    await userEvent.type(input, "Old Navy{Enter}");

    await waitFor(() => {
      expect(createMutate).toHaveBeenCalledTimes(1);
    });
    expect(createMutate.mock.calls[0][0]).toMatchObject({
      resource: "Payee",
      values: { name: "Old Navy" },
    });
    expect(onChange).toHaveBeenCalledWith("p-new");
  });

  it("resolves to existing payee on case-insensitive match (no duplicate POST)", async () => {
    setListData([{ id: "p1", name: "Old Navy" }]);

    const onChange = vi.fn();
    render(<PayeeAutocomplete value={null} onChange={onChange} />);

    const input = screen.getByLabelText(/payee/i);
    await userEvent.type(input, "old navy{Enter}");

    expect(createMutate).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith("p1");
  });

  it("clears to null when value is removed", async () => {
    setListData([{ id: "p1", name: "Steam" }]);

    const onChange = vi.fn();
    render(<PayeeAutocomplete value="p1" onChange={onChange} />);

    const clearBtn = screen.getByLabelText(/clear/i);
    await userEvent.click(clearBtn);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("emits creating state to onCreatingChange while in flight", async () => {
    setListData([]);
    let resolveCreate: (() => void) | null = null;
    createMutate.mockImplementation((_args, callbacks) => {
      resolveCreate = () =>
        callbacks?.onSuccess?.({ data: { id: "p-new", name: "X" } });
    });

    const onCreating = vi.fn();
    render(
      <PayeeAutocomplete
        value={null}
        onChange={vi.fn()}
        onCreatingChange={onCreating}
      />,
    );

    await userEvent.type(screen.getByLabelText(/payee/i), "X{Enter}");

    await waitFor(() => expect(onCreating).toHaveBeenCalledWith(true));
    resolveCreate?.();
    await waitFor(() => expect(onCreating).toHaveBeenCalledWith(false));
  });
});
