/**
 * TransactionFormFields — lost-input regression (Oct 2026).
 *
 * PayeeAutocomplete creates a brand-new payee in the background and only
 * reports the id when the POST succeeds. A fast user types the payee, tabs
 * on and fills Memo / Inflow before that response lands. The late payee
 * patch must merge into the LATEST form state — the old
 * `onChange({ ...state, ...patch })` spread a snapshot from before the memo
 * was typed and wiped it, so a transaction was saved with no memo.
 *
 * Generic sample data only — this file is committed to a public repo.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  TransactionFormFields,
  emptyTransactionState,
  type TransactionFormState,
} from "./TransactionFormFields";

const useListMock = vi.fn();
const useCreateMock = vi.fn();

vi.mock("@refinedev/core", () => ({
  useList: (...args: any[]) => useListMock(...args),
  useCreate: () => useCreateMock(),
}));

// Mirrors how AddTransactionModal / EditTransactionModal host the form: the
// parent owns the state with useState and hands `setState` straight down as
// `onChange`. `onState` lets the test read the latest committed state.
const Harness = ({
  onState,
}: {
  onState: (s: TransactionFormState) => void;
}) => {
  const [state, setState] = useState<TransactionFormState>(() => ({
    ...emptyTransactionState(),
    date: "2026-01-02",
  }));
  onState(state);
  return (
    <TransactionFormFields
      accountId="acct-1"
      state={state}
      onChange={setState}
    />
  );
};

describe("TransactionFormFields — async payee create vs. later typing", () => {
  let createMutate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    useListMock.mockReset();
    useCreateMock.mockReset();
    createMutate = vi.fn();
    useCreateMock.mockReturnValue({ mutate: createMutate });
    // Every list the form reads (payees, groups, items, accounts, months,
    // txns, bills, personals) is empty — the picker just shows Ready to Assign.
    useListMock.mockReturnValue({
      query: { data: { data: [] }, isLoading: false },
    });
  });

  it("keeps a memo typed while the new payee's POST is still in flight", async () => {
    // Hold the create's success callback so the test decides when it resolves.
    let resolveCreate: (() => void) | null = null;
    createMutate.mockImplementation((_args, callbacks) => {
      resolveCreate = () =>
        callbacks?.onSuccess?.({ data: { id: "payee-new", name: "Sample Shop" } });
    });

    let latest: TransactionFormState | null = null;
    render(<Harness onState={(s) => (latest = s)} />);

    // 1. Type a payee that does not exist yet and commit it with Enter.
    await userEvent.type(screen.getByLabelText(/payee/i), "Sample Shop{Enter}");
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(latest!.payeeId).toBeNull(); // id not known yet

    // 2. Keep typing before the POST returns.
    await userEvent.type(screen.getByLabelText(/memo/i), "Sample memo");
    await userEvent.type(screen.getByLabelText(/inflow/i), "12.34");
    expect(latest!.memo).toBe("Sample memo");

    // 3. The POST resolves late. Its patch must land on top of the memo and
    //    inflow, not replace them with the pre-memo snapshot.
    resolveCreate!();
    await waitFor(() => expect(latest!.payeeId).toBe("payee-new"));
    expect(latest!.memo).toBe("Sample memo");
    expect(latest!.inflow).toBe("12.34");
    expect(latest!.date).toBe("2026-01-02");
  });

  it("merges an ordinary synchronous patch (memo) without touching other fields", async () => {
    let latest: TransactionFormState | null = null;
    render(<Harness onState={(s) => (latest = s)} />);

    await userEvent.type(screen.getByLabelText(/memo/i), "Note");

    expect(latest!.memo).toBe("Note");
    expect(latest!.date).toBe("2026-01-02");
    expect(latest!.payeeId).toBeNull();
    expect(createMutate).not.toHaveBeenCalled();
  });
});
