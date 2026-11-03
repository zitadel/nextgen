import { describe, expect, it } from "vitest";

import { origins } from "../../../../../src/commands/deploy/requirements/origins";
import { requirementContext } from "../../../../helpers/requirement-context";

describe("origins", () => {
  it("is exempt for a dry run, which never reaches the deploy", async () => {
    await expect(origins.resolve(requirementContext({ meta: { dryRun: true } }))).resolves.toEqual({
      origins: [],
      landing: [],
    });
  });

  it("refuses a project with no primary origin, handing the refusal what to say", () => {
    expect(origins.refusal).toMatchObject({
      message: "The project has no primary origin to deploy to",
      hint: "{hint}",
      next: ["{next}"],
    });
  });
});
