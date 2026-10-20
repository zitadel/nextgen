import { resolveZitadelRuntimeEnv } from "@zitadel/sdk-core";
import { describe, expect, it } from "vitest";

describe("the package root in the edge runtime", () => {
  it("resolves the runtime from the environment it is given", () => {
    expect(resolveZitadelRuntimeEnv({ ZITADEL_PROJECT_ID: "proj_123" })).toMatchObject({
      projectId: "proj_123",
    });
  });
});
