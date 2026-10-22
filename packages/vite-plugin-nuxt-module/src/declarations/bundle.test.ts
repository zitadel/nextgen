import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { FIXTURE_TSCONFIG, fixture, output } from "../__tests__/fixture.ts";
import type { RolldownPlugin } from "rolldown";

import {
  ASSET_IMPORT,
  CSS_MODULE_IMPORT,
  emitBundledTypes,
  mergedCompilerOptions,
  STRING_ASSET_IMPORT,
} from "./bundle.ts";

/** Writes the bundled declarations of `src/index.ts` of a fixture into its `dist`. */
const emit = (
  root: string,
  external: RegExp[] = [],
  options: Partial<Parameters<typeof emitBundledTypes>[0]> = {},
) =>
  emitBundledTypes({
    root,
    entry: { index: join(root, "src/index.ts") },
    tsconfig: join(root, "tsconfig.json"),
    external,
    exts: [".mjs"],
    outDir: join(root, "dist"),
    ...options,
  });

describe("mergedCompilerOptions", () => {
  it("merges paths and lets the second options win otherwise", () => {
    expect(
      mergedCompilerOptions(
        { paths: { a: ["/a"] }, types: ["x"] },
        { paths: { b: ["/b"] }, types: ["y"] },
      ),
    ).toEqual({ paths: { a: ["/a"], b: ["/b"] }, types: ["y"] });
  });
});

describe("ASSET_IMPORT", () => {
  it.each([
    ["./x.css?inline", true],
    ["./template.liquid", true],
    ["./x.ts", false],
  ])("treats %s as an asset: %s", (id, expected) => {
    expect(ASSET_IMPORT.test(id)).toBe(expected);
  });
});

describe("STRING_ASSET_IMPORT", () => {
  it.each([
    ["./x.css?inline", true],
    ["./template.liquid", true],
    ["./logo.svg?react", false],
    ["./worker.ts?worker", false],
    ["./x.module.css", false],
    ["./x.module.css?inline", true],
  ])("types %s as a string: %s", (id, expected) => {
    expect(STRING_ASSET_IMPORT.test(id)).toBe(expected);
  });
});

describe("CSS_MODULE_IMPORT", () => {
  it.each([
    ["./x.module.css", true],
    ["./x.module.scss", true],
    ["./x.css", false],
  ])("types %s as a class map: %s", (id, expected) => {
    expect(CSS_MODULE_IMPORT.test(id)).toBe(expected);
  });
});

