import * as core from "@zitadel/sdk-core/config";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * The key under which `@zitadel/api/config` keeps the registered project on `globalThis`. The
 * contract restores the slot itself because it does not depend on the API package.
 */
const PROJECT_SLOT = Symbol.for("@zitadel/api/config:currentProject");

/** The config helpers an SDK entry re-exports. */
export type ConfigHelpersSdk = {
  readonly [Name in "configureZitadel" | "getApi" | "getZitadelConfig"]: (typeof core)[Name];
};

/**
 * Asserts that an SDK's `configureZitadel`, `getApi` and `getZitadelConfig` are the functions of
 * `@zitadel/sdk-core/config` themselves, not local wrappers: a fork with the same name and types
 * passes every name and type check, yet registers the project differently from the shared one,
 * which keeps it once on `globalThis`.
 */
export function describeSharedConfigHelpers(sdk: ConfigHelpersSdk): void {
  describe("the config helpers of the SDK entry", () => {
    const slots = globalThis as Record<symbol, unknown>;
    const before: { slot?: unknown } = {};

    beforeEach(() => {
      before.slot = slots[PROJECT_SLOT];
      slots[PROJECT_SLOT] = null;
    });

    afterEach(() => {
      slots[PROJECT_SLOT] = before.slot;
    });

    it("are the functions of the shared config module", () => {
      expect(sdk.configureZitadel).toBe(core.configureZitadel);
      expect(sdk.getApi).toBe(core.getApi);
      expect(sdk.getZitadelConfig).toBe(core.getZitadelConfig);
    });

    it("register the handle that getZitadelConfig returns", () => {
      const project = sdk.configureZitadel({ projectId: "shared-config-helpers", proxyPath: "" });

      expect(sdk.getZitadelConfig()).toBe(project);
      expect(core.getZitadelConfig()).toBe(project);
    });
  });
}
