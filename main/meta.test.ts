// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readVersion } from "./meta";

describe("readVersion", () => {
  it("reads the running version from package.json", () => {
    expect(readVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
