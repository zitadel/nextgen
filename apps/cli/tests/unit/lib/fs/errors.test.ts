import { describe, expect, it } from "vitest";

import {
  FsDeniedError,
  FsError,
  FsExistsError,
  FsIsDirectoryError,
  FsNotDirectoryError,
  FsNotFoundError,
} from "@/lib/fs/errors";

import * as classes from "@/lib/fs/errors";

describe("a file-system error's cause", () => {
  it("is kept", () => {
    const cause = new Error("underneath");

    expect(new FsNotFoundError("why", cause).cause).toBe(cause);
  });
});

describe("FsNotFoundError", () => {
  it("is an FsError", () => {
    expect(new FsNotFoundError("why")).toBeInstanceOf(FsError);
  });

  it("is missing under its own name", () => {
    expect(new FsNotFoundError("why")).toMatchObject({
      name: "FsNotFoundError",
      category: "missing",
      retryable: false,
      code: "E_VALIDATION",
    });
  });
});

describe("FsDeniedError", () => {
  it("is an FsError", () => {
    expect(new FsDeniedError("why")).toBeInstanceOf(FsError);
  });

  it("is denied under its own name", () => {
    expect(new FsDeniedError("why")).toMatchObject({
      name: "FsDeniedError",
      category: "denied",
      retryable: false,
      code: "E_AUTH",
    });
  });
});

describe("FsNotDirectoryError", () => {
  it("is an FsError", () => {
    expect(new FsNotDirectoryError("why")).toBeInstanceOf(FsError);
  });

  it("is invalid under its own name", () => {
    expect(new FsNotDirectoryError("why")).toMatchObject({
      name: "FsNotDirectoryError",
      category: "invalid",
      retryable: false,
      code: "E_VALIDATION",
    });
  });
});

describe("FsIsDirectoryError", () => {
  it("is an FsError", () => {
    expect(new FsIsDirectoryError("why")).toBeInstanceOf(FsError);
  });

  it("is invalid under its own name", () => {
    expect(new FsIsDirectoryError("why")).toMatchObject({
      name: "FsIsDirectoryError",
      category: "invalid",
      retryable: false,
      code: "E_VALIDATION",
    });
  });
});

describe("FsExistsError", () => {
  it("is an FsError", () => {
    expect(new FsExistsError("why")).toBeInstanceOf(FsError);
  });

  it("is a conflict under its own name", () => {
    expect(new FsExistsError("why")).toMatchObject({
      name: "FsExistsError",
      category: "conflict",
      retryable: false,
      code: "E_CONFLICT",
    });
  });
});

/**
 * An error as Node raises it for a failed system call.
 *
 * @param code - The errno.
 * @param message - Node's message.
 * @returns The error.
 */
function nodeError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe("what a file-system error states", () => {
  it.each([
    [
      "a missing file",
      new FsNotFoundError(
        "ENOENT: no such file",
        nodeError("ENOENT", "ENOENT: no such file"),
        "ENOENT",
      ),
      "A required file or directory is missing.",
    ],
    [
      "a file it may not read",
      new FsDeniedError("Permission denied: EACCES", nodeError("EACCES", "EACCES"), "EACCES"),
      "Check file permissions or run with the right user.",
    ],
    [
      "a file in the way",
      new FsExistsError("EEXIST", nodeError("EEXIST", "EEXIST"), "EEXIST"),
      undefined,
    ],
  ] as const)("states the hint of %s", (_situation, error, hint) => {
    expect(error.hint).toBe(hint);
  });

  it("reports Node's error as its only fact", () => {
    const error = new FsNotFoundError(
      "ENOENT: no such file",
      nodeError("ENOENT", "ENOENT: no such file"),
      "ENOENT",
    );

    expect(error.details).toEqual({
      original: { name: "Error", message: "ENOENT: no such file", code: "ENOENT" },
    });
  });
});

describe("what each file-system error states", () => {
  it.each([
    [
      "FsNotFoundError",
      new classes.FsNotFoundError("cannot read a.json", new Error("boom"), "ENOENT"),
      {
        message: "cannot read a.json",
        hint: "A required file or directory is missing.",
        details: { original: { name: "Error", message: "boom", code: undefined } },
        code: "E_VALIDATION",
        category: "missing",
        retryable: false,
      },
    ],
    [
      "FsDeniedError",
      new classes.FsDeniedError("cannot read a.json", new Error("boom"), "EACCES"),
      {
        message: "cannot read a.json",
        hint: "Check file permissions or run with the right user.",
        details: { original: { name: "Error", message: "boom", code: undefined } },
        code: "E_AUTH",
        category: "denied",
        retryable: false,
      },
    ],
    [
      "FsNotDirectoryError",
      new classes.FsNotDirectoryError("cannot list a.json", new Error("boom"), "ENOTDIR"),
      {
        message: "cannot list a.json",
        hint: undefined,
        details: { original: { name: "Error", message: "boom", code: undefined } },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "FsIsDirectoryError",
      new classes.FsIsDirectoryError("cannot read src", new Error("boom"), "EISDIR"),
      {
        message: "cannot read src",
        hint: undefined,
        details: { original: { name: "Error", message: "boom", code: undefined } },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "FsExistsError",
      new classes.FsExistsError("cannot create a.json", new Error("boom"), "EEXIST"),
      {
        message: "cannot create a.json",
        hint: undefined,
        details: { original: { name: "Error", message: "boom", code: undefined } },
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "FsFailedError",
      new classes.FsFailedError("cannot write a.json", "ENOSPC", new Error("boom")),
      {
        message: "cannot write a.json",
        hint: undefined,
        details: { original: { name: "Error", message: "boom", code: undefined } },
        code: "E_VALIDATION",
        category: "unknown",
        retryable: false,
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
