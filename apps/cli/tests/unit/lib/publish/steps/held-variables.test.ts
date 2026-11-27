import { describe, expect } from "vitest";

import { heldVariables } from "@/lib/publish/steps/held-variables";
import { it } from "@tests/fixtures";
import { answeringVariables } from "@tests/helpers/api-answers";
import { aConfig, anApplication } from "@tests/helpers/config";
import { aStepContext } from "@tests/helpers/step-context";

describe("heldVariables", () => {
  it("reads the project's variables once per run", async ({ server }) => {
    const reads = answeringVariables(server, {});
    const context = aStepContext({
      config: aConfig({ applications: { "shop.json": anApplication() } }),
    });

    const first = await heldVariables(context);
    const second = await heldVariables(context);

    expect(reads).toHaveLength(1);
    expect(second).toBe(first);
  });
});
