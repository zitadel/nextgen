import { describe, expect, it } from "vitest";

import DeploymentCreate from "@/commands/deployment/create";
import { parseFlag } from "@tests/helpers/inputs";

describe("-m", () => {
  it("trims a message", async () => {
    await expect(
      parseFlag(DeploymentCreate.flags.message, "  add company  ", "message"),
    ).resolves.toBe("add company");
  });

  it("refuses a blank message", async () => {
    await expect(parseFlag(DeploymentCreate.flags.message, "   ", "message")).rejects.toMatchObject(
      {
        code: "E_VALIDATION",
        message: "the value is empty",
      },
    );
  });

  it("refuses a message longer than the server records, naming the limit", async () => {
    await expect(
      parseFlag(DeploymentCreate.flags.message, "x".repeat(1025), "message"),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "the message is longer than 1024 characters",
      hint: "Pass a shorter summary with -m.",
    });
  });

  it("counts code points, not UTF-16 units", async () => {
    await expect(
      parseFlag(DeploymentCreate.flags.message, "\u{1F600}".repeat(1024), "message"),
    ).resolves.toHaveLength(2048);
  });
});

describe("--release", () => {
  const RELEASE = "rel_01KX3RG8A7F0N9WD3P2E4YM5C1";

  it("takes a release id, trimmed", async () => {
    await expect(
      parseFlag(DeploymentCreate.flags.release, ` ${RELEASE}\n`, "release"),
    ).resolves.toBe(RELEASE);
  });

  it.each([
    ["a deployment id", "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6"],
    ["a blank", "   "],
    ["a prefix alone", "rel_"],
    ["a space inside", "rel_has space"],
  ])("refuses %s, saying what a release id is and where to list them", async (_, value) => {
    await expect(parseFlag(DeploymentCreate.flags.release, value, "release")).rejects.toMatchObject(
      {
        code: "E_VALIDATION",
        message: expect.stringContaining("must be a release ID"),
        hint: "Find one with `zitadel release list`.",
      },
    );
  });
});
