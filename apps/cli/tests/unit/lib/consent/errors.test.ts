import { describe, expect, it } from "vitest";

import { ConsentError, ConsentInternalError, ConsentRequiredError } from "@/lib/consent";
import { reported } from "@/cli/core/advice";

describe("the consent errors", () => {
  it.each([
    ["required", new ConsentRequiredError("remove X", "Remove X?"), "conflict"],
    ["fault", new ConsentInternalError("bug"), "fault"],
  ] as const)("reports a %s failure by its category", (_name, error, category) => {
    expect(error).toBeInstanceOf(ConsentError);
    expect(error.category).toBe(category);
  });

  it("reports a refusal as one that needs a person to agree", () => {
    const error = new ConsentRequiredError("remove X", "Remove X?");

    expect(reported(error)).toMatchObject({
      code: "E_CONFIRMATION_REQUIRED",
      message: "Cannot remove X without --force in non-interactive mode",
      hint: "Ask a person first: Remove X? Pass --force only once they agree.",
      details: { question: "Remove X?" },
    });
  });

  it("reports an internal failure by its category", () => {
    expect(reported(new ConsentInternalError("bug")).code).toBe("E_VALIDATION");
  });
});
