import { describe, expect, it } from "vitest";

import {
  PmCommandFailedError,
  PmCommandMissingError,
  PmCommandNotPermittedError,
  PmError,
  PmManifestInvalidError,
} from "@/lib/pm";

describe("the package manager errors", () => {
  it("reports an unreadable manifest as invalid, keeping the parse error", () => {
    const cause = new SyntaxError("bad");
    const error = new PmManifestInvalidError("bad", cause);

    expect(error).toBeInstanceOf(PmError);
    expect(error.category).toBe("invalid");
    expect(error.retryable).toBe(false);
    expect(error.cause).toBe(cause);
    expect(error.code).toBe("E_VALIDATION");
  });

  it("reports a failed command as unknown, with its message and captured output", () => {
    const error = new PmCommandFailedError("npm install failed with exit 1", 1, "boom");

    expect(error).toBeInstanceOf(PmError);
    expect(error.category).toBe("unknown");
    expect(error.retryable).toBe(false);
    expect(error.output).toBe("boom");
    expect(error.code).toBe("E_VALIDATION");
  });

  it("reports a command that printed nothing captured without output", () => {
    expect(new PmCommandFailedError("spawn npm ENOENT", "ENOENT").output).toBeUndefined();
  });

  it.each([
    [
      "exit code a failed command ended with",
      new PmCommandFailedError("npm install failed with exit 1", 1),
      1,
    ],
    [
      "errno a command that never started failed with",
      new PmCommandFailedError("spawn npm ENOENT", "ENOENT"),
      "ENOENT",
    ],
    [
      "errno a refused command was refused with",
      new PmCommandNotPermittedError("Permission denied", "EACCES"),
      "EACCES",
    ],
  ] as const)("keeps the %s", (_name, error, status) => {
    expect(error.status).toBe(status);
  });

  it("reports a refused command as denied", () => {
    const error = new PmCommandNotPermittedError("spawn npm EACCES", "EACCES");

    expect(error).toBeInstanceOf(PmError);
    expect(error.category).toBe("denied");
    expect(error.retryable).toBe(false);
    expect(error.code).toBe("E_AUTH");
  });
});

describe("what a package manager error states", () => {
  it("says the operating system refused to run the command", () => {
    const error = new PmCommandNotPermittedError("spawn npm EACCES", "EACCES");

    expect(error).toMatchObject({
      message: "Permission denied: spawn npm EACCES",
      hint: "Check file permissions or run with the right user.",
      details: {
        original: {
          name: "PmCommandNotPermittedError",
          message: "spawn npm EACCES",
          code: "EACCES",
        },
      },
    });
  });

  it("says a package manager that is not there is missing", () => {
    expect(new PmCommandMissingError("spawn npm ENOENT", "ENOENT").hint).toBe(
      "A required file or directory is missing.",
    );
  });

  it("reports the failure and the status it ended with", () => {
    expect(new PmCommandFailedError("npm install failed with exit 1", 1, "out").details).toEqual({
      original: {
        name: "PmCommandFailedError",
        message: "npm install failed with exit 1",
        code: 1,
      },
    });
  });

  it("reports the error a manifest could not be read with", () => {
    const cause = new SyntaxError("Unexpected token");

    expect(new PmManifestInvalidError("Unexpected token", cause).details).toEqual({
      original: { name: "SyntaxError", message: "Unexpected token", code: undefined },
    });
  });
});
