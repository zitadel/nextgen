import { describe, expect, it } from "vitest";

import {
  PublishConfigInvalidError,
  PublishConfigLiteralSecretError,
  PublishConfigLiteralSecretRefusedKeyError,
  PublishConfigRefusedKeyError,
  PublishConnectionVariableClientIdMissingError,
  PublishConnectionVariableClientSecretMissingError,
  PublishConnectionVariableNotPlainError,
  PublishConnectionVariableNotSecretError,
  PublishConnectionVariableSharedError,
  PublishError,
} from "@/lib/publish";

describe("the publish errors", () => {
  it.each([
    ["config", new PublishConfigInvalidError("bad"), "invalid", "E_VALIDATION"],
    [
      "config with a refused key",
      new PublishConfigRefusedKeyError("bad"),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "config with a literal secret",
      new PublishConfigLiteralSecretError("bad"),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "config with a literal secret and a refused key",
      new PublishConfigLiteralSecretRefusedKeyError("bad"),
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
      "client secret held plain",
      new PublishConnectionVariableNotSecretError("kind", "X"),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "client id held secret",
      new PublishConnectionVariableNotPlainError("kind", "X"),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "missing client id variable",
      new PublishConnectionVariableClientIdMissingError("missing", "X"),
      "conflict",
      "E_CREDENTIAL_MISSING",
    ],
    [
      "missing client secret variable",
      new PublishConnectionVariableClientSecretMissingError("missing", "X"),
      "conflict",
      "E_CREDENTIAL_MISSING",
    ],
  ] as const)("reports a %s failure by its category and code", (_name, error, category, code) => {
    expect(error).toBeInstanceOf(PublishError);
    expect(error.category).toBe(category);
    expect(error.code).toBe(code);
  });
});
