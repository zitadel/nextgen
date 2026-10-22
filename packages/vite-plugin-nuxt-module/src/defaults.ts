/**
 * The conventions every option falls back to. A module that follows them names none of them; one
 * that does not overrides the matching option of `nuxtModule()`.
 */

/** Directory holding a package's sources: its tests are never typed, and a self-import maps into it. */
export const SOURCE_ROOT = "src";

/** Directory the build writes to, relative to the package root (Vite's `build.outDir` wins). */
export const OUT_DIR = "dist";

/** The tsconfig a module is typed and transpiled with, when it has one. */
export const LIB_TSCONFIG = "tsconfig.lib.json";

/** The project tsconfig, used where a package has no library-specific one. */
export const PROJECT_TSCONFIG = "tsconfig.json";

/**
 * Target of the bundled module. A module's code runs inside `nuxt dev` / `nuxt build`, which need
 * Node 20 or newer.
 */
export const NODE_TARGET = "node20";

/**
 * Compiler options every declaration step overrides: dependencies resolve the way a consumer
 * resolves them, through their published types. A custom condition (a workspace's source
 * condition) would pull a dependency's sources into the program, outside `rootDir`.
 */
export const CONSUMER_COMPILER_OPTIONS: { readonly customConditions: string[] } = {
  customConditions: [],
};

/** Source files that are tests, relative to a source root: never shipped, never typed. */
export const TEST_FILE_GLOBS: readonly string[] = ["**/*.spec.*", "**/*.test.*", "**/__tests__/**"];

/** Prefix of every Vite plugin this package adds, so they are recognisable in Vite's logs. */
export const PLUGIN_PREFIX = "nuxt-module";

/** The module entry, relative to the package root, bundled to `<outDir>/module<extension>`. */
export const NUXT_MODULE_ENTRY = `${SOURCE_ROOT}/module.ts`;

/** The runtime directory, relative to the package root, transpiled file by file into `<outDir>/runtime`. */
export const NUXT_RUNTIME_DIR = `${SOURCE_ROOT}/runtime`;

/** Extension of the bundled module and its entries: what `@nuxt/module-builder` writes. */
export const NUXT_EXTENSION = ".mjs";

/** The extensions the bundled entries may have: ESM that Node imports (`module.json` is read from it). */
export const NUXT_EXTENSIONS: readonly string[] = [".mjs", ".js"];

/** Whether the build writes source maps (JS and declarations) when `sourcemap` is not given: `@nuxt/module-builder`'s default. */
export const NUXT_SOURCEMAP = false;

/** The matchers a Nuxt module's own bundle never inlines: Nuxt provides (or compiles) these in the app. */
export const NUXT_EXTERNALS: readonly (string | RegExp)[] = [
  /^#/,
  /^@nuxt\//,
  /^nuxt(-nightly|-edge|3)?($|\/)/,
  /^h3($|\/)/,
  /^nitropack($|\/)/,
  /^nitro($|\/)/,
  /^vue($|\/)/,
  /^vue-demi($|\/)/,
];

/** The `module.json` file name `@nuxt/module-builder` writes next to the module. */
export const MODULE_JSON = "module.json";

/** Directory the per-file runtime is written to, inside `outDir`. */
export const RUNTIME_OUT_DIR = "runtime";

/** The directory `nuxi prepare` writes a module's generated types and tsconfig into. */
export const NUXT_BUILD_DIR = ".nuxt";

/** The warning code of a package bundled into the module without being one of its dependencies. */
export const IMPLICIT_DEPENDENCY = "NUXT_IMPLICIT_DEPENDENCY";
