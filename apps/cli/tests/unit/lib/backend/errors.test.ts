import { describe, expect, it } from "vitest";

import { BackendReleaseContentRevokedError } from "@/lib/backend";

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

describe("what a backend error states", () => {
  it.each([
    [
      "an unreachable server",
      new BackendUnreachableError("no answer", { url: "https://a.test" }),
      "unreachable",
      undefined,
    ],
    [
      "a server that took too long",
      new BackendTimeoutError("timed out", { url: "https://a.test" }),
      "timeout",
      "The server accepted the connection but did not answer in time. Check that it is healthy, then retry.",
    ],
    [
      "an answer it could not read",
      new BackendUnreadableError("unreadable", { url: "https://a.test" }),
      "unreadable",
      "The server answered, but its response could not be read. Check any proxy between you and the server, then retry.",
    ],
  ] as const)("reports the URL and the reason of %s", (_situation, error, reason, hint) => {
    expect(error).toMatchObject({ hint, details: { url: "https://a.test", reason } });
  });

  it("says a revoked release can never be served again", () => {
    const error = new BackendReleaseContentRevokedError(
      "released as rel_1, which is revoked",
      "rel_1",
      "h1",
    );

    expect(error).toMatchObject({
      hint: "A revoked release can never be served again. Change the configuration so it builds a new release.",
      details: { release_id: "rel_1", content_hash: "h1" },
    });
  });

  it("reports a bug as the failure it is", () => {
    expect(new BackendInternalError("no page").details).toEqual({
      original: { name: "BackendInternalError", message: "no page", code: undefined },
    });
  });
});
