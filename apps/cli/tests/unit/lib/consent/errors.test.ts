import { describe, expect, it } from "vitest";

import { ConsentError, ConsentInternalError, ConsentRequiredError } from "@/lib/consent";
import { toZitadelError } from "@/lib/errors";

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

    expect(toZitadelError(error)).toMatchObject({
      code: "E_CONFIRMATION_REQUIRED",
      message: "Cannot remove X without --force in non-interactive mode",
      hint: "Remove X?",
      details: {
        question: "Remove X?",
      },
    });
  });

  it("reports an internal failure by its category", () => {
    expect(toZitadelError(new ConsentInternalError("bug")).code).toBe("E_VALIDATION");
  });
});

describe("the consent errors' codes", () => {
  it("reports a refusal that needs a person as a confirmation required", () => {
    expect(new ConsentRequiredError("remove X", "Remove X?").code).toBe("E_CONFIRMATION_REQUIRED");
  });
});
