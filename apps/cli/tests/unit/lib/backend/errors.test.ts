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
  BackendReleaseInUseError,
  BackendReleaseRevokedError,
  BackendRequestInvalidError,
  BackendTooManyRequestsError,
  BackendUnauthorizedError,
  BackendTimeoutError,
  BackendUnavailableError,
  BackendUnreachableError,
  BackendUnreadableError,
} from "@/lib/backend/errors";

describe("the backend errors", () => {
  it.each([
    ["not found", new BackendNotFoundError("why"), "missing", false],
    ["conflict", new BackendConflictError("why"), "conflict", false],
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

describe("the backend errors' families", () => {
  it.each([
    ["gone", new BackendGoneError("why"), BackendNotFoundError],
    ["claim window expired", new BackendClaimWindowExpiredError("why"), BackendGoneError],
    [
      "claim challenge not found",
      new BackendClaimChallengeNotFoundError("why"),
      BackendNotFoundError,
    ],
    ["release revoked", new BackendReleaseRevokedError("why"), BackendConflictError],
    ["release in use", new BackendReleaseInUseError("why"), BackendConflictError],
    ["proof rejected", new BackendProofRejectedError("why"), BackendConflictError],
  ] as const)("catches a %s failure as its general kind", (_name, error, general) => {
    expect(error).toBeInstanceOf(general);
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

  it("is a transport failure for each way no response came", () => {
    expect(new BackendUnreachableError("why")).toMatchObject({
      code: "E_NETWORK",
      retryable: true,
    });
    expect(new BackendTimeoutError("why")).toMatchObject({ code: "E_NETWORK", retryable: true });
    expect(new BackendUnreadableError("why")).toMatchObject({ code: "E_NETWORK", retryable: true });
  });
});
