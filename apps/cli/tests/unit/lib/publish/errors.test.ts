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

describe("the publish errors", () => {
  it.each([
    ["config", new PublishConfigInvalidError("bad"), "invalid", "E_VALIDATION"],
    [
      "missing variable",
      new PublishConnectionVariableMissingError("missing", "GOOGLE_CLIENT_SECRET", true),
      "missing",
      "E_CREDENTIAL_MISSING",
    ],
    [
      "variable of the wrong kind",
      new PublishConnectionVariableKindError("kind", "GOOGLE_CLIENT_ID", false),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "shared variable",
      new PublishConnectionVariableSharedError("shared"),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "literal secret",
      new PublishConnectionSecretLiteralError("literal"),
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
