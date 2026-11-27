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

import * as classes from "@/lib/backend/errors";

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

describe("what each backend error states", () => {
  it.each([
    [
      "BackendNotFoundError",
      new classes.BackendNotFoundError("not found", {
        status: 404,
        url: "https://api.test/x",
        requestId: "req-1",
      }),
      {
        message: "not found",
        hint: undefined,
        details: { status: 404, url: "https://api.test/x", request_id: "req-1" },
        code: "E_NOT_FOUND",
        category: "missing",
        retryable: false,
      },
    ],
    [
      "BackendConflictError",
      new classes.BackendConflictError("conflict", { status: 409 }),
      {
        message: "conflict",
        hint: undefined,
        details: { status: 409 },
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "BackendGoneError",
      new classes.BackendGoneError("gone", { status: 410 }),
      {
        message: "gone",
        hint: undefined,
        details: { status: 410 },
        code: "E_NOT_FOUND",
        category: "missing",
        retryable: false,
      },
    ],
    [
      "BackendClaimWindowExpiredError",
      new classes.BackendClaimWindowExpiredError("window expired"),
      {
        message: "window expired",
        hint: undefined,
        details: {},
        code: "E_NOT_FOUND",
        category: "missing",
        retryable: false,
      },
    ],
    [
      "BackendClaimChallengeNotFoundError",
      new classes.BackendClaimChallengeNotFoundError("challenge not found"),
      {
        message: "challenge not found",
        hint: undefined,
        details: {},
        code: "E_NOT_FOUND",
        category: "missing",
        retryable: false,
      },
    ],
    [
      "BackendVariablePrimaryMissingError",
      new classes.BackendVariablePrimaryMissingError("GOOGLE_ID has no primary value"),
      {
        message: "GOOGLE_ID has no primary value",
        hint: undefined,
        details: {},
        code: "E_NOT_FOUND",
        category: "missing",
        retryable: false,
      },
    ],
    [
      "BackendVariablePreviewMissingError",
      new classes.BackendVariablePreviewMissingError("GOOGLE_ID has no preview value"),
      {
        message: "GOOGLE_ID has no preview value",
        hint: undefined,
        details: {},
        code: "E_NOT_FOUND",
        category: "missing",
        retryable: false,
      },
    ],
    [
      "BackendReleaseContentRevokedError",
      new classes.BackendReleaseContentRevokedError("content revoked", "rel-1", "sha256-abc"),
      {
        message: "content revoked",
        hint: "A revoked release can never be served again. Change the configuration so it builds a new release.",
        details: { release_id: "rel-1", content_hash: "sha256-abc" },
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "BackendReleaseRevokedError",
      new classes.BackendReleaseRevokedError("release revoked"),
      {
        message: "release revoked",
        hint: undefined,
        details: {},
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "BackendReleaseInUseError",
      new classes.BackendReleaseInUseError("release in use"),
      {
        message: "release in use",
        hint: undefined,
        details: {},
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "BackendProofRejectedError",
      new classes.BackendProofRejectedError("proof rejected"),
      {
        message: "proof rejected",
        hint: undefined,
        details: {},
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "BackendRequestInvalidError",
      new classes.BackendRequestInvalidError("request invalid", { status: 400 }),
      {
        message: "request invalid",
        hint: undefined,
        details: { status: 400 },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "BackendRequestMalformedError",
      new classes.BackendRequestMalformedError("request malformed"),
      {
        message: "request malformed",
        hint: undefined,
        details: {},
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "BackendPageMalformedError",
      new classes.BackendPageMalformedError("page malformed", { items: 1 }),
      {
        message: "page malformed",
        hint: undefined,
        details: { response: { items: 1 } },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "BackendOperationUnknownError",
      new classes.BackendOperationUnknownError("no such operation", ["listUsers"]),
      {
        message: "no such operation",
        hint: undefined,
        details: { near: ["listUsers"] },
        code: "E_VALIDATION",
        category: "missing",
        retryable: false,
      },
    ],
    [
      "BackendPathUnknownError",
      new classes.BackendPathUnknownError("no such path"),
      {
        message: "no such path",
        hint: undefined,
        details: { near: [] },
        code: "E_VALIDATION",
        category: "missing",
        retryable: false,
      },
    ],
    [
      "BackendOperationAmbiguousError",
      new classes.BackendOperationAmbiguousError("ambiguous", ["GET", "POST"]),
      {
        message: "ambiguous",
        hint: undefined,
        details: { methods: ["GET", "POST"] },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "BackendMethodMismatchError",
      new classes.BackendMethodMismatchError("wrong method", "PATCH"),
      {
        message: "wrong method",
        hint: undefined,
        details: { methods: ["PATCH"], method: "PATCH" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "BackendNameUnknownError",
      new classes.BackendNameUnknownError("no flow named login", "flow", "login"),
      {
        message: "no flow named login",
        hint: undefined,
        details: { kind: "flow", reference: "login" },
        code: "E_NOT_FOUND",
        category: "missing",
        retryable: false,
      },
    ],
    [
      "BackendInternalError",
      new classes.BackendInternalError("internal", { status: 500 }),
      {
        message: "internal",
        hint: undefined,
        details: {
          original: { name: "BackendInternalError", message: "internal", code: undefined },
        },
        code: "E_VALIDATION",
        category: "fault",
        retryable: false,
      },
    ],
    [
      "BackendUnauthorizedError",
      new classes.BackendUnauthorizedError("unauthorized", { status: 401 }),
      {
        message: "unauthorized",
        hint: undefined,
        details: { status: 401 },
        code: "E_AUTH",
        category: "denied",
        retryable: false,
      },
    ],
    [
      "BackendForbiddenError",
      new classes.BackendForbiddenError("forbidden", { status: 403 }),
      {
        message: "forbidden",
        hint: undefined,
        details: { status: 403 },
        code: "E_AUTH",
        category: "denied",
        retryable: false,
      },
    ],
    [
      "BackendUnreachableError",
      new classes.BackendUnreachableError("unreachable", { cause: new Error("boom") }),
      {
        message: "unreachable",
        hint: undefined,
        details: { url: undefined, reason: "unreachable" },
        code: "E_NETWORK",
        category: "unavailable",
        retryable: true,
      },
    ],
    [
      "BackendTimeoutError",
      new classes.BackendTimeoutError("timed out"),
      {
        message: "timed out",
        hint: "The server accepted the connection but did not answer in time. Check that it is healthy, then retry.",
        details: { url: undefined, reason: "timeout" },
        code: "E_NETWORK",
        category: "unavailable",
        retryable: true,
      },
    ],
    [
      "BackendUnreadableError",
      new classes.BackendUnreadableError("unreadable", { status: 200 }),
      {
        message: "unreadable",
        hint: "The server answered, but its response could not be read. Check any proxy between you and the server, then retry.",
        details: { url: undefined, reason: "unreadable" },
        code: "E_NETWORK",
        category: "unavailable",
        retryable: true,
      },
    ],
    [
      "BackendUnavailableError",
      new classes.BackendUnavailableError("unavailable", { status: 503 }),
      {
        message: "unavailable",
        hint: undefined,
        details: { status: 503 },
        code: "E_NETWORK",
        category: "unavailable",
        retryable: true,
      },
    ],
    [
      "BackendTooManyRequestsError",
      new classes.BackendTooManyRequestsError("slow down", { status: 429 }),
      {
        message: "slow down",
        hint: undefined,
        details: { status: 429 },
        code: "E_NETWORK",
        category: "unavailable",
        retryable: true,
      },
    ],
  ])("states what a %s says and reports", (_name, error, expected) => {
    expect({
      message: error.message,
      hint: error.hint,
      details: error.details,
      code: error.code,
      category: error.category,
      retryable: error.retryable,
    }).toEqual(expected);
  });
});
