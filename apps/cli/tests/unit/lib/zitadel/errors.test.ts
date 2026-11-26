import { describe, expect, it } from "vitest";

import {
  CONFIG_DIRECTORIES,
  ZitadelConfigActionClashError,
  ZitadelConfigConnectionExistsError,
  ZitadelConfigDirectoryInTheWayError,
  ZitadelConfigEditLockoutError,
  ZitadelConfigError,
  ZitadelConfigFileExistsError,
  ZitadelConfigFileUnreadableError,
  ZitadelConfigFlowMethodInUseError,
  ZitadelConfigFlowUncheckedError,
  ZitadelConfigInternalError,
  ZitadelConfigPathBlockedError,
  ZitadelConfigPathUnreadableError,
  ZitadelConfigProviderUnknownError,
  ZitadelConfigReferenceBrokenError,
  ZitadelConfigReferenceMissingError,
  ZitadelConfigResourceClashError,
  ZitadelConfigResourceMissingError,
  ZitadelConfigSchemaAmbiguousError,
  ZitadelConfigSchemaMissingError,
  ZitadelConfigSlugDuplicatedError,
} from "@/lib/zitadel";
import { googleSelection } from "@tests/helpers/idp-values";

/**
 * The schema whose change would break a flow.
 */
const SCHEMA_PATH = `${CONFIG_DIRECTORIES.schemas}/customers.json`;

/**
 * The Google connection's file.
 */
const GOOGLE_PATH = `${CONFIG_DIRECTORIES.connections}/google.json`;

/**
 * What a schema left with no way to sign in is refused with.
 */
const NO_SIGN_IN_LEFT = {
  path: SCHEMA_PATH,
  schema: "customers",
  disabling: "password",
  usable: ["password"],
  alternatives: ["passkey"],
};

describe("ZitadelConfigEditLockoutError", () => {
  it("names the schema that would have no way to sign in", () => {
    const error = new ZitadelConfigEditLockoutError(NO_SIGN_IN_LEFT);

    expect(error.message).toBe(`${SCHEMA_PATH} would have no way to sign in left`);
  });

  it("keeps what it enabled and its alternatives", () => {
    const error = new ZitadelConfigEditLockoutError(NO_SIGN_IN_LEFT);

    expect(error).toMatchObject({
      usable: ["password"],
      alternatives: ["passkey"],
    });
  });
});

describe("ZitadelConfigConnectionExistsError", () => {
  it("is a conflict", () => {
    const error = new ZitadelConfigConnectionExistsError(GOOGLE_PATH, googleSelection);

    expect(error).toMatchObject({
      category: "conflict",
    });
  });

  it("says the connection file is already there", () => {
    const error = new ZitadelConfigConnectionExistsError(GOOGLE_PATH, googleSelection);

    expect(error.message).toBe(`${GOOGLE_PATH} already exists`);
  });

  it("keeps the provider as it was chosen", () => {
    const error = new ZitadelConfigConnectionExistsError(GOOGLE_PATH, googleSelection);

    expect(error.selection).toBe(googleSelection);
  });
});

describe("ZitadelConfigFileExistsError", () => {
  it("is a conflict", () => {
    const error = new ZitadelConfigFileExistsError(GOOGLE_PATH);

    expect(error).toMatchObject({
      category: "conflict",
    });
  });

  it("keeps the path that is already taken", () => {
    const error = new ZitadelConfigFileExistsError(GOOGLE_PATH);

    expect(error.path).toBe(GOOGLE_PATH);
  });
});

describe("ZitadelConfigFileUnreadableError", () => {
  it("is a denied failure when the permission is refused", () => {
    expect(new ZitadelConfigFileUnreadableError("x.json", "EACCES")).toMatchObject({
      category: "denied",
      code: "E_AUTH",
    });
  });

  it("names the path and the error code in its message", () => {
    expect(new ZitadelConfigFileUnreadableError("x.json", "EPERM")).toMatchObject({
      message: "x.json cannot be read (EPERM)",
      path: "x.json",
      errno: "EPERM",
    });
  });
});

describe("ZitadelConfigPathUnreadableError", () => {
  it("names the error code in its message when there is one", () => {
    expect(new ZitadelConfigPathUnreadableError("x.json", "EIO")).toMatchObject({
      message: "x.json cannot be read (EIO)",
      code: "E_VALIDATION",
    });
  });

  it("leaves the code out of its message when there is none", () => {
    expect(new ZitadelConfigPathUnreadableError("x.json", undefined)).toMatchObject({
      message: "x.json cannot be read",
    });
  });
});

describe("ZitadelConfigFlowMethodInUseError", () => {
  it("is a validation failure", () => {
    expect(
      new ZitadelConfigFlowMethodInUseError("a flow uses it", {
        file: ".zitadel/schemas/customers.json",
        method: "password",
        issues: [],
        uses: [],
      }),
    ).toMatchObject({
      category: "invalid",
      code: "E_VALIDATION",
    });
  });
});

