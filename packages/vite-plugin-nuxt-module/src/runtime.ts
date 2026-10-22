import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { RolldownMagicString, type RolldownPlugin } from "rolldown";
import { type Plugin, transformWithOxc } from "vite";

import { NUXT_RUNTIME_DIR, PLUGIN_PREFIX, RUNTIME_OUT_DIR, TEST_FILE_GLOBS } from "./defaults.ts";
import { matchesAnyGlob } from "./glob.ts";
import { compileSass } from "./sass.ts";
import { walk } from "./walk.ts";
import { emitRuntimeDeclarations, rewriteRuntimeTypeAliases } from "./runtime-declarations.ts";
import {
  applyEdits,
  DECLARATION_RE,
  isSassPartial,
  rewriteDeclarationImports,
  rewriteImports,
  runtimeOutName,
  SASS_RE,
  type SpecifierScope,
  sourceFileOf,
  specifierEdits,
} from "./specifiers.ts";
import { optionalTsconfig } from "./nuxt-tsconfig.ts";
import { transformSfc } from "./vue-sfc.ts";

/**
 * The module's runtime directory (absolute): the one given, which must exist, else `src/runtime`
 * when the module has one; `undefined` for `runtimeDir: false`.
 */
export function moduleRuntimeDir(
  root: string,
  runtimeDir: string | false | undefined,
): string | undefined {
  if (runtimeDir === false) return undefined;
  const dir = resolve(root, runtimeDir ?? NUXT_RUNTIME_DIR);
  if (existsSync(dir)) return dir;
  if (runtimeDir !== undefined)
    throw new Error(`nuxtModule: runtime directory ${runtimeDir} not found`);
  return undefined;
}

/** Runtime files never shipped: tests and stories (globs relative to the runtime directory). */
export const RUNTIME_EXCLUDE: readonly string[] = [...TEST_FILE_GLOBS, "**/*.stories.*"];

/** A script the runtime transpiles (and declares). */
const SCRIPT_RE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/** What the per-file runtime build needs to know. */
export interface RuntimeOptions {
  readonly root: string;
  /** Bundled entries by output name, files absolute. */
  readonly entry: Readonly<Record<string, string>>;
  readonly runtimeDir: string;
  /** Extra globs (relative to the runtime directory) of files to leave out. */
  readonly exclude: readonly string[];
  readonly extension: string;
  /** Emit the runtime's declarations (and require a tsconfig to type it with). */
  readonly dts: boolean;
  /** The module's tsconfig, as given (see {@link optionalTsconfig}). */
  readonly tsconfig: string | undefined;
  readonly outDir: string;
}

/** The runtime files that ship, relative to the runtime directory. */
export function runtimeFiles(runtimeDir: string, exclude: readonly string[]): string[] {
  const skipped = [...RUNTIME_EXCLUDE, ...exclude];
  return walk(runtimeDir).filter((file) => !matchesAnyGlob(file, skipped));
}

/** Bundled entry sources (module + extra entries) by absolute path, mapped to where they are written. */
export function specifierScope(
  o: Pick<RuntimeOptions, "runtimeDir" | "entry" | "extension">,
): SpecifierScope {
  return {
    runtimeDir: o.runtimeDir,
    entries: Object.fromEntries(
      Object.entries(o.entry).map(([name, file]) => [file, `${name}${o.extension}`]),
    ),
  };
}

/**
 * Prefix of the specifier a bundled entry's import of a runtime file has until its chunk is
 * rendered (`nuxt-module-runtime:composables/x.js`): the runtime file's path in `<outDir>/runtime`.
 */
export const RUNTIME_SPECIFIER = "nuxt-module-runtime:";

/** The stand-in specifier of runtime source `file` (see {@link RUNTIME_SPECIFIER}). */
export function runtimeSpecifier(runtimeDir: string, file: string): string {
  return `${RUNTIME_SPECIFIER}${runtimeOutName(relative(runtimeDir, file)).split(sep).join("/")}`;
}

