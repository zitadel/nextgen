import { describe, expect, it } from "vitest";

import {
  OrcaError,
  OrcaFrameworkMismatchError,
  OrcaFrameworkMissingError,
  OrcaFrameworkUnsupportedError,
  OrcaInternalError,
  OrcaPatchFileConflictError,
  OrcaPatchFileMissingError,
  OrcaPatchFileOverwriteError,
  OrcaPatchFileUnsupportedError,
  OrcaPatchLayoutConflictError,
  OrcaRendererPendingError,
  OrcaRendererUnknownError,
  OrcaScaffoldBlockedError,
  OrcaScaffoldOccupiedError,
} from "@/lib/orca/errors";

describe("OrcaError", () => {
  it("carries its message, name, hint, details and cause", () => {
    const cause = new Error("underneath");

    const error = new OrcaInternalError("why", {
      hint: "do",
      details: {
        a: 1,
      },
      cause,
    });

    expect(error).toBeInstanceOf(OrcaError);
    expect(error).toMatchObject({
      message: "why",
      name: "OrcaInternalError",
      code: "E_VALIDATION",
      category: "fault",
      hint: "do",
      details: {
        a: 1,
      },
      cause,
    });
  });
});

describe("the orca errors", () => {
  it.each([
    [new OrcaFrameworkMissingError("why"), "OrcaFrameworkMissingError", "missing"],
    [new OrcaFrameworkUnsupportedError("why"), "OrcaFrameworkUnsupportedError", "invalid"],
    [new OrcaFrameworkMismatchError("why"), "OrcaFrameworkMismatchError", "conflict"],
    [new OrcaScaffoldOccupiedError("why"), "OrcaScaffoldOccupiedError", "conflict"],
    [new OrcaScaffoldBlockedError("why"), "OrcaScaffoldBlockedError", "invalid"],
    [new OrcaPatchFileMissingError("why"), "OrcaPatchFileMissingError", "missing"],
    [new OrcaPatchFileConflictError("why"), "OrcaPatchFileConflictError", "conflict"],
    [new OrcaPatchFileOverwriteError("why"), "OrcaPatchFileOverwriteError", "conflict"],
    [new OrcaPatchLayoutConflictError("why"), "OrcaPatchLayoutConflictError", "conflict"],
    [new OrcaPatchFileUnsupportedError("why"), "OrcaPatchFileUnsupportedError", "invalid"],
    [new OrcaRendererUnknownError("why"), "OrcaRendererUnknownError", "invalid"],
    [new OrcaRendererPendingError("why"), "OrcaRendererPendingError", "invalid"],
    [new OrcaInternalError("why"), "OrcaInternalError", "fault"],
  ])("is an OrcaError named %#", (error, name, category) => {
    expect(error).toBeInstanceOf(OrcaError);
    expect(error).toMatchObject({
      name,
      category,
    });
  });
});

describe("the orca errors' codes", () => {
  it.each([
    ["no app", new OrcaFrameworkMissingError("why"), "E_FRAMEWORK_NOT_DETECTED"],
    ["an unsupported app", new OrcaFrameworkUnsupportedError("why"), "E_UNSUPPORTED_PROJECT_SHAPE"],
    ["another framework", new OrcaFrameworkMismatchError("why"), "E_CONFLICT"],
    ["an occupied directory", new OrcaScaffoldOccupiedError("why"), "E_CONFLICT"],
    ["a Node too old", new OrcaScaffoldBlockedError("why"), "E_VALIDATION"],
    ["a missing file", new OrcaPatchFileMissingError("why"), "E_NOT_FOUND"],
    ["a conflicting file", new OrcaPatchFileConflictError("why"), "E_CONFLICT"],
    ["a file it would overwrite", new OrcaPatchFileOverwriteError("why"), "E_CONFLICT"],
    ["a conflicting layout", new OrcaPatchLayoutConflictError("why"), "E_CONFLICT"],
    ["an unknown renderer", new OrcaRendererUnknownError("why"), "E_VALIDATION"],
    ["a pending renderer", new OrcaRendererPendingError("why"), "E_NOT_IMPLEMENTED"],
    ["a bug", new OrcaInternalError("why"), "E_VALIDATION"],
  ] as const)("reports %s as %s", (_name, error, code) => {
    expect(error.code).toBe(code);
  });
});
