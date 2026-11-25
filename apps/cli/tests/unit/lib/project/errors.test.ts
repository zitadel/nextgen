import { describe, expect, it } from "vitest";

import {
  ProjectConfigMissingError,
  ProjectEnvValueError,
  ProjectError,
  ProjectMalformedError,
  ProjectSecretMissingError,
} from "@/lib/project";

describe("the project errors", () => {
  it.each([
    [
      "missing config",
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
    ["malformed file", new ProjectMalformedError("bad"), "invalid", "E_VALIDATION"],
    ["value a .env cannot hold", new ProjectEnvValueError("bad"), "invalid", "E_VALIDATION"],
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
});
