import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FIXTURE_TSCONFIG, fixture } from "../__tests__/fixture.ts";
import { declarationTypeErrors, isSourceTest, sourceTypeErrors } from "./check.ts";

/** The compiler options of {@link FIXTURE_TSCONFIG}. */
const fixtureOptions = JSON.parse(FIXTURE_TSCONFIG).compilerOptions as Record<string, unknown>;

describe("sourceTypeErrors", () => {
  it("reports a type error of the sources, relative to the root", () => {
    const root = fixture({
      "package.json": "{}",
      "tsconfig.json": FIXTURE_TSCONFIG,
      "src/index.ts": 'export const x: number = "s";\n',
    });
    expect(sourceTypeErrors(root, join(root, "tsconfig.json"))).toEqual([
      expect.stringMatching(/^src\/index\.ts\(1,14\): error TS2322/),
    ]);
  });

  it("reports nothing for sources that type-check", () => {
    const root = fixture({
      "package.json": "{}",
      "tsconfig.json": FIXTURE_TSCONFIG,
      "src/index.ts": "export const x: number = 1;\n",
    });
    expect(sourceTypeErrors(root, join(root, "tsconfig.json"))).toEqual([]);
  });

  it("reports an option error, as tsc -p does", () => {
    const root = fixture({
      "package.json": "{}",
      "tsconfig.json": JSON.stringify({
        compilerOptions: { ...fixtureOptions, types: ["nonexistent-types"] },
        include: ["src"],
      }),
      "src/index.ts": "export const x: number = 1;\n",
    });
    expect(sourceTypeErrors(root, join(root, "tsconfig.json"))).toEqual([
      expect.stringMatching(/TS2688/),
    ]);
  });

  it("leaves the tests under the source root out", () => {
    const root = fixture({
      "package.json": "{}",
      "tsconfig.json": FIXTURE_TSCONFIG,
      "src/index.ts": "export const x: number = 1;\n",
      "src/index.test.ts": 'describe("x", () => {});\n',
      "src/__tests__/helper.ts": "expect(1);\n",
    });
    expect(sourceTypeErrors(root, join(root, "tsconfig.json"))).toEqual([]);
  });

  it("checks under the compiler options the declarations are emitted with", () => {
    const root = fixture(
      {
        "package.json": "{}",
        "tsconfig.json": FIXTURE_TSCONFIG,
        "vendor/schema/index.d.ts": "export interface Module {\n  name: string;\n}\n",
        "src/index.ts":
          'import type { Module } from "schema";\nexport const m: Module = { name: "m" };\n',
      },
      { link: ["typescript"] },
    );
    expect(
      sourceTypeErrors(root, join(root, "tsconfig.json"), {
        overrides: { paths: { schema: [join(root, "vendor/schema")] } },
      }),
    ).toEqual([]);
  });
});

describe("isSourceTest", () => {
  it.each([
    ["src/a.test.ts", true],
    ["src/deep/a.spec.tsx", true],
    ["src/__tests__/helper.ts", true],
    ["src/a.ts", false],
    ["scripts/a.test.ts", false],
  ])("reads %s as a test under src: %s", (file, expected) => {
    expect(isSourceTest("/pkg", "src", `/pkg/${file}`)).toBe(expected);
  });
});

describe("declarationTypeErrors", () => {
  it("reports an error inside the written declarations only", () => {
    const root = fixture({
      "package.json": "{}",
      "tsconfig.json": FIXTURE_TSCONFIG,
      "dist/index.d.mts": "export type A = missing_ns.B;\n",
    });
    expect(
      declarationTypeErrors(root, join(root, "tsconfig.json"), join(root, "dist"), [
        join(root, "dist/index.d.mts"),
      ]),
    ).toEqual([expect.stringMatching(/dist\/index\.d\.mts\(1,17\): error TS2503/)]);
  });

  it("leaves a dependency's own declarations to it", () => {
    const root = fixture(
      {
        "package.json": "{}",
        "tsconfig.json": FIXTURE_TSCONFIG,
        "node_modules/dep/package.json": JSON.stringify({ name: "dep", types: "./index.d.ts" }),
        "node_modules/dep/index.d.ts": "export type B = broken_ns.C;\n",
        "dist/index.d.mts": 'export type { B } from "dep";\n',
      },
      { link: ["typescript"] },
    );
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src/index.ts"), "export {};\n");
    expect(
      declarationTypeErrors(root, join(root, "tsconfig.json"), join(root, "dist"), [
        join(root, "dist/index.d.mts"),
      ]),
    ).toEqual([]);
  });

  it("reads the declarations with the compiler options they were emitted under", () => {
    const root = fixture(
      {
        "package.json": "{}",
        "tsconfig.json": FIXTURE_TSCONFIG,
        "vendor/schema/index.d.ts": "export interface Module {}\n",
        "dist/index.d.mts": 'export type M = import("schema").Module;\n',
      },
      { link: ["typescript"] },
    );
    expect(
      declarationTypeErrors(
        root,
        join(root, "tsconfig.json"),
        join(root, "dist"),
        [join(root, "dist/index.d.mts")],
        { paths: { schema: [join(root, "vendor/schema")] } },
      ),
    ).toEqual([]);
  });
});
