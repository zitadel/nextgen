import { describe, expect, it, vi } from "vitest";

import { heldVariables } from "@/lib/publish/steps/held-variables";
import { aConfig, anApplication } from "@tests/helpers/config";
import { aStepContext } from "@tests/helpers/step-context";

describe("heldVariables", () => {
  it("reads the project's variables once per run", async () => {
    const listVariables = vi.fn(async () => {
      return {};
    });
    const context = aStepContext({
      config: aConfig({ applications: { "shop.json": anApplication() } }),
      client: { listVariables },
    });

    const first = await heldVariables(context);
    const second = await heldVariables(context);

    expect(listVariables).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });
});