describe("ZitadelConfigFlowUncheckedError", () => {
  it("is a validation failure", () => {
    expect(
      new ZitadelConfigFlowUncheckedError("a flow has errors", { file: "user.json", issues: [] }),
    ).toMatchObject({
      category: "invalid",
      code: "E_VALIDATION",
    });
  });
});

describe("ZitadelConfigInternalError", () => {
  it("is an internal failure", () => {
    expect(new ZitadelConfigInternalError("not an object")).toMatchObject({
      category: "fault",
    });
  });
});

describe("ZitadelConfigError", () => {
  it("is a validation failure that carries the cause it was given", () => {
    const cause = new Error("root");
    const error = new ZitadelConfigError("boom", cause);

    expect(error).toMatchObject({
      name: "ZitadelConfigError",
      category: "invalid",
      retryable: false,
      code: "E_VALIDATION",
      cause,
    });
  });
});

describe("ZitadelConfigResourceClashError", () => {
  it("is a conflict", () => {
    expect(new ZitadelConfigResourceClashError("two with one slug")).toMatchObject({
      category: "conflict",
      code: "E_CONFLICT",
    });
  });
});

describe("ZitadelConfigResourceMissingError", () => {
  it("is a missing failure", () => {
    expect(new ZitadelConfigResourceMissingError("no such connection")).toMatchObject({
      category: "missing",
      code: "E_NOT_FOUND",
    });
  });
});

describe("ZitadelConfigSchemaMissingError", () => {
  it("is a missing failure that says no schema is named so", () => {
    const error = new ZitadelConfigSchemaMissingError("employees", []);

    expect(error).toBeInstanceOf(ZitadelConfigResourceMissingError);
    expect(error).toMatchObject({
      category: "missing",
      code: "E_NOT_FOUND",
      message: "There is no user schema under .zitadel/schemas",
      known: [],
    });
  });
});

describe("ZitadelConfigSchemaAmbiguousError", () => {
  it("is a validation failure that names the name asked for", () => {
    const error = new ZitadelConfigSchemaAmbiguousError("customers", []);

    expect(error).toMatchObject({
      category: "invalid",
      code: "E_VALIDATION",
      message: "More than one user schema is named customers",
      candidates: [],
    });
  });
});

describe("what a config error states", () => {
  it("reports a project file as file and the system's code as code", () => {
    expect(new ZitadelConfigFileUnreadableError(".zitadel/a.json", "EACCES")).toMatchObject({
      hint: "Check that the file is readable, then run the command again.",
      details: { file: ".zitadel/a.json", code: "EACCES" },
    });
  });

  it("names the providers a schema offers and the connections there are", () => {
    expect(new ZitadelConfigProviderUnknownError("user", "acme", [], ["sso"])).toMatchObject({
      hint: "user offers: none. Connections under .zitadel/idps/: sso.",
      details: { requested: "acme", offered: [], connections: ["sso"] },
    });
  });

  it("reports the files a duplicated slug is in", () => {
    expect(new ZitadelConfigSlugDuplicatedError("sso", ["a.json", "b.json"]).details).toEqual({
      slug: "sso",
      files: ["a.json", "b.json"],
    });
  });

  it.each([
    [
      "a file where a directory is needed",
      new ZitadelConfigPathBlockedError(".zitadel/s/a.json", ".zitadel/s"),
      "Remove .zitadel/s, which is a file where a directory is needed, then run the command again.",
      { file: ".zitadel/s/a.json", code: "ENOTDIR", blocker: ".zitadel/s" },
    ],
    [
      "a directory where a file is expected",
      new ZitadelConfigDirectoryInTheWayError(".zitadel/a.json"),
      "Remove .zitadel/a.json, which is a directory where a file is expected, then run the command again.",
      { file: ".zitadel/a.json", code: "EISDIR" },
    ],
    [
      "a reference it cannot read",
      new ZitadelConfigReferenceMissingError("./a.txt"),
      "Create the referenced file or fix the path.",
      {},
    ],
    [
      "a reference that failed without a code",
      new ZitadelConfigReferenceBrokenError(".zitadel/a.json", "./a.txt", undefined),
      "Create the referenced file or fix the path.",
      { file: ".zitadel/a.json", ref: "./a.txt" },
    ],
  ] as const)("states the hint and facts of %s", (_situation, error, hint, details) => {
    expect(error).toMatchObject({ hint, details });
    expect(error.details).toEqual(details);
  });

  it("reports the step and the action a clash is about", () => {
    expect(new ZitadelConfigActionClashError("clash", "password", "sso").details).toEqual({
      step: "password",
      action: "sso",
    });
  });
});
