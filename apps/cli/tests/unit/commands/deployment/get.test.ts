import { describe, expect, it } from "vitest";

import DeploymentGet from "@/commands/deployment/get";
import { parseArg } from "@tests/helpers/inputs";

const DEPLOYMENT = "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6";

describe("deployment_id", () => {
  it("takes a deployment id, trimmed", async () => {
    await expect(
      parseArg(DeploymentGet.args.deployment_id, ` ${DEPLOYMENT}\n`, "deployment_id"),
    ).resolves.toBe(DEPLOYMENT);
  });

  it.each([
    ["a release id", "rel_01M6KPFXAE68N6G2X1HN5XD29R"],
    ["a blank", "   "],
    ["a prefix alone", "dep_"],
    ["a space inside", "dep_has space"],
  ])("refuses %s, saying what a deployment id is and where to list them", async (_, value) => {
    await expect(
      parseArg(DeploymentGet.args.deployment_id, value, "deployment_id"),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("must be a deployment ID"),
      hint: "Find one with `zitadel deployment list`.",
    });
  });
});
