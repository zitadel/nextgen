import { toZitadelError } from "@/lib/errors";
import { describe, expect, it } from "vitest";

import {
  ProjectConfigMalformedError,
  ProjectConfigMissingError,
  ProjectEnvValueMultilineError,
  ProjectEnvValueUnquotableError,
  ProjectError,
  ProjectSecretMalformedError,
  ProjectSecretMissingError,
} from "@/lib/project";

describe("the project errors", () => {
  it.each([
    ["missing config", new ProjectConfigMissingError(), "missing", "E_VALIDATION"],
    ["missing secret", new ProjectSecretMissingError(), "missing", "E_VALIDATION"],
    ["malformed config", new ProjectConfigMalformedError("bad"), "invalid", "E_VALIDATION"],
    ["malformed secret", new ProjectSecretMalformedError("bad"), "invalid", "E_VALIDATION"],
    ["multi-line value", new ProjectEnvValueMultilineError("KEY"), "invalid", "E_VALIDATION"],
    ["unquotable value", new ProjectEnvValueUnquotableError("KEY"), "invalid", "E_VALIDATION"],
  ] as const)("reports a %s failure by its category and code", (_name, error, category, code) => {
    expect(error).toBeInstanceOf(ProjectError);
    expect(error.category).toBe(category);
    expect(error.retryable).toBe(false);
    expect(toZitadelError(error).code).toBe(code);
  });

  it("says a missing config is to be set up first, naming no command", () => {
    expect(toZitadelError(new ProjectConfigMissingError())).toMatchObject({
      message: "zitadel.json was not found",
      hint: "Set the project up first.",
      nextCommands: undefined,
    });
  });

  it("says where a missing secret can be restored from, naming no command", () => {
    expect(toZitadelError(new ProjectSecretMissingError())).toMatchObject({
      message: ".zitadel/secret was not found",
      hint: "The project secret can be restored from .env.development.local.",
      nextCommands: undefined,
    });
  });

  it("keeps the library's own hint for a value a .env cannot hold", () => {
    expect(toZitadelError(new ProjectEnvValueUnquotableError("KEY")).hint).toBe(
      "Set it in the process environment instead of a .env file.",
    );
    expect(toZitadelError(new ProjectEnvValueMultilineError("KEY")).hint).toBe(
      "A .env value is a single line; remove the newline or store the value another way.",
    );
  });

  it("keeps the cause of a missing file", () => {
    const cause = new Error("ENOENT");

    expect(
      new ProjectSecretMissingError({
        cause,
      }).cause,
    ).toBe(cause);
  });
});
