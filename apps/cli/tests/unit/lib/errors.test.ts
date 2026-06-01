import { describe, expect, it } from "vitest";

import { EXIT_CODES, ZitadelError, toZitadelError } from "../../../src/lib/errors";

describe("EXIT_CODES", () => {
  it("maps every error code to its documented exit number", () => {
    expect(EXIT_CODES).toEqual({
      E_ALREADY_INIT: 0,
      E_FRAMEWORK_NOT_DETECTED: 3,
      E_UNSUPPORTED_PROJECT_SHAPE: 3,
      E_NETWORK: 4,
      E_AUTH: 1,
      E_CONFLICT: 5,
      E_CLAIM_REQUIRED: 6,
      E_VALIDATION: 3,
      E_NOT_IMPLEMENTED: 2,
    });
  });
});

describe("ZitadelError", () => {
  it("carries the code, message, and optional extras", () => {
    const err = new ZitadelError("E_CONFLICT", "boom", {
      hint: "try again",
      nextCommands: ["zitadel doctor", "zitadel init"],
      details: { field: "x" },
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ZitadelError");
    expect(err.message).toBe("boom");
    expect(err.code).toBe("E_CONFLICT");
    expect(err.hint).toBe("try again");
    expect(err.nextCommands).toEqual(["zitadel doctor", "zitadel init"]);
    expect(err.details).toEqual({ field: "x" });
  });

  it("leaves optional extras undefined when omitted", () => {
    const err = new ZitadelError("E_VALIDATION", "nope");
    expect(err.hint).toBeUndefined();
    expect(err.nextCommands).toBeUndefined();
    expect(err.details).toBeUndefined();
  });

  it("derives exitCode from the code via EXIT_CODES", () => {
    expect(new ZitadelError("E_NETWORK", "x").exitCode).toBe(4);
    expect(new ZitadelError("E_CONFLICT", "x").exitCode).toBe(5);
    expect(new ZitadelError("E_ALREADY_INIT", "x").exitCode).toBe(0);
    expect(new ZitadelError("E_NOT_IMPLEMENTED", "x").exitCode).toBe(2);
  });
});

describe("toZitadelError", () => {
  it("passes an existing ZitadelError through unchanged", () => {
    const original = new ZitadelError("E_AUTH", "already normalised");
    expect(toZitadelError(original)).toBe(original);
  });

  it("maps EACCES errno errors to E_AUTH", () => {
    const errno = Object.assign(new Error("denied"), { code: "EACCES" });
    const result = toZitadelError(errno);
    expect(result.code).toBe("E_AUTH");
    expect(result.message).toBe("Permission denied: denied");
    expect(result.hint).toBe("Check file permissions or run with the right user.");
    expect(result.details).toEqual({
      original: { name: "Error", message: "denied", code: "EACCES" },
    });
  });

  it("maps EPERM errno errors to E_AUTH", () => {
    const errno = Object.assign(new Error("perm"), { code: "EPERM" });
    expect(toZitadelError(errno).code).toBe("E_AUTH");
  });

  it("maps EEXIST errno errors to E_CONFLICT", () => {
    const errno = Object.assign(new Error("file exists"), { code: "EEXIST" });
    const result = toZitadelError(errno);
    expect(result.code).toBe("E_CONFLICT");
    expect(result.message).toBe("file exists");
    expect(result.hint).toBe(
      "A file already exists. Use --force to overwrite or remove it first.",
    );
  });

  it("maps ENOENT errno errors to E_VALIDATION", () => {
    const errno = Object.assign(new Error("missing"), { code: "ENOENT" });
    const result = toZitadelError(errno);
    expect(result.code).toBe("E_VALIDATION");
    expect(result.message).toBe("missing");
    expect(result.hint).toBe("A required file or directory is missing.");
  });

  it("wraps a fetch-style TypeError as E_NETWORK", () => {
    const err = new TypeError("fetch failed");
    const result = toZitadelError(err);
    expect(result.code).toBe("E_NETWORK");
    expect(result.message).toBe("fetch failed");
    expect(result.hint).toBe(
      "Check your connection, ZITADEL_API_BASE, or the configured server URL.",
    );
    expect(result.details).toEqual({
      original: { name: "TypeError", message: "fetch failed", code: undefined },
    });
  });

  it("wraps an error with a networky cause code as E_NETWORK", () => {
    const err = Object.assign(new Error("connection problem"), {
      cause: { code: "ECONNREFUSED" },
    });
    const result = toZitadelError(err);
    expect(result.code).toBe("E_NETWORK");
    expect(result.message).toBe("connection problem");
  });

  it("wraps a zod-like Error (issues array) as E_VALIDATION", () => {
    // A real ZodError is an Error subclass carrying `.issues`; errorMessage
    // only reads `.message` from genuine Error instances (a plain object
    // would stringify to "[object Object]" — see the next case).
    const issues = [{ path: ["name"], message: "Required" }];
    const zodLike = Object.assign(new Error("validation failed"), { issues });
    const result = toZitadelError(zodLike);
    expect(result.code).toBe("E_VALIDATION");
    expect(result.message).toBe("validation failed");
    expect(result.details).toEqual({ issues });
  });

  it("falls back to String() for a zod-like error without a message", () => {
    const zodLike = { issues: [] as unknown[] };
    const result = toZitadelError(zodLike);
    expect(result.code).toBe("E_VALIDATION");
    expect(result.message).toBe(String(zodLike));
  });

  it("wraps a generic Error as E_VALIDATION preserving its shape", () => {
    const err = new Error("plain failure");
    const result = toZitadelError(err);
    expect(result.code).toBe("E_VALIDATION");
    expect(result.message).toBe("plain failure");
    expect(result.details).toEqual({
      original: { name: "Error", message: "plain failure", code: undefined },
    });
  });

  it("wraps an unknown non-error value as E_VALIDATION with a generic message", () => {
    const value = { weird: true };
    const result = toZitadelError(value);
    expect(result.code).toBe("E_VALIDATION");
    expect(result.message).toBe("Unknown error");
    expect(result.details).toBe(value);
  });

  it("wraps a thrown string as E_VALIDATION with a generic message", () => {
    const result = toZitadelError("just a string");
    expect(result.code).toBe("E_VALIDATION");
    expect(result.message).toBe("Unknown error");
    expect(result.details).toBe("just a string");
  });
});
