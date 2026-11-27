import { describe, expect, it } from "vitest";

import { ConsentError, ConsentInternalError, ConsentRequiredError } from "@/lib/consent";

describe("the consent errors", () => {
  it.each([
    [new ConsentInternalError("bug"), "fault", "E_VALIDATION"],
    [
      new ConsentRequiredError("Cannot remove X without --force", "Remove X?"),
      "denied",
      "E_CONFIRMATION_REQUIRED",
    ],
  ])("reports %s", (error, category, code) => {
    expect(error).toBeInstanceOf(ConsentError);
    expect(error.category).toBe(category);
    expect(error.code).toBe(code);
    expect(error.retryable).toBe(false);
  });
});

describe("what ConsentInternalError states", () => {
  it("reports itself as the failure it is", () => {
    expect(new ConsentInternalError("fatal: bad").details).toEqual({
      original: { name: "ConsentInternalError", message: "fatal: bad", code: undefined },
    });
  });
});
