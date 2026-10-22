import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { fixture } from "./__tests__/fixture.ts";
import { effectiveTsconfig, missingTsconfigFile, optionalTsconfig } from "./nuxt-tsconfig.ts";

/** A module root holding `files`, with TypeScript installed. */
const tree = (files: Record<string, string>): string => fixture(files, { link: ["typescript"] });

describe("missingTsconfigFile", () => {
  it("accepts a config whose relative extends exist", () => {
    const root = tree({ "tsconfig.json": '{ "extends": "./base" }', "base.json": "{}" });
    expect(missingTsconfigFile(ts, join(root, "tsconfig.json"))).toBeUndefined();
  });

  it("names the file `nuxt prepare` has not written yet", () => {
    const root = tree({ "tsconfig.json": '{ "extends": "./.nuxt/tsconfig.json" }' });
    expect(missingTsconfigFile(ts, join(root, "tsconfig.json"))).toBe(
      join(root, ".nuxt/tsconfig.json"),
    );
  });

  it("reads the generated tsconfig of a prepared module, whose paths hold `/*`", () => {
    const root = tree({
      "tsconfig.json": '{\n  // Nuxt\n  "extends": "./.nuxt/tsconfig.json"\n}',
      ".nuxt/tsconfig.json":
        '{ "compilerOptions": { "paths": { "~/*": ["../*"] } }, /* generated */ "include": ["../src"] }',
    });
    expect(missingTsconfigFile(ts, join(root, "tsconfig.json"))).toBeUndefined();
  });

  it("reads a tsconfig that starts with a byte-order mark, as TypeScript does", () => {
    const root = tree({ "tsconfig.json": '\uFEFF{ "extends": "./base" }', "base.json": "{}" });
    expect(missingTsconfigFile(ts, join(root, "tsconfig.json"))).toBeUndefined();
  });

  it("names a file that cannot be read as a tsconfig", () => {
    const root = tree({ "tsconfig.json": '{ "extends": ' });
    expect(() => missingTsconfigFile(ts, join(root, "tsconfig.json"))).toThrow(/cannot read/);
  });
});

describe("effectiveTsconfig", () => {
  it("uses a config whose chain is complete as it is", () => {
    const root = tree({ "tsconfig.json": "{}", "package.json": "{}" });
    expect(effectiveTsconfig(root, undefined)).toBe(join(root, "tsconfig.json"));
  });

  it("follows a tsconfig whose paths hold comment-like strings and trailing commas", () => {
    const root = tree({
      "tsconfig.json":
        '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] }, }, "include": ["src/**/*.ts"], }',
      "package.json": "{}",
    });
    expect(effectiveTsconfig(root, undefined)).toBe(join(root, "tsconfig.json"));
  });

  it("fails on a chain `nuxt prepare` would complete, saying to run it", () => {
    const root = tree({
      "tsconfig.json": '{ "extends": "./.nuxt/tsconfig.json" }',
      "package.json": "{}",
    });
    expect(() => effectiveTsconfig(root, undefined)).toThrow(/nuxi prepare/);
  });

  it("fails on any other broken chain instead of guessing options", () => {
    const root = tree({ "tsconfig.json": '{ "extends": "./base.json" }', "package.json": "{}" });
    expect(() => effectiveTsconfig(root, undefined)).toThrow(/base\.json, which does not exist/);
  });
});

describe("optionalTsconfig", () => {
  it("needs no tsconfig for a module that writes no declarations", () => {
    const root = tree({ "package.json": "{}" });
    expect(optionalTsconfig(join(root, "x"), "tsconfig.build.json", false)).toBeUndefined();
  });

  it("fails without a tsconfig when one is required", () => {
    const root = tree({ "package.json": "{}" });
    expect(() => optionalTsconfig(root, "tsconfig.build.json", true)).toThrow(
      /tsconfig\.build\.json, which does not exist/,
    );
  });
});
