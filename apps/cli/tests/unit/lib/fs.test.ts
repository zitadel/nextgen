import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { pathExists, readIfExists } from "../../../src/lib/fs";

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
