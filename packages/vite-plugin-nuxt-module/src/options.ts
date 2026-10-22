import { existsSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import type { UserConfig } from "vite";

import {
  NUXT_EXTENSION,
  NUXT_EXTENSIONS,
  NUXT_EXTERNALS,
  NUXT_MODULE_ENTRY,
  NUXT_SOURCEMAP,
  SOURCE_ROOT,
} from "./defaults.ts";
import { type EntryOption, namedEntries, resolvedEntries } from "./entries.ts";
import { type Matcher, moduleExternals } from "./externals.ts";
import { isModulePackage } from "./package-json.ts";
import { moduleRuntimeDir } from "./runtime.ts";

/** Options of {@link nuxtModule}. Every default is a named constant in `defaults.ts`. */
export interface NuxtModuleOptions {
  /** The module entry, relative to the project root, bundled to `<outDir>/module<extension>` (default `src/module.ts`). */
  readonly module?: string;
  /**
   * Further bundled entries next to the module (`{ server: "src/server.ts" }`, or a list named after
   * its files), like `@nuxt/module-builder`'s: each is bundled to `<outDir>/<name><extension>`
   * with its declarations. An entry may not lie in the runtime directory.
   */
  readonly entry?: EntryOption;
  /**
   * The runtime directory, relative to the project root, transpiled file by file into
   * `<outDir>/runtime` (never bundled: the consuming Nuxt app compiles it). Default `src/runtime`
   * when it exists; `false` for a module without one.
   */
  readonly runtimeDir?: string | false;
  /** Globs of runtime files (relative to the runtime directory) to skip, on top of tests and stories. */
  readonly runtimeExclude?: readonly string[];
  /** The directory holding the sources, relative to the project root (default `src`): its tests are never typed. */
  readonly sourceRoot?: string;
  /**
   * Extension of the bundled module and entries (default `.mjs`, what `@nuxt/module-builder`
   * writes; `.js` in a `"type": "module"` package). Each is written as `<name><extension>`, which
   * `module.json`, `types.d.mts` and the runtime's imports of the entries name.
   */
  readonly extension?: ".mjs" | ".js";
  /**
   * The tsconfig the module is typed and transpiled with, relative to the project root (default
   * `tsconfig.lib.json`, else `tsconfig.json`, else the nearest one above). One extending
   * `.nuxt/tsconfig.json` needs `nuxi prepare` (or `prepare: true`) first.
   */
  readonly tsconfig?: string;
  /** Extra specifiers to keep external, on top of every declared dependency, the Nuxt packages and the Node built-ins. */
  readonly external?: readonly Matcher[];
  /**
   * Packages to inline into the bundled module on purpose: declared dependencies that should be
   * bundled, and the packages that would otherwise fail the build as implicitly bundled.
   */
  readonly bundle?: readonly Matcher[];
  /** Build target (default `node20`). */
  readonly target?: string;
  /** Whether to write source maps, for the JS and the declarations (default off, like `@nuxt/module-builder`). */
  readonly sourcemap?: boolean;
  /**
   * Declaration output. `false` skips every `.d.ts`. `compatible` also writes each bundled entry's `.d.mts` as `.d.ts`
   * (unbuild's `declaration: true`), for consumers on `node10` resolution or `typesVersions` maps that point at `.d.ts`.
   * `eager` type-checks the whole program up front instead of per entry (rolldown-plugin-dts `eager`), needed when
   * declarations reach types through module augmentation or re-exported namespaces.
   */
  readonly dts?: false | { readonly compatible?: boolean; readonly eager?: boolean };
  /** Extra fields merged into `module.json` (after what `getMeta()` returns). */
  readonly moduleMeta?: Readonly<Record<string, unknown>>;
  /**
   * Run `nuxi prepare` first: Nuxt loads the module and writes `.nuxt/` (its tsconfig, `#app`,
   * `#imports`, `#build/*` types), which the module's tsconfig extends. Off by default, as in
   * `nuxt-module-build build`: a module usually prepares in `dev:prepare`, and a build whose
   * tsconfig chain is missing `.nuxt/tsconfig.json` fails saying so.
   */
  readonly prepare?: boolean;
  /** Warning codes to tolerate (every other warning fails the build). */
  readonly allowWarnings?: readonly string[];
}

/** Everything the build and its steps need, derived from {@link NuxtModuleOptions} and the Vite config. */
export interface ResolvedOptions {
  /** The project root (Vite's `root`). */
  readonly root: string;
  readonly sourceRoot: string;
  /** Bundled entries by output name (the module is `module`), files absolute. */
  readonly entry: Readonly<Record<string, string>>;
  readonly runtimeDir: string | undefined;
  readonly runtimeExclude: readonly string[];
  /** Matchers of the specifiers the module bundle leaves alone. */
  readonly external: readonly Matcher[];
  readonly bundle: readonly Matcher[];
  readonly extension: string;
  readonly target: string | undefined;
  /** The tsconfig as given (see {@link NuxtModuleOptions.tsconfig}). */
  readonly tsconfig: string | undefined;
  readonly dts: boolean;
  readonly compatible: boolean;
  readonly eager: boolean;
  readonly moduleMeta: Readonly<Record<string, unknown>> | undefined;
  readonly prepare: boolean;
  readonly sourcemap: boolean;
  readonly allowWarnings: readonly string[];
}

/**
 * Validates `options` and fills in every default, for the project at `root`. Fails on an option
 * the build could not honour, naming it, before anything is built.
 */
export function resolveOptions(
  options: NuxtModuleOptions,
  root: string,
  userConfig: Pick<UserConfig, "build"> = {},
): ResolvedOptions {
  const extension = options.extension ?? NUXT_EXTENSION;
  if (!NUXT_EXTENSIONS.includes(extension))
    throw new Error(
      `nuxtModule: extension ${extension} is not one of ${NUXT_EXTENSIONS.join(", ")}`,
    );
  // Node loads `.js` as ESM only in a module package; elsewhere `module.json`'s import of the module would fail.
  if (extension === ".js" && !isModulePackage(root))
    throw new Error(
      'nuxtModule: extension .js writes ESM, which Node loads as CommonJS outside a "type": "module" package; use .mjs',
    );
  const moduleFile = options.module ?? NUXT_MODULE_ENTRY;
  if (!existsSync(resolve(root, moduleFile)))
    throw new Error(`nuxtModule: no module to build: ${moduleFile} does not exist; set \`module\``);
  const runtimeDir = moduleRuntimeDir(root, options.runtimeDir);
  const entry = resolvedEntries(
    {
      module: moduleFile,
      ...(options.entry === undefined ? {} : namedEntries(options.entry)),
    },
    root,
  );
  // The runtime is built file by file: an entry inside it would be bundled, then replaced by its per-file build.
  const inRuntime = Object.values(entry).filter(
    (file) => runtimeDir && file.startsWith(`${runtimeDir.split(sep).join("/")}/`),
  );
  if (inRuntime.length)
    throw new Error(
      `nuxtModule: ${inRuntime.map((f) => relative(root, f)).join(", ")} lie in the runtime directory, which is built file by file; remove them from \`entry\``,
    );
  const dts = options.dts === false ? undefined : (options.dts ?? {});
  return {
    root,
    sourceRoot: options.sourceRoot ?? SOURCE_ROOT,
    entry,
    runtimeDir,
    runtimeExclude: options.runtimeExclude ?? [],
    external: [...NUXT_EXTERNALS, ...moduleExternals(root, options)],
    bundle: options.bundle ?? [],
    extension,
    target: options.target,
    tsconfig: options.tsconfig,
    dts: dts !== undefined,
    compatible: dts?.compatible === true,
    eager: dts?.eager === true,
    moduleMeta: options.moduleMeta,
    prepare: options.prepare === true,
    sourcemap: options.sourcemap ?? Boolean(userConfig.build?.sourcemap ?? NUXT_SOURCEMAP),
    allowWarnings: options.allowWarnings ?? [],
  };
}
