import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthResult, ClientAuthResult } from "../runtime/types";

const configureZitadel = vi.fn();

/**
 * Runs the plugin against a runtime config whose private `nextgen` block
 * records every read, as Nuxt's client-side proxy warns on one.
 */
async function runPlugin(event: unknown): Promise<{ privateReads: string[] }> {
  const privateReads: string[] = [];
  const nextgen = new Proxy(
    { url: "https://auth.example.com" },
    {
      get(target, key) {
        privateReads.push(String(key));
        return Reflect.get(target, key);
      },
    },
  );
  vi.doMock("#imports", () => ({
    defineNuxtPlugin: (plugin: () => void) => plugin,
    useRequestEvent: () => event,
    useRuntimeConfig: () => ({
      public: { zitadelProxyPath: "/__nextgen", zitadelProjectId: "proj_1" },
      nextgen,
    }),
    useState: vi.fn(),
  }));
  vi.doMock("@zitadel/api/config", () => ({ configureZitadel }));
  const { default: plugin } = await import("../runtime/plugin");
  (plugin as unknown as () => void)();
  return { privateReads };
}

describe("runtime plugin", () => {
  beforeEach(() => {
    vi.resetModules();
    configureZitadel.mockReset();
  });

  it("configures the browser without reading the private runtime config", async () => {
    const { privateReads } = await runPlugin(undefined);

    expect(privateReads).toEqual([]);
    expect(configureZitadel).toHaveBeenCalledWith({ proxyPath: "/__nextgen", projectId: "proj_1" });
  });

  it("hands the server the auth URL from the private runtime config", async () => {
    await runPlugin({ context: {} });

    expect(configureZitadel).toHaveBeenCalledWith({
      proxyPath: "/__nextgen",
      projectId: "proj_1",
      url: "https://auth.example.com",
    });
  });
});

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
