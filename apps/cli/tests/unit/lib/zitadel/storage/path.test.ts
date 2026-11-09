import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { describe, expect } from "vitest";

import { Path } from "@/lib/zitadel/storage/path";
import { it } from "@tests/helpers/fixtures";

describe("Path.of", () => {
  it("resolves segments against the working directory", () => {
    const path = Path.of("a", "b");

    expect(path.toString()).toBe(resolve("a", "b"));
  });

  it("normalises dot segments away", () => {
    const path = Path.of(sep, "a", ".", "b", "..", "c");

    expect(path.toString()).toBe(resolve(sep, "a", "c"));
  });
});

describe("Path.parent", () => {
  it("is the directory the path is in", () => {
    const parent = Path.of(sep, "a", "b").parent;

    expect(parent).toEqual(Path.of(sep, "a"));
  });

  it("is the filesystem root itself for the filesystem root", () => {
    const parent = Path.of(sep).parent;

    expect(parent).toEqual(Path.of(sep));
  });
});

describe("Path.ancestors", () => {
  it("lists every directory above, nearest first", () => {
    const ancestors = Path.of(sep, "a", "b", "c").ancestors;

    expect(ancestors).toEqual([Path.of(sep, "a", "b"), Path.of(sep, "a"), Path.of(sep)]);
  });

  it("is empty for the filesystem root", () => {
    const ancestors = Path.of(sep).ancestors;

    expect(ancestors).toEqual([]);
  });
});

describe("Path.resolve", () => {
  it("lands a relative segment beneath the path", () => {
    const resolved = Path.of(sep, "a").resolve("b/c");

    expect(resolved.toString()).toBe(resolve(sep, "a", "b", "c"));
  });

  it("climbs out of the path on ..", () => {
    const resolved = Path.of(sep, "a", "b").resolve("../c");

    expect(resolved.toString()).toBe(resolve(sep, "a", "c"));
  });

  it("starts over at an absolute segment", () => {
    const resolved = Path.of(sep, "a").resolve(resolve(sep, "z"));

    expect(resolved.toString()).toBe(resolve(sep, "z"));
  });
});

describe("Path.contains", () => {
  it.each([
    ["holds for the path itself", [sep, "a"], [sep, "a"], true],
    ["holds for a path beneath it", [sep, "a"], [sep, "a", "b", "c"], true],
    ["does not hold for its parent", [sep, "a", "b"], [sep, "a"], false],
    [
      "does not hold for a sibling whose name it prefixes",
      [sep, "a", "b"],
      [sep, "a", "bc"],
      false,
    ],
    ["holds for a child whose name starts with ..", [sep, "a"], [sep, "a", "..b"], true],
  ])("%s", (_claim, outer, inner, holds) => {
    const contains = Path.of(...outer).contains(Path.of(...inner));

    expect(contains).toBe(holds);
  });
});

describe("Path.equals", () => {
  it.each([
    ["holds for two paths spelled alike once resolved", [sep, "a", "x", "..", "b"], true],
    ["does not hold for different paths", [sep, "b"], false],
  ])("%s", (_claim, other, holds) => {
    const equals = Path.of(sep, "a", "b").equals(Path.of(...other));

    expect(equals).toBe(holds);
  });
});

describe("Path.relativeTo", () => {
  it.each([
    ["spells a path beneath the base with /", [sep, "a", "b", "c"], [sep, "a"], "b/c"],
    ["climbs with .. for a path outside the base", [sep, "a", "c"], [sep, "a", "b"], "../c"],
    ["is empty for the base itself", [sep, "a"], [sep, "a"], ""],
  ])("%s", (_claim, path, base, relative) => {
    const spelled = Path.of(...path).relativeTo(Path.of(...base));

    expect(spelled).toBe(relative);
  });
});

describe("Path.resolveReal", () => {
  it("resolves a symlinked directory on the way", async ({ dir, other }) => {
    await writeFile(join(other, "x.txt"), "x");
    await symlink(other, join(dir, "link"));

    const real = Path.of(dir, "link", "x.txt").resolveReal();

    expect(real).toEqual(Path.of(await realpath(other), "x.txt"));
  });

  it("keeps the segments that do not exist yet", async ({ dir }) => {
    const real = Path.of(dir, "not", "yet.txt").resolveReal();

    expect(real).toEqual(Path.of(await realpath(dir), "not", "yet.txt"));
  });

  it("is undefined through a symlink that resolves nowhere", async ({ dir }) => {
    await symlink(join(dir, "gone"), join(dir, "dangling"));

    const real = Path.of(dir, "dangling", "x.txt").resolveReal();

    expect(real).toBeUndefined();
  });

  it("is undefined for a symlink that resolves nowhere itself", async ({ dir }) => {
    await symlink(join(dir, "gone"), join(dir, "dangling"));

    const real = Path.of(dir, "dangling").resolveReal();

    expect(real).toBeUndefined();
  });

  it("keeps the segments under a regular file", async ({ dir }) => {
    await mkdir(join(dir, "a"));
    await writeFile(join(dir, "a", "file.txt"), "x");

    const real = Path.of(dir, "a", "file.txt", "x").resolveReal();

    expect(real).toEqual(Path.of(await realpath(dir), "a", "file.txt", "x"));
  });
});
