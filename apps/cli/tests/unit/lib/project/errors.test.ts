import { describe, expect, it } from "vitest";

import { ProjectError, ProjectFileMissingError, ProjectInvalidError } from "@/lib/project";

describe("the project errors", () => {
  it.each([
    [
      "missing file",
      new ProjectFileMissingError("zitadel.json was not found"),
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
    expect(new ProjectFileMissingError("zitadel.json was not found").message).toBe(
      "zitadel.json was not found",
    );
  });

  it("keeps the cause of a missing file", () => {
    const cause = new Error("ENOENT");

    expect(new ProjectFileMissingError(".zitadel/secret was not found", cause).cause).toBe(cause);
  });
});
