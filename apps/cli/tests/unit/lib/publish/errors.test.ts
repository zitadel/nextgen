import { toZitadelError } from "@/lib/errors";
import { describe, expect, it } from "vitest";

import {
  PublishConfigInvalidError,
  PublishConnectionVariableKindError,
  PublishConnectionVariableMissingError,
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
        literalSecret: false,
        refusedKey: false,
      }),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "shared variable",
      new PublishConnectionVariableSharedError("shared", { file: "a.json", variable: "X" }),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "wrong kind",
      new PublishConnectionVariableKindError("kind", { file: "a.json", variable: "X" }),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "missing variable",
      new PublishConnectionVariableMissingError("missing", { file: "a.json", variable: "X" }),
      "conflict",
      "E_CREDENTIAL_MISSING",
    ],
    ["rejected", new PublishReleaseRejectedError("no"), "invalid", "E_VALIDATION"],
  ] as const)("reports a %s failure by its category and code", (_name, error, category, code) => {
    expect(error).toBeInstanceOf(PublishError);
    expect(error.category).toBe(category);
    expect(toZitadelError(error).code).toBe(code);
  });

  it("keeps its findings as the issues a --json reader sees", () => {
    const findings = [{ rule: "r", path: "a.json", message: "bad" }];
    const error = new PublishConfigInvalidError("bad", {
      findings,
      literalSecret: false,
      refusedKey: false,
    });

    expect(toZitadelError(error).details).toEqual({ issues: findings });
  });

  it("states a literal secret and a refused key as facts, with no command to run", () => {
    const error = new PublishConfigInvalidError("bad", {
      findings: [],
      literalSecret: true,
      refusedKey: true,
    });

    expect(error).toMatchObject({ literalSecret: true, refusedKey: true });
    expect(toZitadelError(error).nextCommands).toBeUndefined();
  });

  it("carries the variable, the field and the mode a missing variable was named with", () => {
    const error = new PublishConnectionVariableMissingError("missing", {
      file: "a.json",
      field: "client_id",
      variable: "ID",
      mode: "preview",
    });

    expect(error).toMatchObject({
      file: "a.json",
      field: "client_id",
      variable: "ID",
      mode: "preview",
    });
    expect(toZitadelError(error).nextCommands).toBeUndefined();
  });

  it("keeps the hint of a wrong-kind variable free of flags", () => {
    const error = new PublishConnectionVariableKindError("kind", {
      file: "a.json",
      variable: "X",
    });

    expect(error.hint).not.toContain("--");
  });
});

describe("the publish errors' codes", () => {
  it.each([
    [
      "a missing variable",
      new PublishConnectionVariableMissingError("why", { file: "a", variable: "B" }),
      "E_CREDENTIAL_MISSING",
    ],
    [
      "a shared variable",
      new PublishConnectionVariableSharedError("why", { file: "a", variable: "B" }),
      "E_VALIDATION",
    ],
    [
      "a variable of the wrong kind",
      new PublishConnectionVariableKindError("why", { file: "a", variable: "B" }),
      "E_VALIDATION",
    ],
  ] as const)("reports %s as %s", (_name, error, code) => {
    expect(error.code).toBe(code);
  });

  it("reports a rejected release as a validation failure", () => {
    expect(new PublishReleaseRejectedError("why").code).toBe("E_VALIDATION");
  });
});
