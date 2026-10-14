import { beforeEach, describe, expect, it, vi } from "vitest";

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
