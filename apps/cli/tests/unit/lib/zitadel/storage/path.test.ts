import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";
import { Path } from "@/lib/zitadel/storage/path";

describe("Path", () => {
  describe("of", () => {
    it("resolves segments against the working directory", () => {
      expect(Path.of("a", "b").toString()).toBe(resolve("a", "b"));
    });

    it("normalises dot segments away", () => {
      expect(Path.of(sep, "a", ".", "b", "..", "c").toString()).toBe(resolve(sep, "a", "c"));
    });
  });

  describe("parent", () => {
    it("is the directory the path is in", () => {
      expect(Path.of(sep, "a", "b").parent).toEqual(Path.of(sep, "a"));
    });

    it("is the filesystem root itself for the filesystem root", () => {
      expect(Path.of(sep).parent).toEqual(Path.of(sep));
    });
  });

  describe("ancestors", () => {
    it("lists every directory above, nearest first", () => {
      expect(Path.of(sep, "a", "b", "c").ancestors).toEqual([
        Path.of(sep, "a", "b"),
        Path.of(sep, "a"),
        Path.of(sep),
      ]);
    });

    it("is empty for the filesystem root", () => {
      expect(Path.of(sep).ancestors).toEqual([]);
    });
  });

  describe("resolve", () => {
    it("lands a relative segment beneath the path", () => {
      expect(Path.of(sep, "a").resolve("b/c").toString()).toBe(resolve(sep, "a", "b", "c"));
    });

    it("climbs out of the path on ..", () => {
      expect(Path.of(sep, "a", "b").resolve("../c").toString()).toBe(resolve(sep, "a", "c"));
    });

    it("starts over at an absolute segment", () => {
      expect(Path.of(sep, "a").resolve(resolve(sep, "z")).toString()).toBe(resolve(sep, "z"));
    });
  });

  describe("contains", () => {
    it("holds for the path itself", () => {
      expect(Path.of(sep, "a").contains(Path.of(sep, "a"))).toBe(true);
    });

    it("holds for a path beneath it", () => {
      expect(Path.of(sep, "a").contains(Path.of(sep, "a", "b", "c"))).toBe(true);
    });

    it("does not hold for its parent", () => {
      expect(Path.of(sep, "a", "b").contains(Path.of(sep, "a"))).toBe(false);
    });

    it("does not hold for a sibling whose name it prefixes", () => {
      expect(Path.of(sep, "a", "b").contains(Path.of(sep, "a", "bc"))).toBe(false);
    });

    it("holds for a child whose name starts with ..", () => {
      expect(Path.of(sep, "a").contains(Path.of(sep, "a", "..b"))).toBe(true);
    });
  });

  describe("equals", () => {
    it("holds for two paths spelled alike once resolved", () => {
      expect(Path.of(sep, "a", "b").equals(Path.of(sep, "a", "x", "..", "b"))).toBe(true);
    });

    it("does not hold for different paths", () => {
      expect(Path.of(sep, "a").equals(Path.of(sep, "b"))).toBe(false);
    });
  });

  describe("relativeTo", () => {
    it("spells a path beneath the base with /", () => {
      expect(Path.of(sep, "a", "b", "c").relativeTo(Path.of(sep, "a"))).toBe("b/c");
    });

    it("climbs with .. for a path outside the base", () => {
      expect(Path.of(sep, "a", "c").relativeTo(Path.of(sep, "a", "b"))).toBe("../c");
    });

    it("is empty for the base itself", () => {
      expect(Path.of(sep, "a").relativeTo(Path.of(sep, "a"))).toBe("");
    });
  });

  describe("resolveReal", () => {
    it("resolves a symlinked directory on the way", async ({ dir, other }) => {
      await writeFile(join(other, "x.txt"), "x");
      await symlink(other, join(dir, "link"));

      expect(Path.of(dir, "link", "x.txt").resolveReal()).toEqual(Path.of(await realpath(other), "x.txt"));
    });

    it("keeps the segments that do not exist yet", async ({ dir }) => {
      expect(Path.of(dir, "not", "yet.txt").resolveReal()).toEqual(Path.of(await realpath(dir), "not", "yet.txt"));
    });

    it("is undefined through a symlink that resolves nowhere", async ({ dir }) => {
      await symlink(join(dir, "gone"), join(dir, "dangling"));

      expect(Path.of(dir, "dangling", "x.txt").resolveReal()).toBeUndefined();
    });

    it("is undefined for a symlink that resolves nowhere itself", async ({ dir }) => {
      await symlink(join(dir, "gone"), join(dir, "dangling"));

      expect(Path.of(dir, "dangling").resolveReal()).toBeUndefined();
    });

    it("keeps the segments under a regular file", async ({ dir }) => {
      await mkdir(join(dir, "a"));
      await writeFile(join(dir, "a", "file.txt"), "x");

      expect(Path.of(dir, "a", "file.txt", "x").resolveReal()).toEqual(Path.of(await realpath(dir), "a", "file.txt", "x"));
    });
  });
});
