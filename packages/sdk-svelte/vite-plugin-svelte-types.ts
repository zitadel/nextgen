import type { Plugin } from "vite";

import { createRequire } from "node:module";
import * as path from "node:path";
import { emitDts } from "svelte2tsx";

const require = createRequire(import.meta.url);

/** Options for {@link svelteTypes}. */
interface SvelteTypesOptions {
  /** Library source root passed to `emitDts`, relative to the Vite root. */
  readonly input: string;
  /** The tsconfig `emitDts` reads, relative to the Vite root. */
  readonly tsconfig: string;
}

/**
 * Emits the declarations of a Svelte library into the build's output directory.
 *
 * `vite-plugin-svelte` compiles `.svelte` to JS but emits no types, and neither
 * `tsc` nor `unplugin-dts` can read `.svelte`. This runs `svelte2tsx`'s
 * `emitDts`, the engine `@sveltejs/package` wraps, once Vite has written the
 * bundle, so a single `vite build` produces both.
 */
export function svelteTypes({ input, tsconfig }: SvelteTypesOptions): Plugin {
  let root = process.cwd();
  let outDir = "dist";

  return {
    name: "svelte-types",
    apply: "build",
    configResolved(config) {
      root = config.root;
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      return emitDts({
        libRoot: path.resolve(root, input),
        svelteShimsPath: require.resolve("svelte2tsx/svelte-shims-v4.d.ts"),
        declarationDir: outDir,
        // Absolute, because emitDts resolves a bare name against `libRoot`.
        tsconfig: path.resolve(root, tsconfig),
      });
    },
  };
}
