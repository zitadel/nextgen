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

import * as classes from "@/lib/environment/errors";

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

describe("what an environment error states", () => {
  it("says where to fix a server address that is no URL", () => {
    const error = new EnvironmentValueInvalidError(
      "ZITADEL_URL is not a server",
      ".env.ci.local",
      new LocalServerUrlInvalidError("Invalid server"),
    );

    expect(error).toMatchObject({
      hint: "Fix or remove ZITADEL_URL in .env.ci.local; it must be a URL such as https://preview.zitadel.com.",
      details: { cause: "Invalid server" },
    });
  });
});

describe("what each environment error states", () => {
  it.each([
    [
      "EnvironmentSourcesConflictError",
      new classes.EnvironmentSourcesConflictError("both --env and ZITADEL_ENV are set"),
      {
        message: "both --env and ZITADEL_ENV are set",
        hint: undefined,
        details: {},
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "EnvironmentNameInvalidError",
      new classes.EnvironmentNameInvalidError("staging! is not a name", "--env"),
      {
        message: "staging! is not a name",
        hint: undefined,
        details: { source: "--env" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "EnvironmentFileMissingError",
      new classes.EnvironmentFileMissingError(".env.staging is missing"),
      {
        message: ".env.staging is missing",
        hint: undefined,
        details: {},
        code: "E_VALIDATION",
        category: "missing",
        retryable: false,
      },
    ],
    [
      "EnvironmentValueMissingError",
      new classes.EnvironmentValueMissingError("GOOGLE_ID is not set", {
        environment: "staging",
        variable: "GOOGLE_ID",
        consulted: [".env.staging", "process"],
        file: ".env.staging",
      }),
      {
        message: "GOOGLE_ID is not set",
        hint: "Consulted, in order: .env.staging, process. Set GOOGLE_ID in .env.staging or the process environment.",
        details: {
          environment: "staging",
          variable: "GOOGLE_ID",
          consulted: [".env.staging", "process"],
          file: ".env.staging",
        },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "EnvironmentValueInvalidError",
      new classes.EnvironmentValueInvalidError(
        "ZITADEL_ENV is invalid",
        "ZITADEL_ENV",
        new classes.EnvironmentFileMissingError("missing"),
      ),
      {
        message: "ZITADEL_ENV is invalid",
        hint: "Fix or remove ZITADEL_URL in ZITADEL_ENV; it must be a URL such as https://preview.zitadel.com.",
        details: { cause: "missing" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "EnvironmentValueUnboundError",
      new classes.EnvironmentValueUnboundError("GOOGLE_ID is not bound", {
        environment: "staging",
        variable: "GOOGLE_ID",
        consulted: [],
        file: ".env.staging",
      }),
      {
        message: "GOOGLE_ID is not bound",
        hint: "Consulted, in order: . Set GOOGLE_ID in .env.staging or the process environment.",
        details: {
          environment: "staging",
          variable: "GOOGLE_ID",
          consulted: [],
          file: ".env.staging",
        },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
  ])("states what a %s says and reports", (_name, error, expected) => {
    expect({
      message: error.message,
      hint: error.hint,
      details: error.details,
      code: error.code,
      category: error.category,
      retryable: error.retryable,
    }).toEqual(expected);
  });
});
