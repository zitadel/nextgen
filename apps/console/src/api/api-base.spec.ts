import { afterEach, describe, expect, it, vi } from "vitest";

import { _resetConfigForTesting } from "@zitadel/api/config";

/**
 * Pins the API base (Console ADR 0002 §4, revised): the console puts nothing
 * in front of the API's `/api/v1`, under the dev server, whose proxy forwards
 * that path unchanged, as in the embedded production build, where the Go
 * server serves it (ADR 077). The embedded e2e lane (`e2e:console-embedded`)
 * proves the full request path but is opt-in local; this spec is the
 * CI-visible guard on the client half, the counterpart of
 * `cmd/server/mux_test.go` pinning the server half.
 */
describe("apiBase", () => {
  afterEach(() => {
    vi.resetModules();
    _resetConfigForTesting();
  });

  it.each([
    ["production builds", false],
    ["the dev server", true],
  ])("puts nothing in front of /api/v1 in %s", async (_label, dev) => {
    vi.stubEnv("DEV", dev);
    vi.stubEnv("VITE_CONSOLE_API_BASE", undefined);
    const { apiBase } = await import("./zitadel");
    expect(apiBase).toBe("");
  });

  it("lets VITE_CONSOLE_API_BASE name what goes in front of it", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_CONSOLE_API_BASE", "/elsewhere");
    const { apiBase } = await import("./zitadel");
    expect(apiBase).toBe("/elsewhere");
  });

  it("allows a later import to bind a new proxyPath after reset", async () => {
    // The write-once globalThis slot is what leaked across Vitest files, not
    // the `apiBase` export: a fresh module can print the stubbed env while
    // `configureZitadel` still returns the previous handle.
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_CONSOLE_API_BASE", undefined);
    const first = await import("./zitadel");
    expect(first.apiBase).toBe("");

    _resetConfigForTesting();
    vi.resetModules();
    vi.stubEnv("VITE_CONSOLE_API_BASE", "http://localhost");
    const second = await import("./zitadel");
    const { getZitadelConfig } = await import("@zitadel/api/config");
    expect(second.apiBase).toBe("http://localhost");
    expect(getZitadelConfig()?.proxyPath).toBe("http://localhost");
  });

  it("treats an empty VITE_CONSOLE_API_BASE as unset, matching the dev proxy", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_CONSOLE_API_BASE", "");
    const { apiBase } = await import("./zitadel");
    expect(apiBase).toBe("");
  });
});
