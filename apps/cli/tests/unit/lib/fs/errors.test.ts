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
