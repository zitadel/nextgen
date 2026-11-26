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