/** The runtime source file a relative specifier written in `importer` names, if it lies in `runtimeDir`. */
function runtimeSource(runtimeDir: string, id: string, importer: string): string | undefined {
  if (!/^\.\.?\//.test(id)) return undefined;
  const target = resolve(dirname(importer), id);
  if (!target.startsWith(runtimeDir + sep)) return undefined;
  return sourceFileOf(target);
}

/**
 * `code`, a chunk written to `fileName` (relative to the output directory), with every stand-in
 * specifier made the path of its runtime file relative to the chunk (`./runtime/x.js` from
 * `index.mjs`, `../runtime/x.js` from `utils/headers.mjs` or `shared/x.mjs`), edited with a map.
 */
export function renderRuntimeSpecifiers(
  code: string,
  fileName: string,
): { code: string; map: string } | null {
  if (!code.includes(RUNTIME_SPECIFIER)) return null;
  const lang = DECLARATION_RE.test(fileName) ? "dts" : "js";
  const edits = specifierEdits(code, lang, (specifier) => {
    if (!specifier.startsWith(RUNTIME_SPECIFIER)) return undefined;
    const file = specifier.slice(RUNTIME_SPECIFIER.length);
    const path = posix.relative(posix.dirname(fileName), posix.join(RUNTIME_OUT_DIR, file));
    return path.startsWith(".") ? path : `./${path}`;
  });
  const s = new RolldownMagicString(code);
  for (const edit of edits) s.overwrite(edit.start, edit.end, edit.text);
  return { code: s.toString(), map: s.generateMap({ hires: true }).toString() };
}

/**
 * Bundled-entry imports of runtime files (`./runtime/plugin`) stay imports of the file built per
 * file, in the module's JS and in its declarations. Rolldown writes a relative external relative to
 * the common directory of the entries, not to the chunk that imports it (`../dist/runtime/x.js`
 * from `dist/index.mjs`, or a path through the build machine's root for another `outDir`), and an
 * inferred `import("./runtime/x")` type keeps the specifier written for the source file. No option
 * renders an external per chunk, so the import is a stand-in (see {@link RUNTIME_SPECIFIER}) until
 * each chunk is rendered, then the path relative to that chunk.
 */
function runtimeImports(runtimeDir: string) {
  return {
    resolveId(id: string, importer?: string) {
      if (id.startsWith(RUNTIME_SPECIFIER)) return { id, external: true };
      const file = importer && runtimeSource(runtimeDir, id, importer);
      return file ? { id: runtimeSpecifier(runtimeDir, file), external: true } : null;
    },
    renderChunk: renderRuntimeImports,
  };
}

/** Renders the stand-in specifiers of a chunk. After every other plugin's: the declaration bundler puts the import types back when it renders. */
const renderRuntimeImports = {
  order: "post" as const,
  handler: (code: string, chunk: { readonly fileName: string }) =>
    renderRuntimeSpecifiers(code, chunk.fileName),
};

/**
 * The module bundle's imports of runtime files (see {@link runtimeImports}). `runtimeDir` is read
 * when a module is resolved: the build's options are known only once Vite has resolved its config.
 */
export function nuxtRuntimeExternals(runtimeDir: () => string | undefined): Plugin {
  return {
    name: `${PLUGIN_PREFIX}:runtime-externals`,
    apply: "build",
    enforce: "pre",
    async resolveId(id, importer, opts) {
      const dir = runtimeDir();
      if (!dir) return null;
      if (id.startsWith(RUNTIME_SPECIFIER)) return { id, external: true };
      if (!importer || (!/^\.\.?\//.test(id) && !id.startsWith(dir))) return null;
      const resolved = await this.resolve(id, importer, { ...opts, skipSelf: true });
      if (!resolved || resolved.external || !resolved.id.startsWith(dir + sep)) return null;
      return { id: runtimeSpecifier(dir, resolved.id), external: true };
    },
    renderChunk: renderRuntimeImports,
  };
}

/**
 * `code`, a declaration TypeScript wrote for `importer`, with each inferred `import("./runtime/x")`
 * type that names a runtime file made the stand-in specifier: the declaration bundler keeps the
 * specifier of an external import type as written, relative to the source file.
 */
export function runtimeImportTypes(code: string, importer: string, runtimeDir: string): string {
  return applyEdits(
    code,
    specifierEdits(code, "dts", (specifier) => {
      const file = runtimeSource(runtimeDir, specifier, importer);
      return file ? runtimeSpecifier(runtimeDir, file) : undefined;
    }),
  );
}

/**
 * The declaration bundle leaves runtime files alone too: types import the runtime file's own
 * declaration (`./runtime/x.js`), built per file, whether the source wrote `./runtime/x` or
 * `./runtime/x.js`, and whether the import is written or inferred (never a copy of its types).
 */
export function declarationRuntimeExternals(runtimeDir: string): RolldownPlugin {
  const imports = runtimeImports(runtimeDir);
  return {
    name: `${PLUGIN_PREFIX}:dts-runtime-externals`,
    resolveId(id: string, importer?: string) {
      // Like rollup-plugin-dts' default: types of any package (declared or not) are imported, never inlined.
      if (
        importer &&
        !/^\.\.?(\/|$)/.test(id) &&
        !id.startsWith("/") &&
        !id.startsWith("\0") &&
        !id.startsWith(RUNTIME_SPECIFIER)
      )
        return { id, external: true };
      return imports.resolveId(id, importer);
    },
    transform: {
      order: "pre",
      handler(code: string, id: string) {
        if (!/\.d\.[cm]?ts$/.test(id) || !code.includes("import(")) return null;
        // The declaration of `src/x.ts` is the module `src/x.d.ts`: its import types are relative to it.
        const next = runtimeImportTypes(code, id, runtimeDir);
        return next === code ? null : { code: next };
      },
    },
    renderChunk: imports.renderChunk,
  };
}

/**
 * Writes `runtimeDir` file by file into `outDir/runtime`, like `mkdist` (what `nuxt-module-build`
 * runs for it): scripts transpiled (never bundled: the consuming Nuxt app compiles them) with their
 * imports given explicit extensions, `.vue` files with their TypeScript stripped and their Sass
 * compiled, Sass stylesheets compiled to CSS (partials, only ever imported, skipped), hand-written
 * declarations shipped with their imports rewritten, everything else copied; then, with `dts`, the
 * runtime's declarations.
 */
export async function buildRuntime(o: RuntimeOptions): Promise<void> {
  const out = join(o.outDir, RUNTIME_OUT_DIR);
  const files = runtimeFiles(o.runtimeDir, o.exclude).filter((f) => !isSassPartial(f));
  const scope = specifierScope(o);
  rmSync(out, { recursive: true, force: true });
  const scripts: string[] = [];
  // The module's own tsconfig (its chain checked), so oxc honours what it sets: `useDefineForClassFields`, JSX.
  const tsconfig = optionalTsconfig(o.root, o.tsconfig, o.dts);
  for (const rel of files) {
    const from = join(o.runtimeDir, rel);
    const dest = join(out, runtimeOutName(rel));
    mkdirSync(dirname(dest), { recursive: true });
    if (DECLARATION_RE.test(rel)) {
      writeFileSync(
        dest,
        rewriteRuntimeTypeAliases(
          rewriteDeclarationImports(readFileSync(from, "utf8"), from, scope),
        ),
      );
    } else if (SCRIPT_RE.test(rel)) {
      const source = readFileSync(from, "utf8");
      const code = /\.(?:[cm]?tsx?|jsx)$/.test(rel)
        ? (
            await transformWithOxc(source, from, {
              target: "esnext",
              sourcemap: false,
              tsconfig,
              jsx: { runtime: "automatic", importSource: "vue", development: false },
            })
          ).code
        : source;
      writeFileSync(dest, rewriteImports(code, from, scope));
      scripts.push(from);
    } else if (SASS_RE.test(rel)) {
      writeFileSync(dest, await compileSass(o.root, from, false));
    } else if (rel.endsWith(".vue")) {
      writeFileSync(dest, await transformSfc(o.root, from, rel));
    } else {
      writeFileSync(dest, readFileSync(from));
    }
  }
  if (o.dts) {
    await emitRuntimeDeclarations(
      { ...o, scope },
      scripts,
      files.filter((f) => f.endsWith(".vue")).map((f) => join(o.runtimeDir, f)),
    );
  }
}
