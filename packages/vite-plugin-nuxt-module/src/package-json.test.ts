import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isModulePackage, namesFile, readPackageJson } from "./package-json.ts";

function packageRoot(pkg: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "vite-package-json-"));
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg));
  return root;
}

describe("readPackageJson", () => {
  it("reads the package's manifest", () => {
    expect(readPackageJson(packageRoot({ name: "x" })).name).toBe("x");
  });
});

describe("isModulePackage", () => {
  it.each([
    [{ type: "module" }, true],
    [{ type: "commonjs" }, false],
    [{}, false],
  ])("%j is a module package: %s", (pkg, expected) => {
    expect(isModulePackage(packageRoot(pkg))).toBe(expected);
  });
});

describe("namesFile", () => {
  it.each([
    [{ exports: { ".": { types: "./dist/types.d.mts", import: "./dist/module.mjs" } } }, true],
    [{ types: "dist/types.d.mts" }, true],
    [{ typesVersions: { "*": { ".": ["./dist/types.d.mts"] } } }, true],
    [{ exports: { ".": { types: "./dist/index.d.mts" } } }, false],
    [{}, false],
  ])("%j names dist/types.d.mts: %s", (pkg, expected) => {
    const root = packageRoot(pkg);
    expect(namesFile(root, join(root, "dist/types.d.mts"))).toBe(expected);
  });
});
