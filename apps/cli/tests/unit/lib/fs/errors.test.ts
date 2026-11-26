import { describe, expect, it } from "vitest";

import {
  FsDeniedError,
  FsError,
  FsExistsError,
  FsIsDirectoryError,
  FsNotDirectoryError,
  FsNotFoundError,
} from "@/lib/fs/errors";

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
