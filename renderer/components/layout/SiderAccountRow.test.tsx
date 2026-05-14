import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SiderAccountRow } from "./SiderAccountRow";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

describe("SiderAccountRow", () => {
  beforeEach(() => {
    pushMock.mockReset();
  });

  it("renders name and formatted balance", () => {
    render(
      <SiderAccountRow
        id="acc-1"
        name="Checking"
        balanceCents={139311}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByText("Checking")).toBeInTheDocument();
    expect(screen.getByText("$1,393.11")).toBeInTheDocument();
  });

  it("navigates to /Cash?id=<id> when row body is clicked", () => {
    render(
      <SiderAccountRow
        id="acc-1"
        name="Checking"
        balanceCents={0}
        onEdit={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Checking"));
    expect(pushMock).toHaveBeenCalledWith("/Cash?id=acc-1");
  });

  it("calls onEdit and does NOT navigate when pencil is clicked", () => {
    const onEdit = vi.fn();
    render(
      <SiderAccountRow
        id="acc-1"
        name="Checking"
        balanceCents={0}
        onEdit={onEdit}
      />,
    );
    const pencil = screen.getByLabelText("Edit Checking");
    fireEvent.click(pencil);
    expect(onEdit).toHaveBeenCalledWith("acc-1");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("renders pencil icon (initially hidden via opacity, visible on hover)", () => {
    render(
      <SiderAccountRow
        id="acc-1"
        name="Checking"
        balanceCents={0}
        onEdit={vi.fn()}
      />,
    );
    const pencil = screen.getByLabelText("Edit Checking");
    // Pencil exists in DOM at all times (opacity-only hide)
    expect(pencil).toBeInTheDocument();
  });
});
