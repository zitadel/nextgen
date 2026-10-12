import { describe, expect, it } from "vitest";

import { validateStep } from "../../../../src/lib/release/steps/validate";
import type { StepContext } from "../../../../src/lib/release/pipeline";

function ctx(bundle: StepContext["bundle"], env: StepContext["env"] = {}): StepContext {
  return {
    cwd: "/tmp",
    client: {} as never,
    projectId: "proj_1",
    env,
    mode: "deploy",
    dryRun: false,
    json: true,
    color: false,
    bundle,
  };
}

describe("validate step", () => {
  it("fails naming an environment variable a resource references but the env lacks", async () => {
    const bundle = {
      schemas: [{ objectType: "human-user", hint: "${MISSING_VAR}" }],
      flow_definitions: [],
      brandings: [],
    };

    await expect(validateStep.run(ctx(bundle))).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("MISSING_VAR"),
    });
  });

  it("passes when every referenced variable resolves", async () => {
    const bundle = {
      schemas: [{ objectType: "human-user", hint: "${PRESENT_VAR}" }],
      flow_definitions: [],
      brandings: [],
    };

    await expect(validateStep.run(ctx(bundle, { PRESENT_VAR: "x" }))).resolves.toBeUndefined();
  });
});
