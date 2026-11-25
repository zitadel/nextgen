import { describe, expect, it } from "vitest";

import { reported } from "@/cli/core/advice";
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
    expect(reported(error).code).toBe(code);
  });

  it("points a missing secret at doctor --fix", () => {
    expect(reported(new ProjectFileMissingError("secret", "gone"))).toMatchObject({
      hint: expect.stringContaining("zitadel doctor --fix"),
      nextCommands: [{ id: "doctor", flags: { fix: true } }],
    });
  });

  it("points a malformed secret at doctor --fix as well", () => {
    expect(reported(new ProjectFileMalformedError("secret", "bad"))).toMatchObject({
      nextCommands: [{ id: "doctor", flags: { fix: true } }],
    });
  });

  it("points a missing config at setup", () => {
    expect(reported(new ProjectFileMissingError("config", "gone"))).toMatchObject({
      hint: "Set the project up first.",
      nextCommands: [{ id: "setup" }],
    });
  });

  it("keeps the library's own hint for a value a .env cannot hold", () => {
    const error = new ProjectEnvValueError("unquotable", "KEY");

    expect(reported(error).hint).toBe("Set it in the process environment instead of a .env file.");
  });

  it("keeps the cause of a missing file", () => {
    const cause = new Error("ENOENT");

    expect(new ProjectFileMissingError("secret", "gone", { cause }).cause).toBe(cause);
  });
});
