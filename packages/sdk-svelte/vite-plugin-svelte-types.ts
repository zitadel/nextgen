import type { Plugin } from 'vite';

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { emitDts } from 'svelte2tsx';

const require = createRequire(import.meta.url);

/** Options for {@link svelteTypes}. */
interface SvelteTypesOptions {
  /** Library source root passed to `emitDts` (default `"src"`). */
  readonly input?: string;
}

/** Recursively collect absolute file paths under `dir`. */
function walk(dir: string): readonly string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/**
 * Emits `.d.ts` for a Svelte library after Vite has written the JS bundle.
 *
 * `vite-plugin-svelte` compiles `.svelte` to JS but emits no types, and `tsc`
 * cannot read `.svelte` at all. This plugin runs `svelte2tsx`'s `emitDts` — the
 * same engine `@sveltejs/package` wraps — in `closeBundle`, then copies only
 * the declaration files into Vite's output directory, leaving the bundle
 * untouched. The net effect is that a single `vite build` produces both the
 * compiled JS and correct Svelte 5 component types, exactly like the
 * `vite-plugin-solid` and Qwik optimizer plugins do for their frameworks.
 */
export function svelteTypes(options: SvelteTypesOptions = {}): Plugin {
  const inputRel = options.input ?? 'src';
  let outDir = 'dist';
  let root = process.cwd();

  return {
    name: 'vite-plugin-svelte-types',
    apply: 'build',

    configResolved(config) {
      root = config.root;
      outDir = path.resolve(config.root, config.build.outDir);
    },

    async closeBundle() {
      const tmp = path.join(outDir, '.types-tmp');
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.mkdirSync(tmp, { recursive: true });

      await emitDts({
        libRoot: path.resolve(root, inputRel),
        svelteShimsPath: require.resolve('svelte2tsx/svelte-shims-v4.d.ts'),
        declarationDir: path.relative(root, tmp),
      });

      for (const file of walk(tmp)) {
        if (!/\.d\.ts(\.map)?$/.test(file)) {
          continue;
        }
        const dest = path.join(outDir, path.relative(tmp, file));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(file, dest);
      }

      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}
