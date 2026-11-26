import { describe, expect, it } from "vitest";

import {
  EnvironmentError,
  EnvironmentFileMissingError,
  EnvironmentNameInvalidError,
  EnvironmentSourcesConflictError,
  EnvironmentValueInvalidError,
  EnvironmentValueMissingError,
  EnvironmentValueUnboundError,
} from "@/lib/environment";
import { LocalServerUrlInvalidError } from "@/lib/server";

/** What a value missing from the production environment names. */
const MISSING = {
  environment: "production",
  variable: "ZITADEL_PROJECT_ID",
  consulted: ["process environment", ".env.production.local"],
  file: ".env.production.local",
} as const;

describe("the environment errors", () => {
  it.each([
    ["both sources", new EnvironmentSourcesConflictError("both"), "invalid"],
    ["name", new EnvironmentNameInvalidError("bad", "--env"), "invalid"],
    ["file", new EnvironmentFileMissingError("gone"), "missing"],
    ["missing value", new EnvironmentValueMissingError("not set", MISSING), "invalid"],
    [
      "invalid value",
      new EnvironmentValueInvalidError(
        "not a URL",
        ".env.local",
        new LocalServerUrlInvalidError("not http"),
      ),
      "invalid",
    ],
    ["unbound value", new EnvironmentValueUnboundError("not set", MISSING), "invalid"],
  ] as const)("reports a %s failure by its category", (_name, error, category) => {
    expect(error).toBeInstanceOf(EnvironmentError);
    expect(error.category).toBe(category);
  });

  it("keeps the failure a server address was made from as its cause", () => {
    const cause = new LocalServerUrlInvalidError("not http");

    expect(new EnvironmentValueInvalidError("bad", ".env.local", cause).cause).toBe(cause);
  });

  it("names the sources consulted and the file to set a missing value in", () => {
    expect(new EnvironmentValueMissingError("not set", MISSING)).toMatchObject(MISSING);
  });

  it("is a missing value too when the environment has no project", () => {
    expect(new EnvironmentValueUnboundError("not set", MISSING)).toBeInstanceOf(
      EnvironmentValueMissingError,
    );
  });
});

describe("the environment errors' codes", () => {
  it("reports a missing file as a validation failure, not a missing thing", () => {
    expect(new EnvironmentFileMissingError("why").code).toBe("E_VALIDATION");
  });

  it("reports an invalid input as a validation failure", () => {
    expect(new EnvironmentNameInvalidError("why", "ZITADEL_ENV").code).toBe("E_VALIDATION");
  });
});
