import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin, UserConfig } from "vite";

import { NODE_TARGET, OUT_DIR, PLUGIN_PREFIX } from "./defaults.ts";
import { implicitDependencies } from "./implicit-dependencies.ts";
import { noBuildPaths } from "./no-build-paths.ts";
import { optionalTsconfig } from "./nuxt-tsconfig.ts";
import { type NuxtModuleOptions, type ResolvedOptions, resolveOptions } from "./options.ts";
import { nuxtModuleOutputs, nuxtRuntime, sharedChunkFileNames } from "./outputs.ts";
import { prepareModule } from "./prepare.ts";
import { nuxtRuntimeExternals } from "./runtime.ts";
import { packageTsconfig } from "./tsconfig.ts";
import { type BuildOutcome, failOnLoggedWarnings, failOnWarnings } from "./warnings.ts";

/**
 * The Vite build of a Nuxt module, as a set of plugins that read the project's own Vite config
 * (`root`, `build.outDir`, ...) and add what `@nuxt/module-builder` does:
 *
 * - the module (`src/module.ts`) and any extra `entry` are bundled to `<outDir>/<name>.mjs`, with
 *   bundled `.d.mts` declarations, and every warning fails the build;
 * - the runtime directory (`src/runtime`) is transpiled file by file into `<outDir>/runtime`
 *   (`.js` + `.d.ts`, `.vue` files with their TypeScript stripped and their Sass compiled),
 *   because the consuming Nuxt app compiles it;
 * - `module.json` (from the module's `getMeta()`) and `types.d.mts` are written last.
 *
 * ```ts
 * export default defineConfig({
 *   plugins: [nuxtModule({ entry: { server: "src/server.ts" } })],
 * });
 * ```
 *
 * Vite's own `build.outDir`, `build.emptyOutDir`, `build.minify` and `build.target` still decide
 * where and how it writes; this plugin's defaults apply where they are not set. The plugins apply
 * to `vite build` only.
 */
export function nuxtModule(options: NuxtModuleOptions = {}): Plugin[] {
  let resolved: ResolvedOptions | undefined;
  const current = (): ResolvedOptions => {
    if (!resolved) throw new Error("nuxtModule: used before Vite resolved its config");
    return resolved;
  };
  const outcome: BuildOutcome = { failed: false };
  const logged = failOnLoggedWarnings(outcome);

  const config: Plugin = {
    name: `${PLUGIN_PREFIX}:config`,
    apply: "build",
    enforce: "pre",
    async config(user) {
      const root = resolve(user.root ?? process.cwd());
      const o = resolveOptions(options, root, user);
      resolved = o;
      if (o.prepare) await prepareModule(root, o.entry.module ?? "");
      // A module's tsconfig usually extends `.nuxt/tsconfig.json`, which only a prepare writes.
      optionalTsconfig(root, o.tsconfig, o.dts || o.prepare);
      return buildConfig(o, user, logged.customLogger, outcome);
    },
  };

  return [
    logged.plugin,
    config,
    nuxtRuntimeExternals(() => current().runtimeDir),
    implicitDependencies(current),
    noBuildPaths(() => current().root),
    nuxtRuntime(current),
    nuxtModuleOutputs(current),
  ];
}

/**
 * The Vite config the module is built with: ESM entries for Node, every declared dependency, the
 * Nuxt packages and the Node built-ins external, warnings as errors. A setting the project's own
 * Vite config makes (`build.outDir`, ...) is left to it.
 */
export function buildConfig(
  o: ResolvedOptions,
  user: UserConfig,
  customLogger: NonNullable<UserConfig["customLogger"]>,
  outcome: BuildOutcome,
): UserConfig {
  const policy = failOnWarnings(o.allowWarnings, outcome);
  const tsconfig = packageTsconfig(o.root, o.tsconfig);
  return {
    // The JS compiles with the same tsconfig as the types (decorators, class fields), not with
    // whichever tsconfig.json is nearest each file. Without one, Vite looks for the nearest itself.
    ...(tsconfig && existsSync(tsconfig) ? { tsconfig } : {}),
    ...(user.customLogger ? {} : { customLogger }),
    ...(user.publicDir === undefined ? { publicDir: false } : {}),
    // Node packages resolve like Node (builtins real, `node` condition): Vite's SSR mode.
    ssr: { noExternal: true },
    build: {
      ssr: true,
      target: user.build?.target ?? o.target ?? NODE_TARGET,
      sourcemap: o.sourcemap,
      outDir: user.build?.outDir ?? OUT_DIR,
      emptyOutDir: user.build?.emptyOutDir ?? true,
      minify: user.build?.minify ?? false,
      lib: {
        // Named and absolute, so the declaration step sees the same entries the bundle has.
        entry: { ...o.entry },
        formats: ["es"],
      },
      rolldownOptions: {
        external: [...o.external],
        // An entry exports exactly what its source exports; code it shares goes to chunks.
        preserveEntrySignatures: "strict",
        // Region comments and chunk names are relative to the package, wherever Vite runs from.
        cwd: o.root,
        output: {
          // A Vite SSR build names entries `[name].js` whatever `lib.fileName` says.
          entryFileNames: (chunk: { name: string }) => `${chunk.name}${o.extension}`,
          exports: "named",
          topLevelVar: false,
          chunkFileNames: sharedChunkFileNames(o.extension),
        },
        // Both hooks are needed: some warnings never reach `onwarn`.
        onLog: policy.onLog,
        onwarn: policy.onwarn,
      },
    },
  };
}
