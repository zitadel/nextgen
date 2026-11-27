import { describe, expect, it } from "vitest";

import { PM } from "@/lib/pm";
import { InstallError, ReleaseLookupError } from "@/lib/upgrade";

const INSTALL = PM.named("npm").addExact(["@zitadel/api@2.0.0"]);

describe("ReleaseLookupError", () => {
  it("is named, and says only that no release was found", () => {
    const error = new ReleaseLookupError();

    expect([error.name, error.message]).toEqual([
      "ReleaseLookupError",
      "Could not look up the latest release",
    ]);
  });
});

describe("InstallError", () => {
  it("carries the install and what the package manager failed with", () => {
    const cause = new Error("exit 1");

    const error = new InstallError(INSTALL, cause);

    expect([error.name, error.command, error.cause]).toEqual(["InstallError", INSTALL, cause]);
  });
});
