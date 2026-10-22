import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildFixture, fixture, withTools } from "./__tests__/fixture.ts";
import {
  hoistedTypePaths,
  moduleDeclarationOptions,
  nuxtModuleOutputs,
  sharedChunkFileNames,
  writeCompatibleDeclarations,
} from "./outputs.ts";

/** A module package of `files` that installs this package's own TypeScript, as the declaration steps type with it. */
const tree = (files: Record<string, string>): string => fixture(files, { link: ["typescript"] });

const schemaInKit = "node_modules/@nuxt/kit/node_modules/@nuxt/schema";

/**
 * A module shaped like the module starter: it depends on `@nuxt/kit` only, whose `defineNuxtModule()` returns
 * `@nuxt/schema`'s `NuxtModule`, installed where the module itself cannot resolve it (pnpm's layout).
 */
const starterModule = {
  "package.json": JSON.stringify({
    name: "starter-module",
    version: "1.0.0",
    type: "module",
    dependencies: { "@nuxt/kit": "*" },
  }),
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      target: "ESNext",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      skipLibCheck: true,
      types: [],
    },
    include: ["src"],
  }),
  "src/module.ts":
    'import { defineNuxtModule } from "@nuxt/kit";\n\nexport default defineNuxtModule({ meta: { name: "starter" }, defaults: { greeting: "hi" } });\n',
  "node_modules/@nuxt/kit/package.json": JSON.stringify({
    name: "@nuxt/kit",
    type: "module",
    exports: { ".": { types: "./index.d.ts", default: "./index.mjs" } },
  }),
  "node_modules/@nuxt/kit/index.mjs":
    "export const defineNuxtModule = (d) => Object.assign(() => {}, { getMeta: () => d.meta });\n",
  "node_modules/@nuxt/kit/index.d.ts":
    'import type { NuxtModule } from "@nuxt/schema";\nexport declare function defineNuxtModule<T>(definition: { meta?: { name?: string }; defaults?: T }): NuxtModule<T>;\n',
  [`${schemaInKit}/package.json`]: JSON.stringify({ name: "@nuxt/schema", types: "./index.d.ts" }),
  [`${schemaInKit}/index.d.ts`]:
    "export interface NuxtModule<T> {\n  (options: T): void;\n  getMeta?: () => unknown;\n}\n",
};

/**
 * The same module laid out like pnpm: `@nuxt/kit` and `@nuxt/schema` live in `node_modules/.pnpm`, linked into the
 * module's `node_modules` and next to each other. The module resolves `@nuxt/schema` itself, but the declaration
 * program reaches it only through the link next to `@nuxt/kit`.
 */
function pnpmStarterModule(): string {
  const kit = "node_modules/.pnpm/@nuxt+kit@1/node_modules/@nuxt/kit";
  const schema = "node_modules/.pnpm/@nuxt+schema@1/node_modules/@nuxt/schema";
  const root = tree({
    ...Object.fromEntries(
      Object.entries(starterModule).filter(([p]) => !p.startsWith("node_modules/")),
    ),
    [`${kit}/package.json`]: starterModule["node_modules/@nuxt/kit/package.json"],
    [`${kit}/index.mjs`]: starterModule["node_modules/@nuxt/kit/index.mjs"],
    [`${kit}/index.d.ts`]: starterModule["node_modules/@nuxt/kit/index.d.ts"],
    [`${schema}/package.json`]: starterModule[`${schemaInKit}/package.json`],
    [`${schema}/index.d.ts`]: starterModule[`${schemaInKit}/index.d.ts`],
  });
  const link = (target: string, path: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    symlinkSync(join(root, target), join(root, path), "dir");
  };
  link(kit, "node_modules/@nuxt/kit");
  link(schema, "node_modules/@nuxt/schema");
  link(schema, "node_modules/.pnpm/@nuxt+kit@1/node_modules/@nuxt/schema");
  return root;
}

async function buildModule(root: string): Promise<void> {
  await buildFixture(root, { runtimeDir: false });
}

describe("hoistedTypePaths", () => {
  it("maps @nuxt/schema to the copy @nuxt/kit has when the module cannot resolve it", () => {
    const root = tree(starterModule);
    expect(hoistedTypePaths(root)["@nuxt/schema"]).toEqual([join(root, schemaInKit)]);
  });

  it("maps @nuxt/schema to the module's own copy when it has one", () => {
    const root = tree({
      ...starterModule,
      "node_modules/@nuxt/schema/package.json": JSON.stringify({ name: "@nuxt/schema" }),
    });
    expect(hoistedTypePaths(root)["@nuxt/schema"]).toEqual([
      join(root, "node_modules/@nuxt/schema"),
    ]);
  });

  it("maps nothing for a module without Nuxt packages", () => {
    expect(hoistedTypePaths(tree({ "package.json": "{}" }))).toEqual({});
  });

  it("maps #app/nuxt into the installed nuxt, like nuxt-module-build", () => {
    const root = tree({ "package.json": "{}", "node_modules/nuxt/package.json": "{}" });
    expect(hoistedTypePaths(root)["#app/nuxt"]).toEqual([
      join(root, "node_modules/nuxt/dist/app/nuxt"),
    ]);
  });
});

