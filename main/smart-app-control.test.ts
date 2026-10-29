// @vitest-environment node
/**
 * Smart App Control detection (main/smart-app-control.ts) — the registry
 * read behind "this PC can't run the in-app installer". The command is
 * faked; nothing here touches the real registry.
 */
import { describe, it, expect, vi } from "vitest";
import { parseSmartAppControlState, readSmartAppControlState } from "./smart-app-control";

const output = (value: string) =>
  `\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\CI\\Policy\r\n    VerifiedAndReputablePolicyState    REG_DWORD    ${value}\r\n\r\n`;

describe("parseSmartAppControlState", () => {
  it("maps the DWORD to on / evaluation / off", () => {
    expect(parseSmartAppControlState(output("0x1"))).toBe("on");
    expect(parseSmartAppControlState(output("0x2"))).toBe("evaluation");
    expect(parseSmartAppControlState(output("0x0"))).toBe("off");
  });

  it("returns null when the value line is missing", () => {
    expect(parseSmartAppControlState("")).toBeNull();
    expect(parseSmartAppControlState("ERROR: The system was unable to find the specified registry key or value.")).toBeNull();
  });

  it("treats an unexpected number as unknown", () => {
    expect(parseSmartAppControlState(output("0x7"))).toBe("unknown");
  });
});

describe("readSmartAppControlState", () => {
  it("is off outside Windows without running anything", async () => {
    const run = vi.fn();
    expect(await readSmartAppControlState("linux", run)).toBe("off");
    expect(run).not.toHaveBeenCalled();
  });

  it("queries the CI policy key on Windows", async () => {
    const run = vi.fn(async () => ({ stdout: output("0x1"), code: 0 }));
    expect(await readSmartAppControlState("win32", run)).toBe("on");
    expect(run).toHaveBeenCalledWith("reg", [
      "query",
      "HKLM\\SYSTEM\\CurrentControlSet\\Control\\CI\\Policy",
      "/v",
      "VerifiedAndReputablePolicyState",
    ]);
  });

  it("is off when the value does not exist (reg exits 1)", async () => {
    const run = vi.fn(async () => ({ stdout: "", code: 1 }));
    expect(await readSmartAppControlState("win32", run)).toBe("off");
  });

  it("is unknown when the command fails outright", async () => {
    const run = vi.fn(async () => {
      throw new Error("spawn reg ENOENT");
    });
    expect(await readSmartAppControlState("win32", run)).toBe("unknown");
  });
});
