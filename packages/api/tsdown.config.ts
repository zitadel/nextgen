import { defineConfig } from "tsdown";

/**
 * Library build for `@zitadel-nextgen/api`.
 *
 * The orval-generated client is consumed two ways:
 *
 * - Workspace dev — Vite/Vitest with `resolve.conditions` set to
 *   `@zitadel-nextgen/source` resolves the `exports` map straight to
 *   `src/**\/*.ts`, so iteration is hot and no rebuild is needed.
 * - External production builds (e.g. `nuxt build` consuming the
 *   built `@zitadel-nextgen/components` dist) get the default
 *   `import` condition and load these `.mjs` files instead.
 *
 * Each subpath the components package imports gets its own entry so
 * Rollup can resolve `@zitadel-nextgen/api/runtime/base-url`,
 * `@zitadel-nextgen/api/generated/endpoints/zitadelNextGen`, etc.
 * directly.
 */
export default defineConfig({
  entry: {
    "runtime/base-url": "src/runtime/base-url.ts",
    "generated/model/index": "src/generated/model/index.ts",
    "generated/endpoints/zitadelNextGen": "src/generated/endpoints/zitadelNextGen.ts",
    "generated/endpoints/zitadelNextGen.msw":
      "src/generated/endpoints/zitadelNextGen.msw.ts",
    "generated/endpoints/zitadelNextGen.zod":
      "src/generated/endpoints/zitadelNextGen.zod.ts",
  },
  outDir: "dist",
  format: ["esm"],
  tsconfig: "tsconfig.lib.json",
  dts: true,
  sourcemap: true,
  // `clean: true` would wipe the .d.ts files tsgo emits during the
  // `typecheck` target, breaking project-reference consumers
  // (api-mock, components, sdk-next) whose tsgo --build expects those
  // .d.ts files to exist. tsdown still overwrites its own .mjs/.d.mts
  // outputs on each rebuild — stale files just accumulate harmlessly
  // until a full `git clean` or `nx reset`.
  clean: false,
  target: "es2022",
  external: ["msw", "zod", "@faker-js/faker"],
});
