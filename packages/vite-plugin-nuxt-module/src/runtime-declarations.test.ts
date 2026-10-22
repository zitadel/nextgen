import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FIXTURE_TSCONFIG, fixture, output } from "./__tests__/fixture.ts";
import {
  declarationCompilerOptions,
  declarationFileOf,
  emitRuntimeDeclarations,
  rewriteRuntimeTypeAliases,
} from "./runtime-declarations.ts";

describe("declarationFileOf", () => {
  it.each([
    ["/m/runtime/a.ts", "/m/runtime/a.d.ts"],
    ["/m/runtime/a.tsx", "/m/runtime/a.d.ts"],
    ["/m/runtime/a.mts", "/m/runtime/a.d.mts"],
    ["/m/runtime/a.cjs", "/m/runtime/a.d.cts"],
    ["/m/runtime/a.js", "/m/runtime/a.d.ts"],
    ["/m/runtime/C.vue", "/m/runtime/C.vue.d.ts"],
  ])("names the declaration of %s %s", (file, declaration) => {
    expect(declarationFileOf(file)).toBe(declaration);
  });
});

describe("rewriteRuntimeTypeAliases", () => {
  it("names #app and its subpaths nuxt/app, in imports and import types", () => {
    expect(
      rewriteRuntimeTypeAliases(
        'import { a } from "#app";\nimport type { b } from \'#app/composables\';\ntype C = import("#app/nuxt").C;\nimport { d } from "#imports";\n',
      ),
    ).toBe(
      'import { a } from "nuxt/app";\nimport type { b } from \'nuxt/app\';\ntype C = import("nuxt/app").C;\nimport { d } from "#imports";\n',
    );
  });
});

describe("declarationCompilerOptions", () => {
  it("emits declarations only, in memory, with the module's own options otherwise", () => {
    const options = declarationCompilerOptions({
      strict: true,
      outDir: "dist",
      rootDir: "src",
      declarationDir: "types",
      composite: true,
      noEmit: true,
      customConditions: ["workspace-source"],
    });
    expect([
      ["outDir", "rootDir", "declarationDir", "composite"].filter((key) => key in options),
      options,
    ]).toEqual([
      [],
      expect.objectContaining({
        strict: true,
        noEmit: false,
        declaration: true,
        emitDeclarationOnly: true,
        customConditions: [],
      }),
    ]);
  });
});

describe("emitRuntimeDeclarations", () => {
  const module = (files: Record<string, string>, link: string[] = ["typescript"]): string =>
    fixture(
      {
        "package.json": JSON.stringify({ name: "mod", type: "module" }),
        "tsconfig.json": FIXTURE_TSCONFIG,
        ...files,
      },
      { link },
    );
  const emit = (root: string, scripts: string[], vues: string[] = []) =>
    emitRuntimeDeclarations(
      {
        root,
        runtimeDir: join(root, "src/runtime"),
        outDir: join(root, "dist"),
        tsconfig: undefined,
        scope: { runtimeDir: join(root, "src/runtime"), entries: {} },
      },
      scripts.map((f) => join(root, f)),
      vues.map((f) => join(root, f)),
    );

  it("declares every runtime script, with explicit extensions", async () => {
    const root = module({
      "src/runtime/plugin.ts":
        'import type { X } from "./lib/x";\nexport const y = (x: X): number => x.n;\n',
      "src/runtime/lib/x.ts": "export interface X { n: number }\n",
    });
    await emit(root, ["src/runtime/plugin.ts", "src/runtime/lib/x.ts"]);
    expect([
      output(root, "dist/runtime/plugin.d.ts"),
      output(root, "dist/runtime/lib/x.d.ts"),
    ]).toEqual([
      expect.stringMatching(/from ["']\.\/lib\/x\.js["']/),
      expect.stringContaining("n: number"),
    ]);
  });

  it("declares a runtime .vue file through the vue-tsc of this plugin, which the module need not install", async () => {
    const root = module(
      {
        "src/runtime/C.vue":
          '<script setup lang="ts">\ndefineProps<{ label: string }>();\n</script>\n<template><p>{{ label }}</p></template>\n',
      },
      ["typescript", "vue"],
    );
    await emit(root, [], ["src/runtime/C.vue"]);
    expect(output(root, "dist/runtime/C.vue.d.ts")).toContain("label: string");
  }, 60_000);

  it("fails on a runtime import TypeScript cannot resolve, whose types the declaration would lose", async () => {
    const root = module({
      "src/runtime/plugin.ts":
        'import { defineNuxtPlugin } from "#imports";\nexport default defineNuxtPlugin(() => {});\n',
    });
    await expect(emit(root, ["src/runtime/plugin.ts"])).rejects.toThrow(
      /cannot resolve[\s\S]*#imports[\s\S]*prepare: true/,
    );
  });

  it("types a runtime import through an ambient declaration the tsconfig compiles with", async () => {
    const root = module({
      "src/shims.d.ts":
        'declare module "#imports" {\n  export function defineNuxtPlugin(setup: () => void): { plugin: true };\n}\n',
      "src/runtime/plugin.ts":
        'import { defineNuxtPlugin } from "#imports";\nexport default defineNuxtPlugin(() => {});\n',
    });
    await emit(root, ["src/runtime/plugin.ts"]);
    expect(output(root, "dist/runtime/plugin.d.ts")).toContain("plugin: true");
  });
});
