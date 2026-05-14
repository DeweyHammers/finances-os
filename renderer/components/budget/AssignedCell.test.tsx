import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssignedCell } from "./AssignedCell";

describe("AssignedCell", () => {
  it("renders the formatted dollar value", () => {
    render(<AssignedCell cents={2699} onCommit={vi.fn()} />);
    const input = screen.getByDisplayValue("$26.99");
    expect(input).toBeInTheDocument();
  });

  it("commits new amount on blur", async () => {
    const onCommit = vi.fn();
    render(<AssignedCell cents={0} onCommit={onCommit} />);
    const input = screen.getByDisplayValue("$0.00");
    await userEvent.click(input);
    await userEvent.clear(input);
    await userEvent.type(input, "100");
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(10000);
  });

  it("supports calculator-style +X to add", async () => {
    const onCommit = vi.fn();
    render(<AssignedCell cents={5000} onCommit={onCommit} />);
    const input = screen.getByDisplayValue("$50.00");
    await userEvent.click(input);
    await userEvent.clear(input);
    await userEvent.type(input, "+25");
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(7500);
  });

  it("commits on Enter", async () => {
    const onCommit = vi.fn();
    render(<AssignedCell cents={0} onCommit={onCommit} />);
    const input = screen.getByDisplayValue("$0.00");
    await userEvent.click(input);
    await userEvent.clear(input);
    await userEvent.type(input, "42.50{Enter}");
    expect(onCommit).toHaveBeenCalledWith(4250);
  });

  it("rolls back on Escape (no commit)", async () => {
    const onCommit = vi.fn();
    render(<AssignedCell cents={1000} onCommit={onCommit} />);
    const input = screen.getByDisplayValue("$10.00");
    await userEvent.click(input);
    await userEvent.clear(input);
    await userEvent.type(input, "999{Escape}");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not commit when value is unchanged", async () => {
    const onCommit = vi.fn();
    render(<AssignedCell cents={2500} onCommit={onCommit} />);
    const input = screen.getByDisplayValue("$25.00");
    await userEvent.click(input);
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("treats blank input as zero", async () => {
    const onCommit = vi.fn();
    render(<AssignedCell cents={500} onCommit={onCommit} />);
    const input = screen.getByDisplayValue("$5.00");
    await userEvent.click(input);
    await userEvent.clear(input);
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(0);
  });
});
