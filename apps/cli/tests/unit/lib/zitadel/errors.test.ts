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

import * as classes from "@/lib/zitadel/errors";

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

describe("what each configuration error states", () => {
  it.each([
    [
      "ZitadelConfigError",
      new classes.ZitadelConfigError("configuration failed"),
      {
        message: "configuration failed",
        hint: undefined,
        details: {},
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigFlowMethodInUseError",
      new classes.ZitadelConfigFlowMethodInUseError("a flow uses it", {
        file: ".zitadel/schemas/customers.json",
        method: "password",
        issues: [],
        uses: [],
      }),
      {
        message: "a flow uses it",
        hint: undefined,
        details: { file: ".zitadel/schemas/customers.json", issues: [], steps: [] },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigFlowBrokenError",
      new classes.ZitadelConfigFlowBrokenError("a flow is broken", {
        file: ".zitadel/flows/login.json",
        issues: [],
      }),
      {
        message: "a flow is broken",
        hint: "Fix the steps named above, then run the command again.",
        details: { file: ".zitadel/flows/login.json", issues: [] },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigFlowUncheckedError",
      new classes.ZitadelConfigFlowUncheckedError("a flow has errors", {
        file: ".zitadel/flows/login.json",
        issues: [],
      }),
      {
        message: "a flow has errors",
        hint: undefined,
        details: { file: ".zitadel/flows/login.json", issues: [] },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigFilesBrokenError",
      new classes.ZitadelConfigFilesBrokenError([
        { path: ".zitadel/a.json", problem: "not JSON" },
        { path: ".zitadel/b.json", problem: "no name" },
      ]),
      {
        message:
          "2 configuration files are not valid:\n  - .zitadel/a.json: not JSON\n  - .zitadel/b.json: no name",
        hint: "Fix the files named above, then run the command again; nothing was changed.",
        details: {
          problems: [
            { path: ".zitadel/a.json", problem: "not JSON" },
            { path: ".zitadel/b.json", problem: "no name" },
          ],
        },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigNothingToDeployError",
      new classes.ZitadelConfigNothingToDeployError(),
      {
        message: "There is nothing in .zitadel/ to deploy",
        hint: undefined,
        details: {},
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigClientIdMismatchError",
      new classes.ZitadelConfigClientIdMismatchError(".zitadel/apps/web.json", "111", "222"),
      {
        message: ".zitadel/apps/web.json already uses client id 111, not 222",
        hint: "Edit the connection file to change its client id, or run the command without one to reuse it.",
        details: {
          file: ".zitadel/apps/web.json",
          stored_client_id: "111",
          supplied_client_id: "222",
        },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigSettingUnusableError",
      new classes.ZitadelConfigSettingUnusableError(
        ".zitadel/apps/web.json",
        "web",
        "redirect URI",
        "is not a URL",
      ),
      {
        message: ".zitadel/apps/web.json holds redirect URI that cannot be used: is not a URL",
        hint: "Fix it in that file, or choose another slug.",
        details: { file: ".zitadel/apps/web.json", slug: "web" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigPathUnreadableError",
      new classes.ZitadelConfigPathUnreadableError(".zitadel/apps", "EACCES", new Error("boom")),
      {
        message: ".zitadel/apps cannot be read (EACCES)",
        hint: "Check that the file is readable, then run the command again.",
        details: { file: ".zitadel/apps", code: "EACCES" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigResourceClashError",
      new classes.ZitadelConfigResourceClashError("two resources clash"),
      {
        message: "two resources clash",
        hint: undefined,
        details: {},
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigConnectionNotOidcError",
      new classes.ZitadelConfigConnectionNotOidcError(".zitadel/connections/github.json", "github"),
      {
        message:
          ".zitadel/connections/github.json is already named github and is not an OIDC connection",
        hint: "Fix the file, or choose another slug, then run the command again.",
        details: { file: ".zitadel/connections/github.json", slug: "github" },
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigConnectionIssuerClashError",
      new classes.ZitadelConfigConnectionIssuerClashError(
        ".zitadel/connections/okta.json",
        "okta",
        "https://a.okta.com",
        "https://b.okta.com",
      ),
      {
        message:
          ".zitadel/connections/okta.json is already named okta and connects to https://b.okta.com, not https://a.okta.com",
        hint: "An applied connection keeps its issuer, and the server compares it exactly, so even a trailing slash names another provider. Choose another slug for this connection, then move the schemas and flows that name the old one to it.",
        details: {
          file: ".zitadel/connections/okta.json",
          slug: "okta",
          issuer: "https://a.okta.com",
          existing_issuer: "https://b.okta.com",
        },
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigConnectionIssuerClashError",
      new classes.ZitadelConfigConnectionIssuerClashError(
        ".zitadel/connections/okta.json",
        "okta",
        "https://a.okta.com",
        undefined,
      ),
      {
        message:
          ".zitadel/connections/okta.json is already named okta and is not an OIDC connection to https://a.okta.com",
        hint: "An applied connection keeps its issuer, and the server compares it exactly, so even a trailing slash names another provider. Choose another slug for this connection, then move the schemas and flows that name the old one to it.",
        details: {
          file: ".zitadel/connections/okta.json",
          slug: "okta",
          issuer: "https://a.okta.com",
          existing_issuer: null,
        },
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigProviderFileTakenError",
      new classes.ZitadelConfigProviderFileTakenError(
        ".zitadel/connections/google.json",
        "google",
        "google-2",
      ),
      {
        message: ".zitadel/connections/google.json already exists and is not the google connection",
        hint: "Rename or remove that file, then run the command again.",
        details: { file: ".zitadel/connections/google.json", slug: "google-2" },
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigConnectionFileTakenError",
      new classes.ZitadelConfigConnectionFileTakenError(
        ".zitadel/connections/okta.json",
        "okta",
        "okta-2",
      ),
      {
        message: ".zitadel/connections/okta.json already exists and is not the okta connection",
        hint: "Rename or remove that file, or choose another slug, then run the command again.",
        details: { file: ".zitadel/connections/okta.json", slug: "okta-2" },
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigResourceMissingError",
      new classes.ZitadelConfigResourceMissingError("no such resource"),
      {
        message: "no such resource",
        hint: undefined,
        details: {},
        code: "E_NOT_FOUND",
        category: "missing",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigSchemaMissingError",
      new classes.ZitadelConfigSchemaMissingError("employees", []),
      {
        message: "There is no user schema under .zitadel/schemas",
        hint: undefined,
        details: { requested: "employees", known: [] },
        code: "E_NOT_FOUND",
        category: "missing",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigSchemaAmbiguousError",
      new classes.ZitadelConfigSchemaAmbiguousError(undefined, []),
      {
        message: "There is more than one user schema, and none was named",
        hint: undefined,
        details: { requested: null, candidates: [] },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigFileExistsError",
      new classes.ZitadelConfigFileExistsError(".zitadel/apps/web.json"),
      {
        message: ".zitadel/apps/web.json already exists",
        hint: "Move or rename the file that is already there, then run the command again.",
        details: { file: ".zitadel/apps/web.json" },
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigConnectionExistsError",
      new classes.ZitadelConfigConnectionExistsError(".zitadel/connections/google.json", {
        kind: "catalog",
        id: "google",
      }),
      {
        message: ".zitadel/connections/google.json already exists",
        hint: "A connection file is yours to keep, so it is never replaced or removed. Remove it to scaffold a fresh one, or keep it and enable the provider to reuse it.",
        details: { file: ".zitadel/connections/google.json" },
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigFileUnreadableError",
      new classes.ZitadelConfigFileUnreadableError(
        ".zitadel/apps/web.json",
        "EACCES",
        new Error("boom"),
      ),
      {
        message: ".zitadel/apps/web.json cannot be read (EACCES)",
        hint: "Check that the file is readable, then run the command again.",
        details: { file: ".zitadel/apps/web.json", code: "EACCES" },
        code: "E_AUTH",
        category: "denied",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigReferenceUnreadableError",
      new classes.ZitadelConfigReferenceUnreadableError(
        ".zitadel/branding.json",
        "./logo.png",
        "EACCES",
        new Error("boom"),
      ),
      {
        message: '$file "./logo.png" cannot be read',
        hint: "Create the referenced file or fix the path.",
        details: { file: ".zitadel/branding.json", code: "EACCES", ref: "./logo.png" },
        code: "E_AUTH",
        category: "denied",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigSchemaExternalError",
      new classes.ZitadelConfigSchemaExternalError(".zitadel/schemas/customers.json"),
      {
        message: ".zitadel/schemas/customers.json points at an external schema",
        hint: "Its sign-in methods live in the schema at its url, which the server fetches. Edit x-auth-methods there instead.",
        details: { file: ".zitadel/schemas/customers.json" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigInternalError",
      new classes.ZitadelConfigInternalError("internal"),
      {
        message: "internal",
        hint: undefined,
        details: {},
        code: "E_VALIDATION",
        category: "fault",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigDocumentDuplicatedError",
      new classes.ZitadelConfigDocumentDuplicatedError("branding", ".zitadel/branding", 2),
      {
        message: "A release carries at most one branding, but .zitadel/branding/ holds 2",
        hint: "A project has a single branding; keep one descriptor under .zitadel/branding/.",
        details: {},
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigPasswordPolicyInvalidError",
      new classes.ZitadelConfigPasswordPolicyInvalidError(".zitadel/policies/password.json"),
      {
        message: ".zitadel/policies/password.json is not a valid password policy",
        hint: undefined,
        details: { file: ".zitadel/policies/password.json" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigSignupPolicyInvalidError",
      new classes.ZitadelConfigSignupPolicyInvalidError(".zitadel/policies/signup.json"),
      {
        message: ".zitadel/policies/signup.json is not a valid sign-up policy",
        hint: undefined,
        details: { file: ".zitadel/policies/signup.json" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigHandleInvalidError",
      new classes.ZitadelConfigHandleInvalidError("Bad Handle"),
      {
        message: '"Bad Handle" cannot be the name of a file',
        hint: "A handle must be a single name, without slashes or dots that climb out of its directory.",
        details: { handle: "Bad Handle" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigHandleClashError",
      new classes.ZitadelConfigHandleClashError("web", [
        ".zitadel/apps/web.json",
        ".zitadel/apps/web-2.json",
      ]),
      {
        message: ".zitadel/apps/web.json and .zitadel/apps/web-2.json both hold web",
        hint: "Remove or fix all but one of them, then run the command again.",
        details: { handle: "web", paths: [".zitadel/apps/web.json", ".zitadel/apps/web-2.json"] },
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigConnectionDuplicatedError",
      new classes.ZitadelConfigConnectionDuplicatedError("google", "Google", [
        ".zitadel/connections/a.json",
        ".zitadel/connections/b.json",
      ]),
      {
        message:
          "More than one Google connection exists: .zitadel/connections/a.json, .zitadel/connections/b.json",
        hint: "Keep the one this project should use and remove the others, then run the command again.",
        details: {
          provider: "google",
          files: [".zitadel/connections/a.json", ".zitadel/connections/b.json"],
        },
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigSlugDuplicatedError",
      new classes.ZitadelConfigSlugDuplicatedError("web", [
        ".zitadel/apps/a.json",
        ".zitadel/apps/b.json",
      ]),
      {
        message:
          "More than one connection is named web: .zitadel/apps/a.json, .zitadel/apps/b.json",
        hint: "A slug names one connection. Remove or rename all but one, then run the command again.",
        details: { slug: "web", files: [".zitadel/apps/a.json", ".zitadel/apps/b.json"] },
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigProviderUnknownError",
      new classes.ZitadelConfigProviderUnknownError(
        "customers",
        "myspace",
        ["google", "github"],
        ["okta"],
      ),
      {
        message: "customers has no provider named myspace",
        hint: "customers offers: google, github. Connections under .zitadel/idps/: okta.",
        details: { requested: "myspace", offered: ["google", "github"], connections: ["okta"] },
        code: "E_NOT_FOUND",
        category: "missing",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigConnectionProviderMismatchError",
      new classes.ZitadelConfigConnectionProviderMismatchError(
        ".zitadel/connections/okta.json",
        "okta",
        "Okta",
        "https://a.okta.com",
      ),
      {
        message:
          ".zitadel/connections/okta.json is a connection called okta, but not to Okta: its issuer is not https://a.okta.com",
        hint: "Point it at the provider if it is that connection. Otherwise change its slug, in the file and in the schemas and flows that name it, then run the command again.",
        details: { file: ".zitadel/connections/okta.json", slug: "okta" },
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigCredentialsDoubledError",
      new classes.ZitadelConfigCredentialsDoubledError("google", "GOOGLE_ID"),
      {
        message: "This connection points both credentials at GOOGLE_ID",
        hint: "Give client_id and client_secret separate ${{ NAME }} references, then run the command again.",
        details: { slug: "google", variable: "GOOGLE_ID" },
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigVariableSharedError",
      new classes.ZitadelConfigVariableSharedError(
        ".zitadel/connections/a.json",
        "a",
        "b",
        "GOOGLE_ID",
      ),
      {
        message: ".zitadel/connections/a.json and a both use GOOGLE_ID",
        hint: "Point one of them at a variable of its own, then run the command again.",
        details: {
          file: ".zitadel/connections/a.json",
          slug: "a",
          other_slug: "b",
          variable: "GOOGLE_ID",
        },
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigRegionUneditableError",
      new classes.ZitadelConfigRegionUneditableError(".zitadel/flows/login.json", "header"),
      {
        message: ".zitadel/flows/login.json: header",
        hint: "This command edits that region, and it is not the shape it edits. Fix it against the dialect in .zitadel/meta/, then run the command again.",
        details: { file: ".zitadel/flows/login.json", region: "header" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigFlowMissingError",
      new classes.ZitadelConfigFlowMissingError("login", ".zitadel/flows/login.json"),
      {
        message: "No login flow runs against login",
        hint: "The provider is offered by a flow, and none of the files under .zitadel/flows/ names this schema. Check that the flow's user_schema names the schema's objectType.",
        details: { schema: ".zitadel/flows/login.json" },
        code: "E_NOT_FOUND",
        category: "missing",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigActionClashError",
      new classes.ZitadelConfigActionClashError("the action clashes", "password", "submit"),
      {
        message: "the action clashes",
        hint: undefined,
        details: { step: "password", action: "submit" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigRenameRouteLossError",
      new classes.ZitadelConfigRenameRouteLossError("password", "submit", "done"),
      {
        message:
          'steps.password: transition "submit" declares purpose or action, which "done" cannot',
        hint: undefined,
        details: { step: "password", transition: "submit" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigIdentifierMissingError",
      new classes.ZitadelConfigIdentifierMissingError(".zitadel/apps/web.json"),
      {
        message: ".zitadel/apps/web.json has no x-identifier for password",
        hint: 'A password is checked against the user found by the schema\'s identifier. Set "x-identifier" to the property users sign in with, e.g. "email", then run the command again.',
        details: { file: ".zitadel/apps/web.json", method: "password" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigReferenceMissingError",
      new classes.ZitadelConfigReferenceMissingError("./logo.png"),
      {
        message: '$file "./logo.png" cannot be read',
        hint: "Create the referenced file or fix the path.",
        details: {},
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigReferenceBrokenError",
      new classes.ZitadelConfigReferenceBrokenError(
        ".zitadel/branding.json",
        "./logo.png",
        "ENOENT",
        new Error("boom"),
      ),
      {
        message: '$file "./logo.png" cannot be read',
        hint: "Create the referenced file or fix the path.",
        details: { file: ".zitadel/branding.json", ref: "./logo.png", code: "ENOENT" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigReferenceOutsideError",
      new classes.ZitadelConfigReferenceOutsideError("../logo.png"),
      {
        message: '$file "../logo.png" points outside the project',
        hint: "Keep referenced files inside the project, next to the file that references them; a symlink on the way must resolve inside the project too.",
        details: {},
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigPathOutsideError",
      new classes.ZitadelConfigPathOutsideError("../apps/web.json"),
      {
        message: "../apps/web.json points outside .zitadel/",
        hint: "Files are only written and removed inside .zitadel/.",
        details: { file: "../apps/web.json" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigPathBlockedError",
      new classes.ZitadelConfigPathBlockedError(".zitadel/apps/web.json", ".zitadel/apps"),
      {
        message: ".zitadel/apps/web.json cannot be written (ENOTDIR)",
        hint: "Remove .zitadel/apps, which is a file where a directory is needed, then run the command again.",
        details: { file: ".zitadel/apps/web.json", code: "ENOTDIR", blocker: ".zitadel/apps" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "ZitadelConfigDirectoryInTheWayError",
      new classes.ZitadelConfigDirectoryInTheWayError(".zitadel/apps/web.json"),
      {
        message: ".zitadel/apps/web.json cannot be removed (EISDIR)",
        hint: "Remove .zitadel/apps/web.json, which is a directory where a file is expected, then run the command again.",
        details: { file: ".zitadel/apps/web.json", code: "EISDIR" },
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