describe("moduleDeclarationOptions", () => {
  it("adds @nuxt/schema to the tsconfig's types when the module resolves it", () => {
    const root = tree({
      ...starterModule,
      "tsconfig.json": JSON.stringify({ compilerOptions: { types: ["node"] } }),
      "node_modules/@nuxt/schema/package.json": JSON.stringify({ name: "@nuxt/schema" }),
    });
    expect(moduleDeclarationOptions(root, join(root, "tsconfig.json")).types).toEqual([
      "node",
      "@nuxt/schema",
    ]);
  });

  it("adds no types the module cannot resolve", () => {
    const root = tree(starterModule);
    expect(moduleDeclarationOptions(root, join(root, "tsconfig.json")).types).toBeUndefined();
  });

  it("keeps the tsconfig's own paths, made absolute, next to the hoisted ones", () => {
    const root = tree({
      ...starterModule,
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "~/*": ["./src/*"] } } }),
    });
    expect(moduleDeclarationOptions(root, join(root, "tsconfig.json")).paths?.["~/*"]).toEqual([
      join(root, "src/*"),
    ]);
  });
});

describe("sharedChunkFileNames", () => {
  it("writes shared chunks under shared/, like nuxt-module-build", () => {
    expect(sharedChunkFileNames(".mjs")).toBe("shared/[name].[hash].mjs");
  });
});

describe("writeCompatibleDeclarations", () => {
  it("copies each entry's .d.mts to a .d.ts", () => {
    const root = withTools({ name: "mod" }, {});
    mkdirSync(join(root, "dist"));
    writeFileSync(join(root, "dist/module.d.mts"), "export {};");
    writeCompatibleDeclarations(join(root, "dist"), ["module", "missing"]);
    expect([
      readFileSync(join(root, "dist/module.d.ts"), "utf8"),
      existsSync(join(root, "dist/missing.d.ts")),
    ]).toEqual(["export {};", false]);
  });
});

describe("nuxtModuleOutputs", () => {
  it("writes nothing after a failed build", async () => {
    const root = withTools({ name: "mod" }, {});
    const plugin = nuxtModuleOutputs(() => ({
      root,
      sourceRoot: "src",
      entry: { module: join(root, "src/module.ts") },
      runtimeDir: undefined,
      runtimeExclude: [],
      external: [],
      bundle: [],
      extension: ".mjs",
      target: undefined,
      dts: true,
      compatible: false,
      eager: false,
      tsconfig: join(root, "tsconfig.json"),
      moduleMeta: undefined,
      prepare: false,
      sourcemap: false,
      allowWarnings: [],
    }));
    (plugin.configResolved as unknown as (c: unknown) => void)({
      root,
      build: { outDir: "dist" },
      plugins: [],
    });
    (plugin.buildEnd as unknown as (e: Error) => void)(new Error("x"));
    await (plugin.closeBundle as unknown as () => Promise<void>)();
    expect(existsSync(join(root, "dist/module.json"))).toBe(false);
  });

  it("declares a module that depends on @nuxt/kit only", async () => {
    const root = tree(starterModule);
    await buildModule(root);
    expect(readFileSync(join(root, "dist/module.d.mts"), "utf8")).toContain(
      'import("@nuxt/schema").NuxtModule',
    );
  }, 60_000);

  it("declares a module that depends on @nuxt/kit only when its tsconfig sets declaration", async () => {
    const tsconfig = JSON.parse(starterModule["tsconfig.json"]);
    const root = tree({
      ...starterModule,
      "tsconfig.json": JSON.stringify({
        ...tsconfig,
        compilerOptions: { ...tsconfig.compilerOptions, declaration: true },
      }),
    });
    await buildModule(root);
    expect(readFileSync(join(root, "dist/module.d.mts"), "utf8")).toContain(
      'import("@nuxt/schema").NuxtModule',
    );
  }, 60_000);

  it("declares a module whose @nuxt/schema is linked in by pnpm", async () => {
    const root = pnpmStarterModule();
    await buildModule(root);
    expect(readFileSync(join(root, "dist/module.d.mts"), "utf8")).toContain(
      'import("@nuxt/schema").NuxtModule',
    );
  }, 60_000);

  it("writes no source maps by default", async () => {
    const root = tree(starterModule);
    await buildModule(root);
    expect([
      existsSync(join(root, "dist/module.mjs.map")),
      existsSync(join(root, "dist/module.d.mts.map")),
    ]).toEqual([false, false]);
  }, 60_000);

  it.each([
    [{ ".": { types: "./dist/types.d.mts", import: "./dist/module.mjs" } }, true],
    [{ ".": { types: "./dist/module.d.mts", import: "./dist/module.mjs" } }, false],
  ])(
    "writes module.json, and types.d.mts when the exports %j name it",
    async (exportsMap, typesEntry) => {
      const pkg = JSON.parse(starterModule["package.json"]);
      const root = tree({
        ...starterModule,
        "package.json": JSON.stringify({ ...pkg, exports: exportsMap }),
      });
      await buildModule(root);
      expect([
        JSON.parse(readFileSync(join(root, "dist/module.json"), "utf8")).name,
        existsSync(join(root, "dist/types.d.mts")),
      ]).toEqual(["starter", typesEntry]);
    },
    60_000,
  );
});
