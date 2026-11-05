import { _resetConfigForTesting, configureZitadel, getApi } from "@zitadel/api/config";
import { afterEach, describe, expect, it } from "vitest";

import { useZitadelApi } from "../../runtime/composables/useZitadelApi";

afterEach(() => {
  _resetConfigForTesting();
});

describe("useZitadelApi composable", () => {
  it("returns the API client of the configured project", () => {
    const project = configureZitadel({ projectId: "proj_test", proxyPath: "/__nextgen" });

    expect(useZitadelApi()).toBe(getApi(project));
  });

  it("throws a clear error when no project is configured", () => {
    expect(() => useZitadelApi()).toThrow(/no Zitadel project is configured/);
  });
});
