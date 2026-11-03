import { describe, expect, it } from "vitest";

import { reason } from "../../../../../src/commands/deploy/requirements/reason";
import { requirementContext } from "../../../../helpers/requirement-context";

function resolveWith(flags: Record<string, unknown>, meta: Record<string, unknown>) {
  return reason.resolve(
    requirementContext({
      flags,
      meta: { cwd: "/nonexistent-zitadel-dir", env: {}, ...meta },
    }),
  );
}

describe("reason", () => {
  it("is the message that was given", async () => {
    await expect(
      resolveWith({ message: "ship it" }, { dryRun: false, nonInteractive: true }),
    ).resolves.toEqual({ message: "ship it" });
  });

  it("may be left off when someone can be asked", async () => {
    await expect(resolveWith({}, { dryRun: false, nonInteractive: false })).resolves.toEqual({
      message: undefined,
    });
  });

  it("is refused when nobody can be asked and nothing implies one", async () => {
    await expect(resolveWith({}, { dryRun: false, nonInteractive: true })).resolves.toBeUndefined();
    expect(reason.refusal?.message).toBe("A deploy needs a message in non-interactive mode");
  });

  it("is not needed by a dry run, which records nothing", async () => {
    await expect(resolveWith({}, { dryRun: true, nonInteractive: true })).resolves.toEqual({
      message: undefined,
    });
  });
});
