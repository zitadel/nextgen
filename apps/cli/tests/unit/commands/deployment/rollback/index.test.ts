import { describe, expect, it } from "vitest";

import DeploymentRollback from "@/commands/deployment/rollback/index";
import { parseArg, parseFlag } from "@tests/helpers/inputs";

describe("-m", () => {
  it("trims a message", async () => {
    await expect(
      parseFlag(DeploymentRollback.flags.message, "  rolled back  ", "message"),
    ).resolves.toBe("rolled back");
  });

  it("refuses a blank message", async () => {
    await expect(
      parseFlag(DeploymentRollback.flags.message, "   ", "message"),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "the value is empty",
    });
  });

  it("refuses a message longer than the server records, naming the limit", async () => {
    await expect(
      parseFlag(DeploymentRollback.flags.message, "x".repeat(1025), "message"),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "the message is longer than 1024 characters",
      hint: "Pass a shorter summary with -m.",
    });
  });
});

describe("deployment_id", () => {
  const DEPLOYMENT = "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6";

  it("takes a deployment id, trimmed", async () => {
    await expect(
      parseArg(DeploymentRollback.args.deployment_id, ` ${DEPLOYMENT}\n`, "deployment_id"),
    ).resolves.toBe(DEPLOYMENT);
  });

  it.each([
    ["a release id", "rel_01M6KPFXAE68N6G2X1HN5XD29R"],
    ["a blank", ""],
    ["a prefix alone", "dep_"],
    ["a space inside", "dep_has space"],
  ])("refuses %s, saying what a deployment id is and that it can be omitted", async (_, value) => {
    await expect(
      parseArg(DeploymentRollback.args.deployment_id, value, "deployment_id"),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("must be a deployment ID"),
      hint: "Find one with `zitadel deployment list`, or omit it to undo the last deploy.",
    });
  });

  it("does not echo the value it refuses", async () => {
    await expect(
      parseArg(DeploymentRollback.args.deployment_id, "\u001b[2J", "deployment_id"),
    ).rejects.toMatchObject({
      message: expect.not.stringContaining("\u001b"),
    });
  });
});
