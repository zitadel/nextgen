import { businessLocales } from "@zitadel/components";
import { describe, expect, it, vi } from "vitest";

import plugin from "../runtime/components.client";

// `defineNuxtPlugin` returns the setup function untouched here, so the test
// calls it the way Nuxt would.
vi.mock("#imports", () => ({
  defineNuxtPlugin: (setup: () => unknown) => setup,
}));

describe("components.client plugin", () => {
  it("provides the business copy overlay as $zitadelBusinessLocales", () => {
    const result = (plugin as unknown as () => { provide: Record<string, unknown> })();

    expect(result.provide.zitadelBusinessLocales).toBe(businessLocales);
  });
});
