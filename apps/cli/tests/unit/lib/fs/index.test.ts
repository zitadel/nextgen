import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import {
  pathExists,
  pathExistsStrict,
  FsDeniedError,
  FsFailedError,
  fsFailure,
  FsIsDirectoryError,
  FsNotDirectoryError,
  isFile,
  entryExists,
  readDirIfExists,
  readFile,
  readIfExists,
  readIfReadable,
} from "@/lib/fs";
import { it } from "@tests/fixtures";

describe("pathExists", () => {
  it("is true for a file and a directory, false for a missing path", async ({ dir }) => {
    await writeFile(join(dir, "a.txt"), "x");

    expect(await pathExists(join(dir, "a.txt"))).toBe(true);
    expect(await pathExists(dir)).toBe(true);
    expect(await pathExists(join(dir, "missing"))).toBe(false);
  });

  it("is false when the parent is a file rather than a directory", async ({ dir }) => {
    await writeFile(join(dir, "a.txt"), "x");

    expect(await pathExists(join(dir, "a.txt", "child"))).toBe(false);
  });
});

describe("readIfExists", () => {
  it("returns the text of an existing file", async ({ dir }) => {
    await writeFile(join(dir, "a.txt"), "hello");

    expect(await readIfExists(join(dir, "a.txt"))).toBe("hello");
  });

  it("returns undefined for a missing file", async ({ dir }) => {
    expect(await readIfExists(join(dir, "missing"))).toBeUndefined();
  });

  it("throws for a path that exists but cannot be read as a file", async ({ dir }) => {
    await mkdir(join(dir, "folder"));

    await expect(readIfExists(join(dir, "folder"))).rejects.toBeInstanceOf(FsIsDirectoryError);
  });

  it.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
    "throws for a file the user may not read",
    async ({ dir }) => {
      const file = join(dir, "secret");
      await writeFile(file, "x");
      await chmod(file, 0o000);

      await expect(readIfExists(file)).rejects.toBeInstanceOf(FsDeniedError);
    },
  );
});

describe("pathExistsStrict", () => {
  it("is true for an existing path and false for a missing one", async ({ dir }) => {
    await writeFile(join(dir, "a.txt"), "x");

    expect(await pathExistsStrict(join(dir, "a.txt"))).toBe(true);
    expect(await pathExistsStrict(join(dir, "missing"))).toBe(false);
  });

  it("throws when the parent is a file rather than a directory", async ({ dir }) => {
    await writeFile(join(dir, "a.txt"), "x");

    await expect(pathExistsStrict(join(dir, "a.txt", "child"))).rejects.toBeInstanceOf(
      FsNotDirectoryError,
    );
  });
});

describe("readIfReadable", () => {
  it("returns the text of a readable file", async ({ dir }) => {
    await writeFile(join(dir, "a.txt"), "hello");

    expect(await readIfReadable(join(dir, "a.txt"))).toBe("hello");
  });

  it("returns undefined for a missing file and for one that cannot be read", async ({ dir }) => {
    await mkdir(join(dir, "folder"));

    expect(await readIfReadable(join(dir, "missing"))).toBeUndefined();
    expect(await readIfReadable(join(dir, "folder"))).toBeUndefined();
  });
});

describe("readDirIfExists", () => {
  it("lists the entries of an existing directory", async ({ dir }) => {
    await writeFile(join(dir, "a.txt"), "x");

    expect(await readDirIfExists(dir)).toEqual(["a.txt"]);
  });

  it("returns an empty list for a missing directory", async ({ dir }) => {
    expect(await readDirIfExists(join(dir, "missing"))).toEqual([]);
  });

  it("rethrows when the path is a file rather than a directory", async ({ dir }) => {
    await writeFile(join(dir, "a.txt"), "x");

    await expect(readDirIfExists(join(dir, "a.txt"))).rejects.toBeInstanceOf(FsNotDirectoryError);
  });
});

describe("isFile", () => {
  it("is true for a regular file", async ({ dir }) => {
    await writeFile(join(dir, "a.txt"), "x");

    expect(await isFile(join(dir, "a.txt"))).toBe(true);
  });

  it("is false for a directory", async ({ dir }) => {
    expect(await isFile(dir)).toBe(false);
  });

  it("is false for a path that does not exist", async ({ dir }) => {
    expect(await isFile(join(dir, "missing"))).toBe(false);
  });

  it.skipIf(process.platform === "win32")("is false for a symlink loop", async ({ dir }) => {
    await symlink(join(dir, "b"), join(dir, "a"));
    await symlink(join(dir, "a"), join(dir, "b"));

    expect(await isFile(join(dir, "a"))).toBe(false);
  });
});

describe("readFile", () => {
  it.skipIf(process.platform === "win32")(
    "throws an FsFailedError for a failure with no class of its own",
    async ({ dir }) => {
      await symlink(join(dir, "b"), join(dir, "a"));
      await symlink(join(dir, "a"), join(dir, "b"));

      await expect(readFile(join(dir, "a"), "utf8")).rejects.toBeInstanceOf(FsFailedError);
    },
  );
});

describe("entryExists", () => {
  it("counts a link whose target is missing as an entry", async ({ dir }) => {
    await symlink(join(dir, "missing"), join(dir, "dangling"));

    expect(await entryExists(join(dir, "dangling"))).toBe(true);
    expect(await pathExists(join(dir, "dangling"))).toBe(false);
  });

  it("is false for a missing path and true for a file", async ({ dir }) => {
    await writeFile(join(dir, "a.txt"), "x");

    expect(await entryExists(join(dir, "a.txt"))).toBe(true);
    expect(await entryExists(join(dir, "missing"))).toBe(false);
  });
});

describe("fsFailure", () => {
  it.each([
    [
      "ENOENT",
      "ENOENT: no such file or directory, open '/a'",
      "ENOENT: no such file or directory, open '/a'",
    ],
    [
      "EACCES",
      "EACCES: permission denied, open '/a'",
      "Permission denied: EACCES: permission denied, open '/a'",
    ],
    [
      "EPERM",
      "EPERM: operation not permitted, unlink '/a'",
      "Permission denied: EPERM: operation not permitted, unlink '/a'",
    ],
    [
      "ELOOP",
      "ELOOP: too many symbolic links encountered, open '/a'",
      "ELOOP: too many symbolic links encountered, open '/a'",
    ],
  ])("says what Node said of %s", (code, said, message) => {
    const failure = fsFailure(Object.assign(new Error(said), { code, syscall: "open" }));

    expect(failure).toMatchObject({ message });
  });
});
