import { describe, expect, it } from "vitest";

import DeploymentRollback from "@/commands/deployment/rollback/index";
import { parseFlag } from "@tests/helpers/inputs";

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
