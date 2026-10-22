import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { fixture } from "./__tests__/fixture.ts";
import { packageTypeScript } from "./resolve.ts";
import { absolutePaths, packageTsconfig, parsedTsconfig } from "./tsconfig.ts";

describe("parsedTsconfig", () => {
  it("applies the extends chain, with overrides on top", () => {
    const root = fixture({
      "package.json": "{}",
      "base.json": JSON.stringify({ compilerOptions: { strict: true, jsx: "preserve" } }),
      "tsconfig.json": JSON.stringify({ extends: "./base.json", compilerOptions: {} }),
    });
    const ts = packageTypeScript(root);
    const { options } = parsedTsconfig(ts, join(root, "tsconfig.json"), { noEmit: true });
    expect([options.strict, options.jsx, options.noEmit]).toEqual([
      true,
      ts.JsxEmit.Preserve,
      true,
    ]);
  });

  it("fails on a tsconfig it cannot read, naming it", () => {
    const root = fixture({ "package.json": "{}" });
    const tsconfig = join(root, "missing.json");
    expect(() => parsedTsconfig(packageTypeScript(root), tsconfig)).toThrow(
      `cannot read ${tsconfig}`,
    );
  });
});

describe("absolutePaths", () => {
  it("resolves inherited paths against the tsconfig that declares them, and own ones against baseUrl", () => {
    const root = fixture({
      "package.json": "{}",
      "config/base.json": JSON.stringify({ compilerOptions: { paths: { "a/*": ["../a/*"] } } }),
      "tsconfig.json": JSON.stringify({ extends: "./config/base.json" }),
      "tsconfig.own.json": JSON.stringify({
        compilerOptions: { baseUrl: "./lib", paths: { "b/*": ["b/*"] } },
      }),
    });
    const ts = packageTypeScript(root);
    const paths = (name: string) =>
      absolutePaths(parsedTsconfig(ts, join(root, name)).options, join(root, name));
    expect([paths("tsconfig.json"), paths("tsconfig.own.json")]).toEqual([
      { "a/*": [join(root, "a/*")] },
      { "b/*": [join(root, "lib/b/*")] },
    ]);
  });

  it("is empty without paths", () => {
    expect(absolutePaths({}, "/pkg/tsconfig.json")).toEqual({});
  });
});

describe("packageTsconfig", () => {
  const tree = (files: Record<string, string>): string => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "nuxt-module-tsconfig-")));
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(dir, name, ".."), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    return dir;
  };

  it("prefers tsconfig.lib.json, then tsconfig.json", () => {
    const withLib = tree({ "tsconfig.json": "{}", "tsconfig.lib.json": "{}" });
    const without = tree({ "tsconfig.json": "{}" });
    expect([packageTsconfig(withLib), packageTsconfig(without)]).toEqual([
      join(withLib, "tsconfig.lib.json"),
      join(without, "tsconfig.json"),
    ]);
  });

  it("falls back to the nearest tsconfig.json above a monorepo package", () => {
    const root = tree({ "tsconfig.json": "{}", "packages/x/package.json": "{}" });
    expect(packageTsconfig(join(root, "packages/x"))).toBe(join(root, "tsconfig.json"));
  });

  it("takes a named tsconfig as it is, without looking further", () => {
    const root = tree({ "tsconfig.json": "{}" });
    expect(packageTsconfig(root, "tsconfig.build.json")).toBe(join(root, "tsconfig.build.json"));
  });
});
