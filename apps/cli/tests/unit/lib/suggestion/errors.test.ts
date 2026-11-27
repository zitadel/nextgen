import { describe, expect, it } from "vitest";

import * as classes from "@/lib/suggestion/errors";

describe("what each suggestion error states", () => {
  it.each([
    [
      "SuggestionInvalidError",
      new classes.SuggestionInvalidError("zitadel nope is not a command", new Error("boom")),
      {
        message: "zitadel nope is not a command",
        hint: undefined,
        details: { original: { name: "Error", message: "boom", code: undefined } },
        code: "E_VALIDATION",
        category: "fault",
        retryable: false,
      },
    ],
  ])("states what a %s says and reports", (_name, error, expected) => {
    expect({
      message: error.message,
      hint: error.hint,
      details: error.details,
      code: error.code,
      category: error.category,
      retryable: error.retryable,
    }).toEqual(expected);
  });
});
