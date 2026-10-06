import type { ZitadelApi } from "@zitadel/api/config";
import type { CreateFlow201 } from "@zitadel/api/generated/model";
import { describe, expect, it, vi } from "vitest";

import { exchangeSession, getCurrentStep, startFlow, submitStep } from "./api-client.js";

describe("api-client exports", () => {
  it("exports the four expected wrapper functions", () => {
    expect(typeof startFlow).toBe("function");
    expect(typeof submitStep).toBe("function");
    expect(typeof getCurrentStep).toBe("function");
    expect(typeof exchangeSession).toBe("function");
  });
});

describe("startFlow", () => {
  const response = { id: "flow_1", step: { type: "identifier" } } as unknown as CreateFlow201;

  function fakeApi() {
    const createFlow = vi.fn().mockResolvedValue(response);
    return { api: { createFlow } as unknown as ZitadelApi, createFlow };
  }

  it("sends X-Zitadel-Release when the build pins a release", async () => {
    const { api, createFlow } = fakeApi();
    await startFlow(api, { project_id: "proj_1", purpose: "login" }, "sha256:9f2c1a7b4e83");

    const [, init] = createFlow.mock.calls[0] as [unknown, RequestInit];
    expect(init.credentials).toBe("include");
    expect(init.headers).toEqual({ "X-Zitadel-Release": "sha256:9f2c1a7b4e83" });
  });

  it("sends no release header when nothing is pinned", async () => {
    const { api, createFlow } = fakeApi();
    await startFlow(api, { project_id: "proj_1", purpose: "login" });

    const [, init] = createFlow.mock.calls[0] as [unknown, RequestInit];
    expect(init.credentials).toBe("include");
    expect(init.headers).toBeUndefined();
  });
});
