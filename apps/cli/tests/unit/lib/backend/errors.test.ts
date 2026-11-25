import { describe, expect, it } from "vitest";

import {
  BackendConflictError,
  BackendError,
  BackendForbiddenError,
  BackendInternalError,
  BackendNotFoundError,
  BackendOperationAmbiguousError,
  BackendOperationUnknownError,
  BackendRejectedError,
  BackendUnauthorizedError,
  BackendUnavailableError,
} from "@/lib/backend/errors";

describe("the backend errors", () => {
  it.each([
    ["not found", new BackendNotFoundError("why"), "missing", false],
    ["conflict", new BackendConflictError("why"), "conflict", false],
    ["rejected", new BackendRejectedError("why"), "invalid", false],
    ["unknown operation", new BackendOperationUnknownError("why"), "missing", false],
    ["ambiguous operation", new BackendOperationAmbiguousError("why"), "invalid", false],
    ["fault", new BackendInternalError("why"), "fault", false],
    ["unauthorized", new BackendUnauthorizedError("why"), "denied", false],
    ["forbidden", new BackendForbiddenError("why"), "denied", false],
    ["unavailable", new BackendUnavailableError("why"), "unavailable", true],
  ] as const)("reports a %s failure as %s, retryable %s", (_name, error, category, retryable) => {
    expect(error).toBeInstanceOf(BackendError);
    expect(error).toMatchObject({
      category,
      retryable,
    });
  });

  it("reports a failure no subclass names as unknown and not retryable", () => {
    expect(new BackendError("why")).toMatchObject({
      category: "unknown",
      retryable: false,
    });
  });
});

describe("the backend errors' codes, hints and details", () => {
  it.each([
    [new BackendNotFoundError("why"), "E_NOT_FOUND"],
    [new BackendConflictError("why"), "E_CONFLICT"],
    [new BackendUnavailableError("why"), "E_NETWORK"],
  ] as const)("reports %# with its code", (error, code) => {
    expect(error.code).toBe(code);
  });

  it("carries why a request got no usable response", () => {
    expect(new BackendUnavailableError("why", { reason: "timeout" }).reason).toBe("timeout");
  });
});
