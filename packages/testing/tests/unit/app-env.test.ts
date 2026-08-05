import { describe, expect, it } from "vitest";

import { applyAppEnvTemplate, nextAppEnv } from "../../src/app-env";
import type { InstanceHandle } from "../../src/types";

const handle: InstanceHandle = {
  baseUrl: "http://localhost:8092",
  projectId: "proj_1",
  projectSecret: "secret_1",
  schemaId: "sch_1",
};

describe("applyAppEnvTemplate", () => {
  it("maps env var names to handle fields", () => {
    expect(
      applyAppEnvTemplate({ MY_URL: "baseUrl", MY_PROJECT: "projectId" }, handle),
    ).toEqual({ MY_URL: "http://localhost:8092", MY_PROJECT: "proj_1" });
  });

  it("fails on a field the handle does not carry instead of dropping the var", () => {
    expect(() => applyAppEnvTemplate({ PREVIEW: "previewSecret" }, handle)).toThrow(
      /maps "PREVIEW" to handle field "previewSecret"/,
    );
  });

  it("locks the @zitadel/sdk-next env contract", () => {
    expect(applyAppEnvTemplate(nextAppEnv, handle)).toEqual({
      ZITADEL_URL: "http://localhost:8092",
      NEXT_PUBLIC_ZITADEL_PROJECT_ID: "proj_1",
      ZITADEL_PROJECT_SECRET: "secret_1",
    });
  });
});
