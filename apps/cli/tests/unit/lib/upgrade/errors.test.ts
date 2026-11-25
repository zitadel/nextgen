import { describe, expect, it } from "vitest";

import { toZitadelError } from "@/lib/errors";
import { PM } from "@/lib/pm";
import { UpgradeError, UpgradeInstallFailedError, UpgradeReleaseLookupError } from "@/lib/upgrade";

const INSTALL = PM.named("npm").addExact(["@zitadel/api@2.0.0"]);

describe("UpgradeReleaseLookupError", () => {
  it("is named, and says only that no release was found", () => {
    const error = new UpgradeReleaseLookupError("Could not look up the latest release");

    expect([error.name, error.message]).toEqual([
      "UpgradeReleaseLookupError",
      "Could not look up the latest release",
    ]);
  });

  it("is a generic failure that is not worth retrying unchanged", () => {
    const error = new UpgradeReleaseLookupError("Could not look up the latest release");

    expect(error).toBeInstanceOf(UpgradeError);
    expect([error.category, error.retryable]).toEqual(["unknown", false]);
    expect(toZitadelError(error).code).toBe("E_VALIDATION");
  });
});

describe("UpgradeInstallFailedError", () => {
  it("carries the install and what the package manager failed with", () => {
    const cause = new Error("exit 1");

    const error = new UpgradeInstallFailedError(INSTALL, cause);

    expect(error).toBeInstanceOf(UpgradeError);
    expect([error.name, error.command, error.cause]).toEqual([
      "UpgradeInstallFailedError",
      INSTALL,
      cause,
    ]);
  });

  it("is a generic failure that is not worth retrying unchanged", () => {
    const error = new UpgradeInstallFailedError(INSTALL, new Error("exit 1"));

    expect([error.category, error.retryable]).toEqual(["unknown", false]);
    expect(toZitadelError(error).code).toBe("E_VALIDATION");
  });
});
