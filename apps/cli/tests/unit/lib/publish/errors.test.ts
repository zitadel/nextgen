import { describe, expect, it } from "vitest";

import {
  PublishConfigInvalidError,
  PublishConnectionVariableMissingError,
  PublishError,
} from "@/lib/publish";

describe("the publish errors", () => {
  it.each([
    ["config", new PublishConfigInvalidError("bad"), "invalid", "E_VALIDATION"],
    [
      "missing variable",
      new PublishConnectionVariableMissingError("missing"),
      "missing",
      "E_CREDENTIAL_MISSING",
    ],
  ] as const)("reports a %s failure by its category and code", (_name, error, category, code) => {
    expect(error).toBeInstanceOf(PublishError);
    expect(error.category).toBe(category);
    expect(error.code).toBe(code);
  });
});
