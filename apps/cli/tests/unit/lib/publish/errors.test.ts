import { describe, expect, it } from "vitest";

import { toZitadelError } from "@/lib/errors";
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
  PublishReleaseRejectedError,
} from "@/lib/publish";

describe("the publish errors", () => {
  it.each([
    [
      "config",
      new PublishConfigInvalidError("bad", {
        findings: [],
      }),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "config with a refused key",
      new PublishConfigRefusedKeyError("bad", {
        findings: [],
      }),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "config with a literal secret",
      new PublishConfigLiteralSecretError("bad", {
        findings: [],
      }),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "config with a literal secret and a refused key",
      new PublishConfigLiteralSecretRefusedKeyError("bad", {
        findings: [],
      }),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "shared variable",
      new PublishConnectionVariableSharedError("shared", {
        file: "a.json",
        variable: "X",
      }),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "client secret held plain",
      new PublishConnectionVariableNotSecretError("kind", {
        file: "a.json",
        variable: "X",
      }),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "client id held secret",
      new PublishConnectionVariableNotPlainError("kind", {
        file: "a.json",
        variable: "X",
      }),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "missing client id variable",
      new PublishConnectionVariableClientIdMissingError("missing", {
        file: "a.json",
        variable: "X",
      }),
      "conflict",
      "E_CREDENTIAL_MISSING",
    ],
    [
      "missing client secret variable",
      new PublishConnectionVariableClientSecretMissingError("missing", {
        file: "a.json",
        variable: "X",
      }),
      "conflict",
      "E_CREDENTIAL_MISSING",
    ],
    ["rejected", new PublishReleaseRejectedError("no"), "invalid", "E_VALIDATION"],
  ] as const)("reports a %s failure by its category and code", (_name, error, category, code) => {
    expect(error).toBeInstanceOf(PublishError);
    expect(error.category).toBe(category);
    expect(toZitadelError(error).code).toBe(code);
  });

  it.each([
    ["a config", PublishConfigInvalidError],
    ["a config with a refused key", PublishConfigRefusedKeyError],
    ["a config with a literal secret", PublishConfigLiteralSecretError],
    ["a config with a literal secret and a refused key", PublishConfigLiteralSecretRefusedKeyError],
  ] as const)("keeps the findings of %s as the issues a --json reader sees", (_name, Failure) => {
    const findings = [
      {
        rule: "r",
        path: "a.json",
        message: "bad",
      },
    ];
    const error = new Failure("bad", {
      findings,
    });

    expect(toZitadelError(error).details).toEqual({
      issues: findings,
    });
    expect(toZitadelError(error).nextCommands).toBeUndefined();
  });

  it("carries the file, the variable and the mode a missing variable was named with", () => {
    const error = new PublishConnectionVariableClientIdMissingError("missing", {
      file: "a.json",
      variable: "ID",
      mode: "preview",
    });

    expect(error).toMatchObject({
      file: "a.json",
      variable: "ID",
      mode: "preview",
    });
    expect(toZitadelError(error).nextCommands).toBeUndefined();
  });

  it("keeps the hint of a wrong-kind variable free of flags", () => {
    const error = new PublishConnectionVariableNotSecretError("kind", {
      file: "a.json",
      variable: "X",
    });

    expect(error.hint).not.toContain("--");
  });
});

describe("the publish errors' codes", () => {
  it.each([
    [
      "a missing client id variable",
      new PublishConnectionVariableClientIdMissingError("why", {
        file: "a",
        variable: "B",
      }),
      "E_CREDENTIAL_MISSING",
    ],
    [
      "a missing client secret variable",
      new PublishConnectionVariableClientSecretMissingError("why", {
        file: "a",
        variable: "B",
      }),
      "E_CREDENTIAL_MISSING",
    ],
    [
      "a shared variable",
      new PublishConnectionVariableSharedError("why", {
        file: "a",
        variable: "B",
      }),
      "E_VALIDATION",
    ],
    [
      "a client secret held plain",
      new PublishConnectionVariableNotSecretError("why", {
        file: "a",
        variable: "B",
      }),
      "E_VALIDATION",
    ],
    [
      "a client id held secret",
      new PublishConnectionVariableNotPlainError("why", {
        file: "a",
        variable: "B",
      }),
      "E_VALIDATION",
    ],
  ] as const)("reports %s as %s", (_name, error, code) => {
    expect(error.code).toBe(code);
  });

  it("reports a rejected release as a validation failure", () => {
    expect(new PublishReleaseRejectedError("why").code).toBe("E_VALIDATION");
  });
});
