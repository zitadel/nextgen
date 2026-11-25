import { describe, expect, it } from "vitest";

import { toZitadelError } from "@/lib/errors";
import { SuggestionError, SuggestionInternalError } from "@/lib/suggestion";

describe("the suggestion errors", () => {
  it("reports a malformed suggestion as a fault, not worth retrying", () => {
    const error = new SuggestionInternalError("variable:get declares no --nope");

    expect(error).toBeInstanceOf(SuggestionError);
    expect([error.category, error.retryable]).toEqual(["fault", false]);
  });

  it("is reported as E_VALIDATION, as every fault is until it has a code of its own", () => {
    expect(toZitadelError(new SuggestionInternalError("nonesuch is not a command"))).toMatchObject({
      code: "E_VALIDATION",
      message: "nonesuch is not a command",
    });
  });
});
