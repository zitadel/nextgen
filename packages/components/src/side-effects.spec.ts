/**
 * Guards `package.json` `sideEffects` against the built dist (`components:test`
 * depends on `components:build`). Registration runs at import time, so a
 * bundler that believes a registering file is pure drops it and the tags
 * never get defined. Chunk names come from the bundler and can change, so
 * this checks every built file that registers an element, not a fixed list.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// Resolved from the package cwd, as in standalone-artifact.spec.ts.
const PACKAGE_DIR = process.cwd();
const DIST_DIR = join(PACKAGE_DIR, "dist");

function builtModules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return builtModules(path);
    return entry.name.endsWith(".mjs") ? [path] : [];
  });
}

function globToRegExp(glob: string): RegExp {
  const pattern = glob
    .replace(/^\.\//, "")
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${pattern}$`);
}

const sideEffects = (
  JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8")) as {
    sideEffects: string[];
  }
).sideEffects.map(globToRegExp);

const isDeclaredSideEffectful = (file: string) =>
  sideEffects.some((pattern) => pattern.test(relative(PACKAGE_DIR, file)));

describe("package.json sideEffects", () => {
  const registering = builtModules(DIST_DIR).filter((file) =>
    /defineOnce\("|customElements\.define\(/.test(readFileSync(file, "utf8")),
  );

  it("finds the registering modules in the build", () => {
    expect(registering.length).toBeGreaterThan(0);
  });

  it.each(registering.map((file) => relative(PACKAGE_DIR, file)))(
    "declares %s as side-effectful",
    (file) => {
      expect(isDeclaredSideEffectful(join(PACKAGE_DIR, file))).toBe(true);
    },
  );

  it.each(["dist/index.mjs", "dist/atoms/index.mjs", "dist/orchestrator/index.mjs"])(
    "declares the registering entry %s as side-effectful",
    (file) => {
      expect(isDeclaredSideEffectful(join(PACKAGE_DIR, file))).toBe(true);
    },
  );
});
