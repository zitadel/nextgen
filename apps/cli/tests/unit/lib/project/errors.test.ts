import { describe, expect, it } from "vitest";

import {
  ProjectConfigMissingError,
  ProjectEnvValueMultilineError,
  ProjectEnvValueUnquotableError,
  ProjectError,
  ProjectFileMissingError,
  ProjectInvalidError,
  ProjectSecretMissingError,
} from "@/lib/project";

describe("the project errors", () => {
  it.each([
    [
      "missing zitadel.json",
      new ProjectConfigMissingError("zitadel.json was not found"),
      "missing",
      "E_VALIDATION",
    ],
    [
      "missing secret",
      new ProjectSecretMissingError(".zitadel/secret was not found"),
      "missing",
      "E_VALIDATION",
    ],
    ["invalid file or value", new ProjectInvalidError("bad"), "invalid", "E_VALIDATION"],
  ] as const)("reports a %s failure by its category and code", (_name, error, category, code) => {
    expect(error).toBeInstanceOf(ProjectError);
    expect(error.category).toBe(category);
    expect(error.retryable).toBe(false);
    expect(error.code).toBe(code);
  });

  it("reports the message it was given", () => {
    expect(new ProjectConfigMissingError("zitadel.json was not found").message).toBe(
      "zitadel.json was not found",
    );
  });

  it("keeps the cause of a missing file", () => {
    const cause = new Error("ENOENT");

    expect(new ProjectSecretMissingError(".zitadel/secret was not found", cause).cause).toBe(cause);
  });

  it.each([
    ["zitadel.json", new ProjectConfigMissingError("zitadel.json was not found")],
    ["the secret", new ProjectSecretMissingError(".zitadel/secret was not found")],
  ] as const)("reports missing %s as a missing project file", (_name, error) => {
    expect(error).toBeInstanceOf(ProjectFileMissingError);
  });
});

describe("what a project error states", () => {
  it.each([
    [
      "no zitadel.json",
      new ProjectConfigMissingError("zitadel.json was not found"),
      "Set the project up first.",
    ],
    [
      "a value with a line break",
      new ProjectEnvValueMultilineError("A has a line break"),
      "A .env value is a single line; remove the newline or store the value another way.",
    ],
    [
      "a value no quoting keeps",
      new ProjectEnvValueUnquotableError("A cannot be quoted"),
      "Set it in the process environment instead of a .env file.",
    ],
  ] as const)("states the hint of %s", (_situation, error, hint) => {
    expect(error.hint).toBe(hint);
  });

  it("reports the error a file could not be used with", () => {
    const cause = new SyntaxError("Unexpected token");

    expect(new ProjectInvalidError("Unexpected token", cause).details).toEqual({
      original: { name: "SyntaxError", message: "Unexpected token", code: undefined },
    });
  });

  it("reports no facts of a value a .env file cannot hold", () => {
    expect(new ProjectEnvValueMultilineError("A has a line break").details).toEqual({});
  });
});
