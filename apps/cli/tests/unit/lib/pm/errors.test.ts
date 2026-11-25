import { describe, expect, it } from "vitest";

import { toZitadelError } from "@/lib/errors";
import {
  PmCommandFailedError,
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
    expect(toZitadelError(error)).toMatchObject({
      code: "E_VALIDATION",
      message: "bad",
    });
  });

  it("reports a failed command as unknown, with its message and captured output", () => {
    const error = new PmCommandFailedError("npm install failed with exit 1", "boom");

    expect(error).toBeInstanceOf(PmError);
    expect(error.category).toBe("unknown");
    expect(error.retryable).toBe(false);
    expect(error.output).toBe("boom");
    expect(toZitadelError(error)).toMatchObject({
      code: "E_VALIDATION",
      message: "npm install failed with exit 1",
    });
  });

  it("reports a command that printed nothing captured without output", () => {
    expect(new PmCommandFailedError("spawn npm ENOENT").output).toBeUndefined();
  });

  it("reports a refused command as denied", () => {
    const error = new PmCommandNotPermittedError("Permission denied: spawn npm EACCES");

    expect(error).toBeInstanceOf(PmError);
    expect(error.category).toBe("denied");
    expect(error.retryable).toBe(false);
    expect(toZitadelError(error)).toMatchObject({
      code: "E_AUTH",
      message: "Permission denied: spawn npm EACCES",
    });
  });
});
