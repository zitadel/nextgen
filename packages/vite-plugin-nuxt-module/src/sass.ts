import { resolve } from "node:path";

import { importFromRoot } from "./resolve.ts";

/** The Sass compilers this package can drive (`sass` or `sass-embedded`), in the order they are tried. */
export const SASS_COMPILERS: readonly string[] = ["sass", "sass-embedded"];

/** The options this package passes to Sass. */
interface SassOptions {
  style?: "compressed" | "expanded";
  loadPaths?: string[];
  url?: URL;
  syntax?: "scss" | "indented";
}

/** The two Sass entry points this package uses. */
export interface Sass {
  compile(file: string, options: SassOptions): { css: string };
  compileString(source: string, options: SassOptions): { css: string };
}

interface SassModule extends Partial<Sass> {
  readonly default?: Sass;
}

/** The module's own Sass compiler: the first of {@link SASS_COMPILERS} it can import. */
export async function packageSass(root: string): Promise<Sass> {
  for (const name of SASS_COMPILERS) {
    try {
      const sass = await importFromRoot<SassModule>(name, root);
      const api = sass.compile && sass.compileString ? (sass as Sass) : sass.default;
      if (api) return api;
    } catch {
      // not installed in the package: try the next compiler
    }
  }
  throw new Error(
    `none of ${SASS_COMPILERS.join(", ")} is installed in ${root}: add one to its devDependencies to compile Sass`,
  );
}

/** `file` (a `.scss` / `.sass` stylesheet) compiled to CSS with the module's own Sass. */
export async function compileSass(root: string, file: string, minify: boolean): Promise<string> {
  const sass = await packageSass(root);
  return sass.compile(file, {
    style: minify ? "compressed" : "expanded",
    loadPaths: [resolve(root, "node_modules")],
  }).css;
}
