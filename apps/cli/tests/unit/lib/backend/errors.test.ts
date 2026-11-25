import { describe, expect, it } from "vitest";

import {
  BackendClaimChallengeNotFoundError,
  BackendClaimWindowExpiredError,
  BackendConflictError,
  BackendError,
  BackendForbiddenError,
  BackendGoneError,
  BackendInternalError,
  BackendNotFoundError,
  BackendOperationAmbiguousError,
  BackendOperationUnknownError,
  BackendProofRejectedError,
  BackendRejectedError,
  BackendReleaseInUseError,
  BackendReleaseRevokedError,
  BackendRequestInvalidError,
  BackendTooManyRequestsError,
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
    ["gone", new BackendGoneError("why"), "missing", false],
    ["claim window expired", new BackendClaimWindowExpiredError("why"), "missing", false],
    ["claim challenge not found", new BackendClaimChallengeNotFoundError("why"), "missing", false],
    ["release revoked", new BackendReleaseRevokedError("why"), "conflict", false],
    ["release in use", new BackendReleaseInUseError("why"), "conflict", false],
    ["proof rejected", new BackendProofRejectedError("why"), "conflict", false],
    ["request invalid", new BackendRequestInvalidError("why"), "invalid", false],
    ["too many requests", new BackendTooManyRequestsError("why"), "unavailable", true],
  ] as const)("reports a %s failure as %s, retryable %s", (_name, error, category, retryable) => {
    expect(error).toBeInstanceOf(BackendError);
    expect(error).toMatchObject({
      category,
      retryable,
    });
  });
});

describe("the backend errors' codes", () => {
  it.each([
    [new BackendNotFoundError("why"), "E_NOT_FOUND"],
    [new BackendConflictError("why"), "E_CONFLICT"],
    [new BackendUnavailableError("why"), "E_NETWORK"],
    [new BackendGoneError("why"), "E_NOT_FOUND"],
    [new BackendReleaseInUseError("why"), "E_CONFLICT"],
    [new BackendTooManyRequestsError("why"), "E_NETWORK"],
    [new BackendRequestInvalidError("why"), "E_VALIDATION"],
  ] as const)("reports %# with its code", (error, code) => {
    expect(error.code).toBe(code);
  });

  it("carries why a request got no usable response", () => {
    expect(new BackendUnavailableError("why", { reason: "timeout" }).reason).toBe("timeout");
  });
});
