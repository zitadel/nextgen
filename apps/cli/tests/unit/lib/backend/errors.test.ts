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
  BackendUnsupportedError,
} from "@/lib/backend/errors";
import { toZitadelError } from "@/lib/errors";

describe("the backend errors", () => {
  it.each([
    ["not found", new BackendNotFoundError("why"), "missing", false],
    ["conflict", new BackendConflictError("why"), "conflict", false],
    ["rejected", new BackendRejectedError("why"), "invalid", false],
    ["unknown operation", new BackendOperationUnknownError("why"), "missing", false],
    ["ambiguous operation", new BackendOperationAmbiguousError("why"), "invalid", false],
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

describe("the backend errors' codes, hints and details", () => {
  it.each([
    [new BackendNotFoundError("why"), "E_NOT_FOUND"],
    [new BackendConflictError("why"), "E_CONFLICT"],
    [new BackendUnavailableError("why"), "E_NETWORK"],
    [new BackendUnsupportedError("why"), "E_UNSUPPORTED_PROJECT_SHAPE"],
  ] as const)("reports %# with its code", (error, code) => {
    expect(error.code).toBe(code);
  });

  it("carries the status, url and body of an answer as its details", () => {
    const error = new BackendConflictError("why", {
      status: 409,
      url: "http://x/y",
      body: { a: 1 },
    });

    expect(error.details).toEqual({ status: 409, url: "http://x/y", body: { a: 1 } });
  });

  it("names the fields the server rejected in its hint", () => {
    const error = new BackendConflictError("why", {
      status: 409,
      url: "http://x/y",
      body: { code: "idp.field_immutable", details: { fields: ["issuer"] } },
    });

    expect(error.hint).toBe("The server rejected this field: issuer.");
  });

  it("says a 404 without the platform's envelope may be a wrong server", () => {
    const error = new BackendNotFoundError("Not Found", {
      status: 404,
      url: "http://x/y",
      body: "<html>",
    });

    expect(error.message).toBe(
      "Not Found — http://x/y has no such endpoint; is this a Zitadel platform API?",
    );
  });

  it("says a path the server's version lacks is a mismatch of versions", () => {
    const error = new BackendNotFoundError("Not Found", {
      status: 404,
      url: "http://x/y",
      body: { code: "req.not_found", message: "no" },
    });

    expect(error.message).toBe("http://x/y has no such endpoint on this Zitadel server");
    expect(error.hint).toContain("different versions");
  });

  it.each([
    ["unreachable", "Check your connection and the server URL (ZITADEL_URL)."],
    [
      "timeout",
      "The server accepted the connection but did not answer in time. Check that it is healthy, then retry.",
    ],
  ] as const)("words the hint of a %s request", (reason, hint) => {
    const error = new BackendUnavailableError("why", { url: "http://x", reason });

    expect(error.hint).toBe(hint);
    expect(error.details).toEqual({ url: "http://x", reason });
  });
});

describe("BackendError.withheld", () => {
  it.each([
    ["a miss", new BackendNotFoundError("gone"), true],
    ["a refusal of permission", new BackendForbiddenError("not allowed"), true],
    ["a rejected credential", new BackendUnauthorizedError("who are you"), false],
    ["a conflict", new BackendConflictError("raced"), false],
    ["a failure nothing names", new BackendError("odd"), false],
  ])("is %s: %s", (_name, error, withheld) => {
    expect(error.withheld).toBe(withheld);
  });
});
