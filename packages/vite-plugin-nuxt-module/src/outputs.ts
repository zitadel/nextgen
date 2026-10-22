import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";

import { emitBundledTypes } from "./declarations/bundle.ts";
import { PLUGIN_PREFIX } from "./defaults.ts";
import type { ResolvedOptions } from "./options.ts";
import { packageTypeScript, realPackageDirectory } from "./resolve.ts";
import { absolutePaths, parsedTsconfig } from "./tsconfig.ts";
import { afterBuild } from "./warnings.ts";
import { writeModuleJson } from "./module-json.ts";
import { buildRuntime, declarationRuntimeExternals } from "./runtime.ts";
import { effectiveTsconfig } from "./nuxt-tsconfig.ts";
import { writeTypesEntry } from "./types-entry.ts";

/** Where shared chunks of the bundled module go, per extension (what `nuxt-module-build` writes). */
export const sharedChunkFileNames = (ext: string): string => `shared/[name].[hash]${ext}`;

/**
 * Packages a module's declaration names types from without depending on them: `defineNuxtModule()` returns
 * `@nuxt/schema`'s `NuxtModule`, and a module usually depends on `@nuxt/kit` alone. Nuxt hoists them into the
 * generated tsconfig's `paths`; the declaration step does the same, through the Nuxt packages the module has.
 */
export const NUXT_HOISTED_TYPES: readonly string[] = ["@nuxt/schema"];

/** The Nuxt packages a hoisted type package is looked for through, in order. */
const HOISTED_FROM: readonly string[] = ["@nuxt/kit", "nuxt"];

/** Where a {@link NUXT_HOISTED_TYPES} package is installed: the module's own copy, else its Nuxt packages' copy. */
function hoistedTypeDir(name: string, root: string): string | undefined {
  const own = realPackageDirectory(name, root);
  if (own) return own;
  for (const via of HOISTED_FROM) {
    const viaDir = realPackageDirectory(via, root);
    const dir = viaDir && realPackageDirectory(name, viaDir);
    if (dir) return dir;
  }
  return undefined;
}

/**
 * `paths` that let the declaration emitter name the types a module's declaration needs, like the `paths` Nuxt writes
 * into `.nuxt/tsconfig.json` and `nuxt-module-build` adds: each {@link NUXT_HOISTED_TYPES} package, from the module or
 * else from where its Nuxt packages have it, and `#app/nuxt`. Without them a module that depends on `@nuxt/kit` only
 * fails with TS2742 / TS2883 ("cannot be named without a reference to @nuxt/schema").
 */
export function hoistedTypePaths(root: string): Record<string, string[]> {
  const paths: Record<string, string[]> = {};
  for (const name of NUXT_HOISTED_TYPES) {
    const dir = hoistedTypeDir(name, root);
    if (!dir) continue;
    paths[name] = [dir];
    paths[`${name}/*`] = [`${dir}/*`];
  }
  const nuxt = realPackageDirectory("nuxt", root);
  if (nuxt) paths["#app/nuxt"] = [join(nuxt, "dist/app/nuxt")];
  return paths;
}

/**
 * The compiler options the module declaration is emitted with on top of its tsconfig, so TypeScript can name
 * `@nuxt/schema`'s types in it:
 *
 * - `paths` gains {@link hoistedTypePaths} under the tsconfig's own (made absolute: an override replaces them
 *   wholesale), so the package has a bare name that maps to where it is installed;
 * - `types` gains each {@link NUXT_HOISTED_TYPES} package the module resolves itself, so the program holds it under
 *   that name. The declaration program holds just the module entry, which otherwise reaches `@nuxt/schema` only
 *   through `@nuxt/kit`'s own link to it; `nuxt-module-build`'s program holds every file the prepared tsconfig
 *   includes, which reference it by name.
 */
export function moduleDeclarationOptions(
  root: string,
  tsconfig: string,
): { paths?: Record<string, string[]>; types?: string[] } {
  const ts = packageTypeScript(root);
  const { options } = parsedTsconfig(ts, tsconfig);
  const result: { paths?: Record<string, string[]>; types?: string[] } = {};
  const own = options.types ?? ts.getAutomaticTypeDirectiveNames(options, ts.sys);
  const types = NUXT_HOISTED_TYPES.filter((n) => !own.includes(n) && realPackageDirectory(n, root));
  if (types.length) result.types = [...own, ...types];
  const hoisted = hoistedTypePaths(root);
  if (Object.keys(hoisted).length) {
    result.paths = { ...hoisted, ...absolutePaths(options, tsconfig) };
  }
  return result;
}

/** `<name>.d.ts` copies of each bundled entry's `<name>.d.mts`, for consumers on `node10` resolution. */
export function writeCompatibleDeclarations(outDir: string, names: readonly string[]): void {
  for (const name of names) {
    const mts = join(outDir, `${name}.d.mts`);
    if (existsSync(mts)) writeFileSync(join(outDir, `${name}.d.ts`), readFileSync(mts));
  }
}

/**
 * The per-file runtime and its declarations, written once the module bundle is, like every step
 * after it: nothing of it after a failed build. Listed before {@link nuxtModuleOutputs}, it runs
 * first (steps run in plugin order).
 */
export function nuxtRuntime(options: () => ResolvedOptions): Plugin {
  return afterBuild(`${PLUGIN_PREFIX}:runtime`, (config) => {
    const o = options();
    if (!o.runtimeDir) return;
    return buildRuntime({
      root: o.root,
      entry: o.entry,
      runtimeDir: o.runtimeDir,
      exclude: o.runtimeExclude,
      extension: o.extension,
      dts: o.dts,
      tsconfig: o.tsconfig,
      outDir: resolve(config.root, config.build.outDir),
    });
  });
}

/**
 * After the build: the bundled entries' declarations, `module.json` and, when the package's manifest names it (the
 * module starter's `exports["."].types`), `types.d.mts`: unnamed, no consumer would ever load it.
 */
export function nuxtModuleOutputs(options: () => ResolvedOptions): Plugin {
  return afterBuild(`${PLUGIN_PREFIX}:outputs`, async (config) => {
    const o = options();
    const outDir = resolve(config.root, config.build.outDir);
    if (o.dts) {
      const tsconfig = effectiveTsconfig(o.root, o.tsconfig);
      await emitBundledTypes({
        root: o.root,
        entry: o.entry,
        tsconfig,
        external: o.external,
        exts: [o.extension],
        outDir,
        pinTsconfig: true,
        eager: o.eager,
        allowWarnings: o.allowWarnings,
        sourcemap: o.sourcemap,
        sourceRoot: o.sourceRoot,
        compilerOptions: moduleDeclarationOptions(o.root, tsconfig),
        chunkFileNames: sharedChunkFileNames,
        plugins: o.runtimeDir ? [declarationRuntimeExternals(o.runtimeDir)] : [],
      });
      // `module.mjs` → `module.d.mts`; an entry built as `.js` would pair with `.d.ts`.
      if (o.compatible && o.extension === ".mjs")
        writeCompatibleDeclarations(outDir, Object.keys(o.entry));
    }
    await writeModuleJson({ ...o, outDir });
    if (o.dts) writeTypesEntry(o.root, outDir, o.extension);
  });
}
