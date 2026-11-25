import { describe, expect, it } from "vitest";

import { toZitadelError } from "@/lib/errors";
import {
  PmCommandFailedError,
  PmCommandNotPermittedError,
  PmCommandNotStartedError,
  PmError,
  PmManifestInvalidError,
} from "@/lib/pm";

describe("the package manager errors", () => {
  it("reports an unreadable manifest as invalid, keeping the parse error", () => {
    const cause = new SyntaxError("bad");
    const error = new PmManifestInvalidError("/app/package.json", {
      cause,
    });

    expect(error).toBeInstanceOf(PmError);
    expect(error.category).toBe("invalid");
    expect(error.retryable).toBe(false);
    expect(error.path).toBe("/app/package.json");
    expect(error.cause).toBe(cause);
    expect(toZitadelError(error)).toMatchObject({
      code: "E_VALIDATION",
      message: "bad",
      details: {
        original: {
          name: "SyntaxError",
          message: "bad",
        },
      },
    });
  });

  it("reports a failed command as unknown, with its message, cause and facts", () => {
    const cause = new Error("spawn");
    const error = new PmCommandFailedError("npm install failed with exit 1", {
      cause,
      exit: 1,
      signal: null,
      output: "boom",
    });

    expect(error).toBeInstanceOf(PmError);
    expect(error.category).toBe("unknown");
    expect(error.retryable).toBe(false);
    expect(error.cause).toBe(cause);
    expect(error).toMatchObject({
      exit: 1,
      signal: null,
      output: "boom",
    });
    expect(toZitadelError(error)).toMatchObject({
      code: "E_VALIDATION",
      message: "npm install failed with exit 1",
      details: {
        original: {
          name: "Error",
          message: "npm install failed with exit 1",
          code: 1,
        },
      },
    });
  });

  it("reports a program or directory that is not there as missing, with main's hint", () => {
    const error = new PmCommandNotStartedError("spawn npm ENOENT", "ENOENT");

    expect(error).toBeInstanceOf(PmError);
    expect(error.category).toBe("missing");
    expect(error.retryable).toBe(false);
    expect(error.exit).toBe("ENOENT");
    expect(toZitadelError(error)).toMatchObject({
      code: "E_VALIDATION",
      message: "spawn npm ENOENT",
      hint: "A required file or directory is missing.",
      details: {
        original: {
          name: "Error",
          message: "spawn npm ENOENT",
          code: "ENOENT",
        },
      },
    });
  });

  it("reports a refused command as denied, with main's message and hint", () => {
    const error = new PmCommandNotPermittedError("spawn npm EACCES", "EACCES");

    expect(error).toBeInstanceOf(PmError);
    expect(error.category).toBe("denied");
    expect(error.retryable).toBe(false);
    expect(error.exit).toBe("EACCES");
    expect(toZitadelError(error)).toMatchObject({
      code: "E_AUTH",
      message: "Permission denied: spawn npm EACCES",
      hint: "Check file permissions or run with the right user.",
      details: {
        original: {
          name: "Error",
          message: "spawn npm EACCES",
          code: "EACCES",
        },
      },
    });
  });
});
