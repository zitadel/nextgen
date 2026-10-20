import { beforeEach, describe, expect, it, vi } from "vitest";

import plugin from "../runtime/plugin";

const configureZitadel = vi.hoisted(() => vi.fn());
const privateReads = vi.hoisted(() => ({ count: 0 }));

vi.mock("@zitadel/api/config", () => ({ configureZitadel }));

// `defineNuxtPlugin` returns the setup function untouched here, so the test
// calls it the way Nuxt would. The private `nextgen` key counts every read, as
// Nuxt warns (NUXT_E1003) when the browser touches it.
vi.mock("#imports", () => ({
  defineNuxtPlugin: (setup: () => unknown) => setup,
  useRequestEvent: () => undefined,
  useState: () => ({}),
  useRuntimeConfig: () => ({
    public: { zitadelProxyPath: "/__nextgen", zitadelProjectId: "proj-1" },
    get nextgen() {
      privateReads.count += 1;
      return { url: "http://zitadel.example" };
    },
  }),
}));

describe("nextgen plugin", () => {
  beforeEach(() => {
    configureZitadel.mockClear();
    privateReads.count = 0;
  });

  it("does not read the server-only runtime config outside the server", () => {
    (plugin as unknown as () => void)();

    expect(privateReads.count).toBe(0);
    expect(configureZitadel).toHaveBeenCalledWith({
      proxyPath: "/__nextgen",
      projectId: "proj-1",
      url: undefined,
    });
  });
});
