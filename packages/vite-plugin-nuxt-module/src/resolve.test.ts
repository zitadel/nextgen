import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  anyTypeScript,
  exportsTarget,
  importFromRoot,
  packageDirectory,
  packageSpecifier,
  realPackageDirectory,
  resolveFromRoot,
} from "./resolve.ts";

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "vite-resolve-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

/** A package root with one ESM-only tool installed whose manifest has `exports`. */
function esmTool(exports: unknown, files: Record<string, string>): string {
  return tree({
    "package.json": "{}",
    "node_modules/esm-tool/package.json": JSON.stringify({
      name: "esm-tool",
      type: "module",
      exports,
    }),
    ...Object.fromEntries(Object.entries(files).map(([f, c]) => [`node_modules/esm-tool/${f}`, c])),
  });
}

describe("packageSpecifier", () => {
  it.each([
    ["tool", "tool", "."],
    ["tool/sub/x", "tool", "./sub/x"],
    ["@scope/tool/sub", "@scope/tool", "./sub"],
  ])("splits %s", (specifier, name, subpath) => {
    expect(packageSpecifier(specifier)).toEqual({ name, subpath });
  });
});

describe("exportsTarget", () => {
  it.each([
    ["a string", "./i.mjs", ".", "./i.mjs"],
    ["condition sugar", { types: "./i.d.ts", import: "./i.mjs" }, ".", "./i.mjs"],
    ["nested conditions", { ".": { node: { import: "./n.mjs" } } }, ".", "./n.mjs"],
    ["a fallback array", { ".": [{ worker: "./w.js" }, "./i.js"] }, ".", "./i.js"],
    ["a pattern", { "./*": { import: "./dist/*.mjs" } }, "./a/b", "./dist/a/b.mjs"],
    ["a require-only entry", { ".": { require: "./i.cjs" } }, ".", undefined],
  ])("resolves %s", (_label, exportsField, subpath, expected) => {
    expect(exportsTarget(exportsField, subpath)).toBe(expected);
  });
});

describe("importFromRoot", () => {
  it("imports the copy the package itself has installed", async () => {
    const root = tree({
      "package.json": "{}",
      "node_modules/tool/package.json": JSON.stringify({ name: "tool", main: "index.cjs" }),
      "node_modules/tool/index.cjs": "exports.version = 'local';",
    });
    expect((await importFromRoot<{ version: string }>("tool", root)).version).toBe("local");
  });

  it("reads the import target of an ESM-only package from its exports map", async () => {
    const root = esmTool(
      { "./sub": { import: "./sub.js" }, "./package.json": "./package.json" },
      { "sub.js": "export const kind = 'esm';" },
    );
    expect((await importFromRoot<{ kind: string }>("esm-tool/sub", root)).kind).toBe("esm");
  });

  it("imports an ESM-only package that does not export its package.json", async () => {
    const root = esmTool({ ".": { import: "./i.js" } }, { "i.js": "export const kind = 'esm';" });
    expect((await importFromRoot<{ kind: string }>("esm-tool", root)).kind).toBe("esm");
  });

  it("imports an ESM-only package whose exports use condition sugar", async () => {
    const root = esmTool(
      { types: "./i.d.ts", import: "./i.js" },
      { "i.js": "export const kind = 'sugar';" },
    );
    expect((await importFromRoot<{ kind: string }>("esm-tool", root)).kind).toBe("sugar");
  });

  it("fails for a package that is not installed", async () => {
    await expect(importFromRoot("missing-tool", tree({ "package.json": "{}" }))).rejects.toThrow(
      /cannot find package missing-tool/,
    );
  });
});

describe("realPackageDirectory", () => {
  it("finds a package whose exports map hides its package.json", () => {
    const root = tree({
      "package.json": "{}",
      "node_modules/hidden/package.json": JSON.stringify({ exports: { ".": "./index.js" } }),
    });
    expect(realPackageDirectory("hidden", root)).toBe(
      realpathSync(join(root, "node_modules/hidden")),
    );
  });

  it("returns undefined for a package that is not installed", () => {
    expect(realPackageDirectory("missing-tool", tree({ "package.json": "{}" }))).toBeUndefined();
  });
});

describe("resolveFromRoot", () => {
  it("returns undefined for a package that is not installed", () => {
    expect(resolveFromRoot("missing-tool", tree({ "package.json": "{}" }))).toBeUndefined();
  });

  it("finds the package.json of a package that does not export it", () => {
    const root = esmTool({ import: "./i.js" }, {});
    expect(resolveFromRoot("esm-tool/package.json", root)).toBe(
      join(root, "node_modules/esm-tool/package.json"),
    );
  });
});

describe("packageDirectory", () => {
  it("finds a package in a node_modules above the root, never through NODE_PATH", () => {
    const root = tree({
      "node_modules/up-tool/package.json": "{}",
      "pkg/package.json": "{}",
    });
    const previous = process.env.NODE_PATH;
    process.env.NODE_PATH = join(root, "elsewhere");
    try {
      expect([
        packageDirectory("up-tool", join(root, "pkg")),
        packageDirectory("missing-tool", join(root, "pkg")),
      ]).toEqual([join(root, "node_modules/up-tool"), undefined]);
    } finally {
      process.env.NODE_PATH = previous;
    }
  });
});

describe("anyTypeScript", () => {
  it("falls back to this package's TypeScript for a package without its own", () => {
    expect(anyTypeScript(tree({ "package.json": "{}" })).version).toBe(ts.version);
  });

  it("loads the package's own TypeScript when it has one", () => {
    const root = tree({
      "package.json": "{}",
      "node_modules/typescript/package.json": JSON.stringify({
        name: "typescript",
        main: "./ts.js",
      }),
      "node_modules/typescript/ts.js": 'module.exports = { version: "0.0.0-own" };',
    });
    expect(anyTypeScript(root).version).toBe("0.0.0-own");
  });
});
