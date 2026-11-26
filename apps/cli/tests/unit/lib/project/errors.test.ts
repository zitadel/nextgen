import { describe, expect, it } from "vitest";

import {
  ProjectConfigMissingError,
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
