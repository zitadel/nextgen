import { describe, expect, it } from "vitest";

import {
  BackendConflictError,
  BackendError,
  BackendForbiddenError,
  BackendInternalError,
  BackendNotFoundError,
  BackendOperationError,
  BackendRejectedError,
  BackendUnauthorizedError,
  BackendUnavailableError,
  BackendUnsupportedError,
} from "@/lib/backend/errors";
import { toZitadelError } from "@/lib/errors";

describe("the backend errors", () => {
  it.each([
    ["not found", new BackendNotFoundError("why"), "missing", false],
    ["conflict", new BackendConflictError("why"), "conflict", false],
    ["rejected", new BackendRejectedError("why"), "invalid", false],
    ["unknown operation", new BackendOperationError("unknown", "why"), "missing", false],
    ["ambiguous operation", new BackendOperationError("ambiguous", "why"), "invalid", false],
    ["unsupported", new BackendUnsupportedError("why"), "invalid", false],
    ["fault", new BackendInternalError("why"), "fault", false],
    ["unauthorized", new BackendUnauthorizedError("why"), "denied", false],
    ["forbidden", new BackendForbiddenError("why"), "denied", false],
    ["unavailable", new BackendUnavailableError("why"), "unavailable", true],
  ] as const)("reports a %s failure as %s, retryable %s", (_name, error, category, retryable) => {
    expect(error).toBeInstanceOf(BackendError);
    expect(error).toMatchObject({ category, retryable });
  });

  it("reports a failure no subclass names as unknown and not retryable", () => {
    expect(new BackendError("why")).toMatchObject({ category: "unknown", retryable: false });
  });

  it("reports a server that does not implement the request as an unsupported shape", () => {
    expect(toZitadelError(new BackendUnsupportedError("why")).code).toBe(
      "E_UNSUPPORTED_PROJECT_SHAPE",
    );
  });
});
