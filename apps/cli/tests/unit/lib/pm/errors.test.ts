import { describe, expect, it } from "vitest";

import { toZitadelError } from "@/lib/errors";
import { PmCommandFailedError, PmError, PmManifestInvalidError } from "@/lib/pm";

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
        path: "/app/package.json",
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
    });
  });
});
