import { toZitadelError } from "@/lib/errors";
import { describe, expect, it } from "vitest";

import {
  ProjectEnvValueError,
  ProjectError,
  ProjectFileMalformedError,
  ProjectFileMissingError,
} from "@/lib/project";

describe("the project errors", () => {
  it.each([
    ["missing config", new ProjectFileMissingError("config", "gone"), "missing", "E_VALIDATION"],
    ["missing secret", new ProjectFileMissingError("secret", "gone"), "missing", "E_VALIDATION"],
    ["malformed", new ProjectFileMalformedError("config", "bad"), "invalid", "E_VALIDATION"],
    ["env value", new ProjectEnvValueError("line-break", "KEY"), "invalid", "E_VALIDATION"],
  ] as const)("reports a %s failure by its category and code", (_name, error, category, code) => {
    expect(error).toBeInstanceOf(ProjectError);
    expect(error.category).toBe(category);
    expect(toZitadelError(error).code).toBe(code);
  });

  it("points a missing secret at doctor --fix", () => {
    expect(toZitadelError(new ProjectFileMissingError("secret", "gone"))).toMatchObject({
      hint: expect.stringContaining("Restore the project secret"),
      nextCommands: [{ id: "doctor", flags: { fix: true } }],
    });
  });

  it("points a malformed secret at doctor --fix as well", () => {
    expect(toZitadelError(new ProjectFileMalformedError("secret", "bad"))).toMatchObject({
      nextCommands: [{ id: "doctor", flags: { fix: true } }],
    });
  });

  it("points a missing config at setup", () => {
    expect(toZitadelError(new ProjectFileMissingError("config", "gone"))).toMatchObject({
      hint: "Set the project up first.",
      nextCommands: [{ id: "setup" }],
    });
  });

  it("keeps the library's own hint for a value a .env cannot hold", () => {
    const error = new ProjectEnvValueError("unquotable", "KEY");

    expect(toZitadelError(error).hint).toBe(
      "Set it in the process environment instead of a .env file.",
    );
  });

  it("keeps the cause of a missing file", () => {
    const cause = new Error("ENOENT");

    expect(new ProjectFileMissingError("secret", "gone", { cause }).cause).toBe(cause);
  });
});

describe("the project errors' codes", () => {
  it("reports a missing file as a validation failure, not a missing thing", () => {
    expect(new ProjectFileMissingError("config", "why").code).toBe("E_VALIDATION");
  });

  it("reports a malformed file as a validation failure", () => {
    expect(new ProjectFileMalformedError("config", "why").code).toBe("E_VALIDATION");
  });
});
