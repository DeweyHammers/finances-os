// @vitest-environment node
import { describe, it, expect } from "vitest";
import { compareVersions, checkForUpdates, readVersion } from "./meta";

describe("compareVersions", () => {
  it("compares dotted numbers, not strings", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("1.1.0", "1.1.0")).toBe(0);
    expect(compareVersions("v1.2.0", "1.2.1")).toBe(-1);
    expect(compareVersions("2", "1.9.9")).toBe(1);
  });
});

describe("checkForUpdates", () => {
  const fakeFetch = (body: unknown, ok = true, status = 200) =>
    (async () => ({ ok, status, json: async () => body })) as unknown as typeof fetch;

  it("reads the running version from package.json", () => {
    expect(readVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("flags a newer release and passes its page URL through", async () => {
    const r = await checkForUpdates(
      fakeFetch({ tag_name: "v99.0.0", html_url: "https://example.test/rel" }),
    );
    expect(r.updateAvailable).toBe(true);
    expect(r.latest).toBe("99.0.0");
    expect(r.url).toBe("https://example.test/rel");
    expect(r.current).toBe(readVersion());
  });

  it("is up to date when the latest tag equals the running version", async () => {
    const r = await checkForUpdates(fakeFetch({ tag_name: `v${readVersion()}` }));
    expect(r.updateAvailable).toBe(false);
  });

  it("throws on a bad answer so the route can report it", async () => {
    await expect(checkForUpdates(fakeFetch({}, false, 503))).rejects.toThrow("503");
    await expect(checkForUpdates(fakeFetch({}))).rejects.toThrow("No release");
  });
});
