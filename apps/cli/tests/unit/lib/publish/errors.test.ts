import { describe, expect, it } from "vitest";

import { toZitadelError } from "@/lib/errors";
import {
  PublishConfigInvalidError,
  PublishConnectionError,
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
      new PublishConnectionError("shared-variable", "shared", { file: "a.json", variable: "X" }),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "wrong kind",
      new PublishConnectionError("wrong-kind", "kind", { file: "a.json", variable: "X" }),
      "invalid",
      "E_VALIDATION",
    ],
    [
      "missing variable",
      new PublishConnectionError("missing-variable", "missing", { file: "a.json", variable: "X" }),
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

  it("words the hint of a literal secret with the command that publishes one", () => {
    const error = new PublishConfigInvalidError("bad", {
      findings: [],
      literalSecret: true,
      refusedKey: true,
    });

    expect(toZitadelError(error)).toMatchObject({
      hint: expect.stringContaining("A key a newer Zitadel server added"),
      nextCommands: [{ id: "variable:set", args: { name: "NAME" }, flags: { secret: true } }],
    });
  });

  it("suggests publishing a missing variable as a preview one in a preview", () => {
    const error = new PublishConnectionError("missing-variable", "missing", {
      file: "a.json",
      field: "client_id",
      variable: "ID",
      mode: "preview",
    });

    expect(toZitadelError(error).nextCommands).toEqual([
      { id: "variable:set", args: { name: "ID" }, flags: { secret: false, preview: true } },
    ]);
  });

  it("keeps the hint of the library free of command names", () => {
    const error = new PublishConnectionError("wrong-kind", "kind", {
      file: "a.json",
      variable: "X",
    });

    expect(error.hint).toBeUndefined();
  });
});
