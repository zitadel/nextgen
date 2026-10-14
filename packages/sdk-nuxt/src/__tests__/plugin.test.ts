import { describe, it, expect, vi, beforeEach } from "vitest";

import type { AuthResult, ClientAuthResult } from "../runtime/types";

/** Runs the plugin for a request whose middleware set `nextgenAuth`, returning the seeded state. */
async function seededState(nextgenAuth: AuthResult): Promise<ClientAuthResult | undefined> {
  let seeded: ClientAuthResult | undefined;
  vi.doMock("#imports", () => ({
    defineNuxtPlugin: (plugin: () => void) => plugin,
    useRequestEvent: () => ({ context: { nextgenAuth } }),
    useState: (_key: string, init: () => ClientAuthResult) => {
      seeded = init();
      return { value: seeded };
    },
    useRuntimeConfig: () => ({ public: {}, nextgen: {} }),
  }));
  const { default: plugin } = await import("../runtime/plugin");
  (plugin as unknown as () => void)();
  return seeded;
}

describe("nextgen plugin", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("seeds a signed-in session without its token", async () => {
    const state = await seededState({
      isAuthenticated: true,
      session: {
        userId: "u1",
        identifier: "ada@example.com",
        identifierProperty: "email",
        display: "Ada",
        token: "secret",
      },
    });

    expect(state).toEqual({
      isAuthenticated: true,
      session: {
        userId: "u1",
        identifier: "ada@example.com",
        identifierProperty: "email",
        display: "Ada",
      },
    });
  });

  // A page guard must be able to tell an outage from a signed-out visitor.
  it("keeps the reason a session could not be checked", async () => {
    const state = await seededState({
      isAuthenticated: false,
      session: null,
      reason: "unavailable",
    });

    expect(state).toEqual({ isAuthenticated: false, session: null, reason: "unavailable" });
  });

  it("seeds a signed-out visitor without a reason", async () => {
    expect(await seededState({ isAuthenticated: false, session: null })).toEqual({
      isAuthenticated: false,
      session: null,
    });
  });
});
