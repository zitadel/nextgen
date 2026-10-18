import type { Plugin } from "vite";

import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";

/** Options for {@link svelteSource}. */
interface SvelteSourceOptions {
  /** Library source root to publish (default `"src/lib"`). */
  readonly input?: string;
  /** Directory inside Vite's output directory to publish it to (default `"svelte"`). */
  readonly output?: string;
}

/** Recursively collect absolute file paths under `dir`. */
function walk(dir: string): readonly string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/**
 * Publishes the library as Svelte source next to the compiled bundle.
 *
 * `vite-plugin-svelte` compiles the components for the browser, and a compiled
 * component cannot be compiled again for the server. A SvelteKit app only
 * compiles what the package's `svelte` export condition points at, and only
 * when it is still `.svelte`, so server rendering needs the sources. After the
 * bundle is written this copies the `.svelte` files unchanged and transpiles
 * the `.ts` modules to JavaScript, the way `svelte-package` lays out a library,
 * into `<outDir>/<output>`. The compiled bundle stays the `default` export for
 * plain Vite apps.
 */
export function svelteSource(options: SvelteSourceOptions = {}): Plugin {
  const inputRel = options.input ?? "src/lib";
  const outputRel = options.output ?? "svelte";
  let root = process.cwd();
  let outDir = "dist";

  return {
    name: "vite-plugin-svelte-source",
    apply: "build",

    configResolved(config) {
      root = config.root;
      outDir = path.resolve(config.root, config.build.outDir);
    },

    closeBundle() {
      const input = path.resolve(root, inputRel);
      const output = path.join(outDir, outputRel);
      fs.rmSync(output, { recursive: true, force: true });

      for (const file of walk(input)) {
        if (/\.(spec|test)\.ts$/.test(file) || file.includes(`${path.sep}__tests__${path.sep}`)) {
          continue;
        }
        const relative = path.relative(input, file);
        const dest = path.join(output, relative);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (file.endsWith(".svelte")) {
          fs.copyFileSync(file, dest);
        } else if (file.endsWith(".ts") && !file.endsWith(".d.ts")) {
          const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
            fileName: file,
          });
          fs.writeFileSync(dest.replace(/\.ts$/, ".js"), outputText);
        }
      }
    },
  };
}
