import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  isFile,
  pathExists,
  pathExistsStrict,
  readDirIfExists,
  readIfExists,
  readIfReadable,
} from "@/lib/fs";

const tmpDir = (): Promise<string> => mkdtemp(join(tmpdir(), "zitadel-fs-"));

describe("pathExists", () => {
  it("is true for a file and a directory, false for a missing path", async () => {
    const dir = await tmpDir();
    await writeFile(join(dir, "a.txt"), "x");

    expect(await pathExists(join(dir, "a.txt"))).toBe(true);
    expect(await pathExists(dir)).toBe(true);
    expect(await pathExists(join(dir, "missing"))).toBe(false);
  });

  it("is false when the parent is a file rather than a directory", async () => {
    const dir = await tmpDir();
    await writeFile(join(dir, "a.txt"), "x");

    expect(await pathExists(join(dir, "a.txt", "child"))).toBe(false);
  });
});

describe("readIfExists", () => {
  it("returns the text of an existing file", async () => {
    const dir = await tmpDir();
    await writeFile(join(dir, "a.txt"), "hello");

    expect(await readIfExists(join(dir, "a.txt"))).toBe("hello");
  });

  it("returns undefined for a missing file", async () => {
    expect(await readIfExists(join(await tmpDir(), "missing"))).toBeUndefined();
  });

  it("throws for a path that exists but cannot be read as a file", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, "folder"));

    await expect(readIfExists(join(dir, "folder"))).rejects.toMatchObject({ code: "EISDIR" });
  });

  it.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
    "throws for a file the user may not read",
    async () => {
      const dir = await tmpDir();
      const file = join(dir, "secret");
      await writeFile(file, "x");
      await chmod(file, 0o000);

      await expect(readIfExists(file)).rejects.toMatchObject({ code: "EACCES" });
    },
  );
});

describe("pathExistsStrict", () => {
  it("is true for an existing path and false for a missing one", async () => {
    const dir = await tmpDir();
    await writeFile(join(dir, "a.txt"), "x");

    expect(await pathExistsStrict(join(dir, "a.txt"))).toBe(true);
    expect(await pathExistsStrict(join(dir, "missing"))).toBe(false);
  });

  it("throws when the parent is a file rather than a directory", async () => {
    const dir = await tmpDir();
    await writeFile(join(dir, "a.txt"), "x");

    await expect(pathExistsStrict(join(dir, "a.txt", "child"))).rejects.toMatchObject({
      code: "ENOTDIR",
    });
  });
});

describe("readIfReadable", () => {
  it("returns the text of a readable file", async () => {
    const dir = await tmpDir();
    await writeFile(join(dir, "a.txt"), "hello");

    expect(await readIfReadable(join(dir, "a.txt"))).toBe("hello");
  });

  it("returns undefined for a missing file and for one that cannot be read", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, "folder"));

    expect(await readIfReadable(join(dir, "missing"))).toBeUndefined();
    expect(await readIfReadable(join(dir, "folder"))).toBeUndefined();
  });
});

describe("readDirIfExists", () => {
  it("lists the entries of an existing directory", async () => {
    const dir = await tmpDir();
    await writeFile(join(dir, "a.txt"), "x");

    expect(await readDirIfExists(dir)).toEqual(["a.txt"]);
  });

  it("returns an empty list for a missing directory", async () => {
    expect(await readDirIfExists(join(await tmpDir(), "missing"))).toEqual([]);
  });

  it("rethrows when the path is a file rather than a directory", async () => {
    const dir = await tmpDir();
    await writeFile(join(dir, "a.txt"), "x");

    await expect(readDirIfExists(join(dir, "a.txt"))).rejects.toMatchObject({ code: "ENOTDIR" });
  });
});

describe("isFile", () => {
  it("is true for a regular file", async () => {
    const dir = await tmpDir();
    await writeFile(join(dir, "a.txt"), "x");

    expect(await isFile(join(dir, "a.txt"))).toBe(true);
  });

  it("is false for a directory", async () => {
    expect(await isFile(await tmpDir())).toBe(false);
  });

  it("is false for a path that does not exist", async () => {
    expect(await isFile(join(await tmpDir(), "missing"))).toBe(false);
  });
});
