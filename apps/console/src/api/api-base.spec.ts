import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Pins both branches of the API base (Console ADR 0002 §4, revised): the
 * embedded production build must target the origin root — `/api` exists only
 * under the dev server, whose proxy strips it, and the Go mux has never
 * served it. The embedded e2e lane (`console-e2e:e2e-embedded`) proves the
 * full request path but is opt-in local; this spec is the CI-visible guard
 * on the client half, the counterpart of `cmd/server/mux_test.go` pinning
 * the server half. The original bug — an unconditional `/api` default —
 * would fail the first case.
 */
describe("apiBase", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("targets the origin root in production builds", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_CONSOLE_API_BASE", undefined);
    const { apiBase } = await import("./zitadel");
    expect(apiBase).toBe("");
  });

  it("targets the dev proxy's /api under the dev server", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_CONSOLE_API_BASE", undefined);
    const { apiBase } = await import("./zitadel");
    expect(apiBase).toBe("/api");
  });

  it("lets VITE_CONSOLE_API_BASE override either branch", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_CONSOLE_API_BASE", "/elsewhere");
    const { apiBase } = await import("./zitadel");
    expect(apiBase).toBe("/elsewhere");
  });
});
