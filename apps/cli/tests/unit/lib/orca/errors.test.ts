import { describe, expect, it } from "vitest";

import {
  OrcaError,
  OrcaFrameworkMismatchError,
  OrcaFrameworkMissingError,
  OrcaFrameworkUnsupportedError,
  OrcaInternalError,
  OrcaInvalidError,
  OrcaPatchFileMissingError,
  OrcaPatchFileOverwriteError,
  OrcaPatchLayoutConflictError,
  OrcaRendererPendingError,
  OrcaScaffoldOccupiedError,
} from "@/lib/orca/errors";

describe("OrcaError", () => {
  it("carries its message, name and cause", () => {
    const cause = new Error("underneath");

    const error = new OrcaInternalError("why", cause);

    expect(error).toBeInstanceOf(OrcaError);
    expect(error).toMatchObject({
      message: "why",
      name: "OrcaInternalError",
      code: "E_VALIDATION",
      category: "fault",
      cause,
    });
  });
});

describe("the orca errors", () => {
  it.each([
    [new OrcaFrameworkMissingError("why"), "OrcaFrameworkMissingError", "missing"],
    [new OrcaFrameworkUnsupportedError("why"), "OrcaFrameworkUnsupportedError", "invalid"],
    [
      new OrcaFrameworkMismatchError("why", "react", "next"),
      "OrcaFrameworkMismatchError",
      "conflict",
    ],
    [new OrcaScaffoldOccupiedError("why"), "OrcaScaffoldOccupiedError", "conflict"],
    [new OrcaPatchFileMissingError("why"), "OrcaPatchFileMissingError", "missing"],
    [new OrcaPatchFileOverwriteError("why"), "OrcaPatchFileOverwriteError", "conflict"],
    [new OrcaPatchLayoutConflictError("why"), "OrcaPatchLayoutConflictError", "conflict"],
    [new OrcaInvalidError("why"), "OrcaInvalidError", "invalid"],
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
    ["another framework", new OrcaFrameworkMismatchError("why", "react", "next"), "E_CONFLICT"],
    ["an occupied directory", new OrcaScaffoldOccupiedError("why"), "E_CONFLICT"],
    ["an invalid request", new OrcaInvalidError("why"), "E_VALIDATION"],
    ["a missing file", new OrcaPatchFileMissingError("why"), "E_VALIDATION"],
    ["a file it would overwrite", new OrcaPatchFileOverwriteError("why"), "E_CONFLICT"],
    ["a conflicting layout", new OrcaPatchLayoutConflictError("why"), "E_CONFLICT"],
    ["a pending renderer", new OrcaRendererPendingError("why"), "E_NOT_IMPLEMENTED"],
    ["a bug", new OrcaInternalError("why"), "E_VALIDATION"],
  ] as const)("reports %s as %s", (_name, error, code) => {
    expect(error.code).toBe(code);
  });
});

describe("the orca framework mismatch", () => {
  it("keeps the framework asked for and the one detected", () => {
    const error = new OrcaFrameworkMismatchError("why", "react", "next");

    expect(error).toMatchObject({
      requested: "react",
      detected: "next",
    });
  });
});
