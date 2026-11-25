import { describe, expect, it } from "vitest";

import {
  OrcaError,
  OrcaFrameworkError,
  OrcaInternalError,
  OrcaPatchFileConflictError,
  OrcaPatchFileMissingError,
  OrcaPatchFileUnsupportedError,
  OrcaRendererError,
  OrcaScaffoldBlockedError,
} from "@/lib/orca/errors";

describe("OrcaError", () => {
  it("carries its message, name, hint, details and cause", () => {
    const cause = new Error("underneath");

    expect(new OrcaError("why", { hint: "do", details: { a: 1 }, cause })).toMatchObject({
      message: "why",
      name: "OrcaError",
      category: "invalid",
      hint: "do",
      details: { a: 1 },
      cause,
    });
  });
});

describe("the orca errors", () => {
  it.each([
    [new OrcaFrameworkError("none", "why"), "OrcaFrameworkError", "missing"],
    [new OrcaPatchFileMissingError("why"), "OrcaPatchFileMissingError", "missing"],
    [new OrcaPatchFileConflictError("why"), "OrcaPatchFileConflictError", "conflict"],
    [new OrcaPatchFileUnsupportedError("why"), "OrcaPatchFileUnsupportedError", "invalid"],
    [new OrcaInternalError("why"), "OrcaInternalError", "fault"],
  ])("is an OrcaError named %#", (error, name, category) => {
    expect(error).toBeInstanceOf(OrcaError);
    expect(error).toMatchObject({ name, category });
  });

  it.each([
    ["none", "missing", true],
    ["unknown", "invalid", true],
    ["layout", "invalid", false],
    ["outdated", "invalid", false],
    ["mismatch", "conflict", false],
  ] as const)(
    "a framework error for %s is %s, scaffoldable %s",
    (reason, category, scaffoldable) => {
      expect(new OrcaFrameworkError(reason, "why")).toMatchObject({
        reason,
        category,
        scaffoldable,
      });
    },
  );

  it.each([
    ["occupied", "conflict"],
    ["node", "invalid"],
    ["command", "invalid"],
  ] as const)("a blocked scaffold for %s is %s", (reason, category) => {
    expect(new OrcaScaffoldBlockedError(reason, "why")).toMatchObject({ reason, category });
  });

  it.each([
    ["unknown", "invalid"],
    ["pending", "invalid"],
  ] as const)("a renderer error for %s is %s", (reason, category) => {
    expect(new OrcaRendererError(reason, "why")).toMatchObject({ reason, category });
  });

  it("a file conflict says whether replacing files would resolve it", () => {
    expect(new OrcaPatchFileConflictError("why").force).toBe("none");
    expect(new OrcaPatchFileConflictError("why", { force: "replaces" }).force).toBe("replaces");
  });
});