describe("emitBundledTypes", () => {
  it("fails on a type error the declaration emit itself lets through", async () => {
    const root = fixture({
      "package.json": JSON.stringify({ name: "fx", type: "module" }),
      "tsconfig.json": FIXTURE_TSCONFIG,
      "src/index.ts": 'export const x: number = "s";\n',
    });
    await expect(emit(root)).rejects.toThrow(/1 type error\(s\)[\s\S]*TS2322/);
  }, 60_000);

  it("fails when the written declarations do not type-check (a namespace the bundler never declares)", async () => {
    const root = fixture(
      {
        "package.json": JSON.stringify({ name: "fx", type: "module" }),
        "tsconfig.json": FIXTURE_TSCONFIG,
        "node_modules/dep/package.json": JSON.stringify({ name: "dep", types: "./index.d.ts" }),
        "node_modules/dep/index.d.ts": "export interface Props { a: number }\n",
        "src/types.ts": 'export type * from "dep";\n',
        "src/index.ts":
          'import type { Props } from "./types";\nexport * from "./types";\nexport type MyProps = Props & { b: string };\nexport const f = (p: MyProps): number => p.a;\n',
      },
      { link: ["typescript"] },
    );
    await expect(emit(root, [/^dep/])).rejects.toThrow(/TS2503: Cannot find namespace/);
  }, 60_000);

  it("types a string-valued asset import instead of importing a file that is not shipped", async () => {
    const root = fixture({
      "package.json": JSON.stringify({ name: "fx", type: "module" }),
      "tsconfig.json": FIXTURE_TSCONFIG,
      "src/assets.d.ts": 'declare module "*.liquid" { const text: string; export default text; }\n',
      "src/template.liquid": "<p>{{ x }}</p>",
      "src/index.ts": 'export { default as template } from "./template.liquid";\n',
    });
    await emit(root);
    expect(output(root, "dist/index.d.mts")).toMatch(
      /^(?![\s\S]*from ["']\.\/template\.liquid)[\s\S]*: string/,
    );
  }, 60_000);
});

describe("emitBundledTypes re-exports", () => {
  it("keeps a package's types a type-only star re-export when the entry reaches it through a module", async () => {
    const root = fixture(
      {
        "package.json": JSON.stringify({ name: "fx", type: "module" }),
        "tsconfig.json": FIXTURE_TSCONFIG,
        "node_modules/dep/package.json": JSON.stringify({ name: "dep", types: "./index.d.ts" }),
        "node_modules/dep/index.d.ts":
          "export declare const EVENTS: readonly string[];\nexport interface Event {\n  name: string;\n}\n",
        "src/types.ts": 'export type * from "dep";\n',
        "src/index.ts": 'export * from "./types";\nexport const a = (): number => 1;\n',
      },
      { link: ["typescript"] },
    );
    await emit(root, [/^dep/]);
    expect(output(root, "dist/index.d.mts")).toMatch(/^export type \* from "dep";$/m);
  }, 60_000);

  it("builds a package that imports its own name before its declarations exist", async () => {
    const root = fixture({
      "package.json": JSON.stringify({
        name: "fx",
        type: "module",
        exports: {
          ".": { types: "./dist/index.d.mts", import: "./dist/index.mjs" },
          "./sub": { types: "./dist/lib/sub.d.mts", import: "./dist/lib/sub.mjs" },
        },
      }),
      "tsconfig.json": FIXTURE_TSCONFIG,
      "src/lib/sub.ts": "export interface SubT {\n  s: string;\n}\n",
      "src/index.ts":
        'import type { SubT } from "fx/sub";\nexport const s = (x: SubT): string => x.s;\n',
    });
    await emit(root, [/^fx($|\/)/], {
      entry: { index: join(root, "src/index.ts"), "lib/sub": join(root, "src/lib/sub.ts") },
    });
    expect(output(root, "dist/index.d.mts")).toContain('from "fx/sub"');
  }, 60_000);
});

describe("emitBundledTypes assets", () => {
  const assetPackage = () =>
    fixture({
      "package.json": JSON.stringify({ name: "fx", type: "module" }),
      "tsconfig.json": FIXTURE_TSCONFIG,
      "src/assets.d.ts": [
        'declare module "*.liquid" { const text: string; export default text; }',
        'declare module "*.module.css" { const c: { readonly [k: string]: string }; export default c; }',
        "",
      ].join("\n"),
      "src/template.liquid": "<p>{{ x }}</p>",
      "src/x.module.css": ".a { color: red }",
      "src/index.ts":
        'export { default as template } from "./template.liquid";\nexport { default as styles } from "./x.module.css";\n',
    });

  it("types a CSS module import as its class names, the object Vite makes of it", async () => {
    const root = assetPackage();
    await emit(root);
    expect(output(root, "dist/index.d.mts")).toMatch(
      /const (\w+): \{\s*readonly \[key: string\]: string;?\s*\};[\s\S]*\1 as styles/,
    );
  }, 60_000);

  it("maps every declaration to a file that exists", async () => {
    const root = assetPackage();
    await emit(root);
    const { sources } = JSON.parse(output(root, "dist/index.d.mts.map")) as { sources: string[] };
    expect(sources.filter((source) => !existsSync(resolve(root, "dist", source)))).toEqual([]);
  }, 60_000);
});

describe("emitBundledTypes warnings", () => {
  const warning: RolldownPlugin = {
    name: "warns",
    buildStart() {
      this.warn({ message: "careful", code: "OWN_CODE" });
    },
  };
  const plain = () =>
    fixture({
      "package.json": JSON.stringify({ name: "fx", type: "module" }),
      "tsconfig.json": FIXTURE_TSCONFIG,
      "src/index.ts": "export const a = 1;\n",
    });

  it("allows a plugin warning by the code its plugin gave it, like the JS build", async () => {
    const root = plain();
    await emit(root, [], { plugins: [warning], allowWarnings: ["OWN_CODE"] });
    expect(existsSync(join(root, "dist/index.d.mts"))).toBe(true);
  }, 60_000);

  it("fails on a plugin warning that is not allowed, naming its code", async () => {
    await expect(emit(plain(), [], { plugins: [warning] })).rejects.toThrow(/OWN_CODE: careful/);
  }, 60_000);
});
