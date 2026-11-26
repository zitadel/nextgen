import { describe, expect, it } from "vitest";

import {
  PublishAssetTargetUnsafeError,
  PublishConfigInvalidError,
  PublishConnectionSecretLiteralError,
  PublishConnectionVariableKindError,
  PublishConnectionVariableMissingError,
  PublishConnectionVariableSharedError,
  PublishError,
} from "@/lib/publish";

import * as classes from "@/lib/publish/errors";

/** How a connection names its client secret, for the errors about its variable. */
const SECRET_USE = {
  variable: "GOOGLE_CLIENT_SECRET",
  field: "client_secret",
  file: ".zitadel/idps/google.json",
  secret: true,
  preview: false,
} as const;

describe("the publish errors", () => {
  it.each([
    ["config", new PublishConfigInvalidError("bad", [], false), "invalid", "E_VALIDATION"],
    [
      "missing variable",
      new PublishConnectionVariableMissingError("missing", SECRET_USE),
      "missing",
      "E_CREDENTIAL_MISSING",
    ],
    [
      "variable of the wrong kind",
      new PublishConnectionVariableKindError("kind", SECRET_USE),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "shared variable",
      new PublishConnectionVariableSharedError("shared", "GOOGLE_CLIENT", SECRET_USE.file),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "literal secret",
      new PublishConnectionSecretLiteralError("literal", [], false),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "unsafe asset target",
      new PublishAssetTargetUnsafeError("private"),
      "invalid",
      "E_VALIDATION",
    ],
  ] as const)("reports a %s failure by its category and code", (_name, error, category, code) => {
    expect(error).toBeInstanceOf(PublishError);
    expect(error.category).toBe(category);
    expect(error.code).toBe(code);
  });
});

describe("what a publish error states", () => {
  it.each([
    [false, "Fix the files named above and rerun; no changes were made."],
    [
      true,
      "Fix the files named above and rerun; no changes were made. A key a newer Zitadel server added needs a CLI as new as the server.",
    ],
  ] as const)("says what to fix of a configuration that refuses a key: %s", (refusedKey, hint) => {
    const error = new PublishConfigInvalidError("invalid", [{ rule: "r" }], refusedKey);

    expect(error).toMatchObject({ hint, details: { issues: [{ rule: "r" }] } });
  });

  it("says to give a client id and secret their own variables", () => {
    expect(new PublishConnectionVariableSharedError("shared", "V", "f.json").hint).toBe(
      "Give each its own variable: a plain one for the client id, a secret one for the client secret.",
    );
  });
});

describe("what each publish error states", () => {
  it.each([
    [
      "PublishConfigInvalidError",
      new classes.PublishConfigInvalidError(
        "the release is invalid",
        [{ path: ["name"], message: "required" }],
        false,
      ),
      {
        message: "the release is invalid",
        hint: "Fix the files named above and rerun; no changes were made.",
        details: { issues: [{ path: ["name"], message: "required" }] },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "PublishConfigInvalidError",
      new classes.PublishConfigInvalidError("the release is invalid", [], true),
      {
        message: "the release is invalid",
        hint: "Fix the files named above and rerun; no changes were made. A key a newer Zitadel server added needs a CLI as new as the server.",
        details: { issues: [] },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "PublishReleaseBodyInvalidError",
      new classes.PublishReleaseBodyInvalidError("the release body is invalid", [
        { path: ["files"], message: "required" },
      ]),
      {
        message: "the release body is invalid",
        hint: undefined,
        details: { issues: [{ path: ["files"], message: "required" }] },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "PublishConnectionSecretLiteralError",
      new classes.PublishConnectionSecretLiteralError("a secret is written out", [], true),
      {
        message: "a secret is written out",
        hint: undefined,
        details: { issues: [], refused_key: true },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "PublishConnectionVariableSharedError",
      new classes.PublishConnectionVariableSharedError(
        "GOOGLE_ID is shared",
        "GOOGLE_ID",
        ".zitadel/connections/google.json",
      ),
      {
        message: "GOOGLE_ID is shared",
        hint: "Give each its own variable: a plain one for the client id, a secret one for the client secret.",
        details: { variable: "GOOGLE_ID", file: ".zitadel/connections/google.json" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "PublishConnectionVariableMissingError",
      new classes.PublishConnectionVariableMissingError("GOOGLE_ID is missing", {
        variable: "GOOGLE_ID",
        field: "client_id",
        file: ".zitadel/connections/google.json",
        secret: false,
        preview: false,
      }),
      {
        message: "GOOGLE_ID is missing",
        hint: undefined,
        details: {
          variable: "GOOGLE_ID",
          field: "client_id",
          file: ".zitadel/connections/google.json",
          secret: false,
          preview: false,
        },
        code: "E_CREDENTIAL_MISSING",
        category: "missing",
        retryable: false,
      },
    ],
    [
      "PublishConnectionVariableMissingError",
      new classes.PublishConnectionVariableMissingError("GOOGLE_SECRET is missing", {
        variable: "GOOGLE_SECRET",
        field: "client_secret",
        file: ".zitadel/connections/google.json",
        secret: true,
        preview: true,
      }),
      {
        message: "GOOGLE_SECRET is missing",
        hint: undefined,
        details: {
          variable: "GOOGLE_SECRET",
          field: "client_secret",
          file: ".zitadel/connections/google.json",
          secret: true,
          preview: true,
        },
        code: "E_CREDENTIAL_MISSING",
        category: "missing",
        retryable: false,
      },
    ],
    [
      "PublishConnectionVariableKindError",
      new classes.PublishConnectionVariableKindError("GOOGLE_SECRET is not a secret", {
        variable: "GOOGLE_SECRET",
        field: "client_secret",
        file: ".zitadel/connections/google.json",
        secret: true,
        preview: false,
      }),
      {
        message: "GOOGLE_SECRET is not a secret",
        hint: undefined,
        details: {
          variable: "GOOGLE_SECRET",
          field: "client_secret",
          file: ".zitadel/connections/google.json",
          secret: true,
          preview: false,
        },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "PublishAssetTargetUnsafeError",
      new classes.PublishAssetTargetUnsafeError("../logo.png escapes the project"),
      {
        message: "../logo.png escapes the project",
        hint: undefined,
        details: {
          original: {
            name: "PublishAssetTargetUnsafeError",
            message: "../logo.png escapes the project",
            code: undefined,
          },
        },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "PublishAssetLookupFailedError",
      new classes.PublishAssetLookupFailedError("cannot look up logo.png", new Error("boom")),
      {
        message: "cannot look up logo.png",
        hint: undefined,
        details: { original: { name: "Error", message: "boom", code: undefined } },
        code: "E_NETWORK",
        category: "unavailable",
        retryable: true,
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
