import { describe, expect, it } from "vitest";

import {
  EnvironmentError,
  EnvironmentFileMissingError,
  EnvironmentNameInvalidError,
  EnvironmentSourcesConflictError,
  EnvironmentValueMissingError,
  EnvironmentValueUnboundError,
} from "@/lib/environment";

describe("the environment errors", () => {
  it.each([
    ["both sources", new EnvironmentSourcesConflictError("both"), "invalid"],
    ["name", new EnvironmentNameInvalidError("bad"), "invalid"],
    ["file", new EnvironmentFileMissingError("gone"), "missing"],
    ["missing value", new EnvironmentValueMissingError("not set"), "invalid"],
    ["unbound value", new EnvironmentValueUnboundError("not set"), "invalid"],
  ] as const)("reports a %s failure by its category", (_name, error, category) => {
    expect(error).toBeInstanceOf(EnvironmentError);
    expect(error.category).toBe(category);
  });

  it("keeps the failure a server address was made from as its cause", () => {
    const cause = new Error("not a URL");

    expect(new EnvironmentValueMissingError("bad", cause).cause).toBe(cause);
  });
});

describe("the environment errors' codes", () => {
  it("reports a missing file as a validation failure, not a missing thing", () => {
    expect(new EnvironmentFileMissingError("why").code).toBe("E_VALIDATION");
  });

  it("reports an invalid input as a validation failure", () => {
    expect(new EnvironmentNameInvalidError("why").code).toBe("E_VALIDATION");
  });
});
