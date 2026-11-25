import { describe, expect, it } from "vitest";

import {
  EnvironmentError,
  EnvironmentFileMissingError,
  EnvironmentNameInvalidError,
  EnvironmentServerInvalidError,
  EnvironmentSourcesConflictError,
  EnvironmentValueMissingError,
  EnvironmentValueUnboundError,
} from "@/lib/environment";
import { toZitadelError } from "@/lib/errors";

describe("the environment errors", () => {
  it.each([
    ["both sources", new EnvironmentSourcesConflictError("both"), "invalid"],
    ["name", new EnvironmentNameInvalidError("bad", "--env"), "invalid"],
    [
      "server",
      new EnvironmentServerInvalidError("bad", ".env", "https://zitadel.example"),
      "invalid",
    ],
    ["file", new EnvironmentFileMissingError("gone"), "missing"],
  ] as const)("reports a %s failure by its category", (_name, error, category) => {
    expect(error).toBeInstanceOf(EnvironmentError);
    expect(error.category).toBe(category);
  });

  it("reports a missing file with the code it always had", () => {
    expect(toZitadelError(new EnvironmentFileMissingError("gone")).code).toBe("E_VALIDATION");
  });

  it("words the advice for a name that cannot be used", () => {
    const error = new EnvironmentNameInvalidError("bad", "--env");

    expect(toZitadelError(error).hint).toContain("The --env environment name may use only");
  });

  it("states the server a source supplied and an example of one", () => {
    const error = new EnvironmentServerInvalidError("bad", ".env", "https://zitadel.example");

    expect(error).toMatchObject({
      source: ".env",
      example: "https://zitadel.example",
      hint: "ZITADEL_URL from .env must be a URL such as https://zitadel.example.",
    });
  });

  it("states what an environment with no project lacks, with no advice", () => {
    const error = new EnvironmentValueUnboundError("ZITADEL_PROJECT_ID is not set", {
      key: "ZITADEL_PROJECT_ID",
      environment: "staging",
      consulted: ["process environment", ".env"],
      boundFile: ".env.staging.local",
      cwd: process.cwd(),
    });

    expect(toZitadelError(error)).toMatchObject({
      code: "E_VALIDATION",
      hint: "Consulted, in order: process environment, .env.",
      details: {
        environment: "staging",
        variable: "ZITADEL_PROJECT_ID",
        consulted: ["process environment", ".env"],
      },
    });
    expect(error).toMatchObject({
      boundFile: ".env.staging.local",
    });
    expect(toZitadelError(error).nextCommands).toBeUndefined();
  });

  it("states the file a value belongs in when the environment has a project", () => {
    const error = new EnvironmentValueMissingError("ZITADEL_PROJECT_SECRET is not set", {
      key: "ZITADEL_PROJECT_SECRET",
      environment: "staging",
      consulted: ["process environment", ".env"],
      file: ".env.staging.local",
      boundFile: ".env.staging.local",
      cwd: process.cwd(),
    });

    expect(toZitadelError(error)).toMatchObject({
      code: "E_VALIDATION",
      hint: "Consulted, in order: process environment, .env.",
    });
    expect(error).toMatchObject({
      file: ".env.staging.local",
    });
  });
});

describe("the environment errors' codes", () => {
  it("reports a missing file as a validation failure, not a missing thing", () => {
    expect(new EnvironmentFileMissingError("why").code).toBe("E_VALIDATION");
  });

  it("reports an invalid input as a validation failure", () => {
    expect(new EnvironmentNameInvalidError("why", "--env").code).toBe("E_VALIDATION");
  });
});
