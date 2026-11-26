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
    ["config", new PublishConfigInvalidError("bad", []), "invalid", "E_VALIDATION"],
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
      new PublishConnectionSecretLiteralError("literal", []),
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
