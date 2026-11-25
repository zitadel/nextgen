import { toZitadelError } from "@/lib/errors";
import { describe, expect, it } from "vitest";

import {
  EnvironmentError,
  EnvironmentFileMissingError,
  EnvironmentNameInvalidError,
  EnvironmentServerInvalidError,
  EnvironmentSourcesConflictError,
  EnvironmentValueMissingError,
} from "@/lib/environment";

describe("the environment errors", () => {
  it.each([
    ["both sources", new EnvironmentSourcesConflictError("both"), "invalid"],
    ["name", new EnvironmentNameInvalidError("bad", "--env"), "invalid"],
    [
      "server",
      new EnvironmentServerInvalidError("bad", ".env", "https://zitadel.example"),
      "invalid",
    ],
    ["file", new EnvironmentFileMissingError("a.env", "gone"), "missing"],
  ] as const)("reports a %s failure by its category", (_name, error, category) => {
    expect(error).toBeInstanceOf(EnvironmentError);
    expect(error.category).toBe(category);
  });

  it("reports a missing file with the code it always had", () => {
    expect(toZitadelError(new EnvironmentFileMissingError("a.env", "gone")).code).toBe(
      "E_VALIDATION",
    );
  });

  it("words the advice for a name that cannot be used", () => {
    const error = new EnvironmentNameInvalidError("bad", "--env");

    expect(toZitadelError(error).hint).toContain("The --env environment name may use only");
  });

  it("words the advice for a server that is not a URL", () => {
    const error = new EnvironmentServerInvalidError("bad", ".env", "https://zitadel.example");

    expect(toZitadelError(error).hint).toBe(
      "Fix or remove ZITADEL_URL in .env; it must be a URL such as https://zitadel.example.",
    );
  });

  it("points an environment with no project at env add", () => {
    const error = new EnvironmentValueMissingError({
      key: "ZITADEL_PROJECT_ID",
      environment: "staging",
      consulted: ["process environment", ".env"],
      file: undefined,
      boundFile: ".env.staging.local",
      unbound: true,
      cwd: process.cwd(),
    });

    expect(toZitadelError(error)).toMatchObject({
      code: "E_VALIDATION",
      hint: expect.stringContaining("Set ZITADEL_PROJECT_ID in .env.staging.local"),
      nextCommands: [{ id: "env:add", args: { name: "staging" }, flags: {} }],
    });
  });
});

describe("the environment errors' codes", () => {
  it("reports a missing file as a validation failure, not a missing thing", () => {
    expect(new EnvironmentFileMissingError("a.env", "why").code).toBe("E_VALIDATION");
  });

  it("reports an invalid input as a validation failure", () => {
    expect(new EnvironmentNameInvalidError("why", "--env").code).toBe("E_VALIDATION");
  });
});
