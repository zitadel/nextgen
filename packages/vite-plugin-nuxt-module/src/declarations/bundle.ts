import { dirname, join, resolve } from "node:path";
import { rolldown, type RolldownPlugin } from "rolldown";
import { dts as rolldownDts } from "rolldown-plugin-dts";

import { CONSUMER_COMPILER_OPTIONS, PLUGIN_PREFIX, SOURCE_ROOT } from "../defaults.ts";
import type { Matcher } from "../externals.ts";
import { noBuildPaths } from "../no-build-paths.ts";
import { failOnDeclarationWarnings } from "../warnings.ts";
import { type CompilerOverrides, declarationTypeErrors, sourceTypeErrors } from "./check.ts";
import { finishedDeclarations } from "./rendered.ts";
import { selfReferenceOptions } from "./self-reference.ts";

/** Imports with no types of their own (`./x.css?inline`, `./x.liquid`, `./x.svg?react`, `./x.module.scss`). */
export const ASSET_IMPORT =
  /\?[a-z]+$|\.(css|liquid|svg|png|jpe?g|gif|webp|woff2?)$|\.module\.(css|scss|sass|less|styl|stylus|pcss|postcss|sss)$/;

/**
 * Asset imports whose value is a string: an `?inline` / `?raw` / `?url` import, or a plain file
 * import, which Vite turns into the file's URL (a raw-text plugin, like a `.liquid` loader, into
 * its text). Their declarations inline `string`. Any other query (`?react`, `?worker`) stays an
 * import: only the source's ambient `declare module` knows what it is. A CSS module is not one.
 */
export const STRING_ASSET_IMPORT =
  /\?(?:inline|raw|url)$|(?<!\.module)\.(css|liquid|svg|png|jpe?g|gif|webp|woff2?)$/;

/** CSS module imports (`./x.module.css`): Vite turns them into an object of class names. */
export const CSS_MODULE_IMPORT = /\.module\.(css|scss|sass|less|styl|stylus|pcss|postcss|sss)$/;

/** The declaration of a string-valued asset module. */
export const STRING_ASSET_DECLARATION = "declare const asset: string;\nexport default asset;\n";

/** The declaration of a CSS module: its class names, as Vite's own `vite/client` types it. */
export const CSS_MODULE_DECLARATION =
  "declare const classes: { readonly [key: string]: string };\nexport default classes;\n";

/** Suffix of the declaration module that stands in for a string-valued asset, and of a CSS module's. */
const DECLARATION_SUFFIXES = {
  ".asset.d.ts": STRING_ASSET_DECLARATION,
  ".classes.d.ts": CSS_MODULE_DECLARATION,
} as const;

/**
 * Asset imports in the declaration bundle. A string-valued one, or a CSS module, resolves to a
 * declaration module of its own, so the published types say what the import's value is instead of
 * importing a file the package does not ship (whose `declare module` only the package's own
 * sources see); any other stays an import. The stand-in's source map points at the asset itself,
 * so no declaration map names a file that exists nowhere.
 */
export function declarationAssets(): RolldownPlugin {
  return {
    name: `${PLUGIN_PREFIX}:dts-assets`,
    resolveId(id: string, importer?: string) {
      if (!ASSET_IMPORT.test(id)) return null;
      const suffix = STRING_ASSET_IMPORT.test(id)
        ? ".asset.d.ts"
        : CSS_MODULE_IMPORT.test(id)
          ? ".classes.d.ts"
          : undefined;
      if (!suffix || !importer) return { id, external: true };
      return { id: `${resolve(dirname(importer), id.replace(/\?.*$/, ""))}${suffix}` };
    },
    load(id: string) {
      const suffix = Object.keys(DECLARATION_SUFFIXES).find((s) => id.endsWith(s)) as
        | keyof typeof DECLARATION_SUFFIXES
        | undefined;
      if (!suffix) return null;
      return {
        code: DECLARATION_SUFFIXES[suffix],
        map: {
          version: 3,
          file: id,
          sources: [id.slice(0, -suffix.length)],
          names: [],
          mappings: "AAAA;AAAA",
        },
      };
    },
  };
}

/** Options of the bundled declaration step. */
export interface BundledTypesOptions {
  root: string;
  entry: Record<string, string>;
  tsconfig: string;
  external: readonly Matcher[];
  /** JS extensions the declarations sit next to: `.mjs` gives `.d.mts`, `.js` gives `.d.ts`. */
  exts: readonly string[];
  /** Resolve every declaration eagerly (needed when a plugin generates modules the declaration step must see). */
  eager?: boolean;
  /** Same allow-list as the JS build: a declaration warning fails the build unless its code is listed. */
  allowWarnings?: readonly string[];
  /** Extra rolldown plugins that run before the declaration step (e.g. to externalize files built another way). */
  plugins?: readonly RolldownPlugin[];
  /** Hand `tsconfig` to rolldown too, instead of letting it discover the nearest one next to each file. */
  pinTsconfig?: boolean;
  /** Pattern for shared declaration chunks, per extension (default `[name]-[hash]<ext>`). */
  chunkFileNames?: (ext: string) => string;
  /** Write a `.d.mts.map` (`.d.ts.map`, ...) next to each declaration file (default on). */
  sourcemap?: boolean;
  /** Compiler options over the tsconfig's own (and over {@link CONSUMER_COMPILER_OPTIONS}). */
  compilerOptions?: CompilerOverrides;
  /** The source root, relative to `root` (default `src`): its tests are not type-checked, and a self-import maps into it. */
  sourceRoot?: string;
}

/**
 * `a` and `b` (compiler options over a tsconfig's) as one: `b` wins, except that `paths` (which
 * replace the tsconfig's wholesale) are merged.
 */
export function mergedCompilerOptions(
  a: CompilerOverrides = {},
  b: CompilerOverrides = {},
): CompilerOverrides {
  const paths = { ...(a.paths as object | undefined), ...(b.paths as object | undefined) };
  return { ...a, ...b, ...(Object.keys(paths).length > 0 ? { paths } : {}) };
}

/**
 * Writes one bundled declaration file per entry and extension into `outDir`, with
 * `rolldown-plugin-dts` (the engine `tsdown` uses). The sources are type-checked first (a type
 * error fails the build), and the written entry declarations after, as a consumer reads them. A package that imports its own name has the
 * self-reference mapped to its sources (see {@link selfReferenceOptions}): its own declarations
 * are not written yet when the check runs.
 */
export async function emitBundledTypes(o: BundledTypesOptions & { outDir: string }): Promise<void> {
  const sourceRoot = o.sourceRoot ?? SOURCE_ROOT;
  const selfReference = selfReferenceOptions(
    o.root,
    o.outDir,
    resolve(o.root, sourceRoot),
    o.tsconfig,
    o.entry,
  );
  const compilerOptions = mergedCompilerOptions(selfReference.compilerOptions, o.compilerOptions);
  const sourceErrors = sourceTypeErrors(o.root, o.tsconfig, {
    overrides: compilerOptions,
    sourceRoot,
  });
  if (sourceErrors.length > 0)
    throw new Error(
      `declarations: ${sourceErrors.length} type error(s):\n${sourceErrors.join("\n")}`,
    );
  const written: string[] = [];
  const sourcemap = o.sourcemap ?? true;
  const bundle = await rolldown({
    input: o.entry,
    cwd: o.root,
    ...(o.pinTsconfig ? { tsconfig: o.tsconfig } : {}),
    external: [...o.external],
    plugins: [
      ...(o.plugins ?? []),
      declarationAssets(),
      noBuildPaths(() => o.root) as RolldownPlugin,
      finishedDeclarations(),
      rolldownDts({
        emitDtsOnly: true,
        tsconfig: o.tsconfig,
        sourcemap,
        compilerOptions: { ...CONSUMER_COMPILER_OPTIONS, ...compilerOptions },
        ...(o.eager ? { eager: true } : {}),
      }),
    ],
    onLog: failOnDeclarationWarnings(o.allowWarnings ?? []),
  });
  for (const ext of o.exts) {
    // Shared declaration chunks keep their real export names: mangled ones (`Oy`) would be what editors show
    // for every type that crosses a chunk boundary.
    const { output } = await bundle.write({
      dir: o.outDir,
      format: "es",
      entryFileNames: `[name]${ext}`,
      chunkFileNames: o.chunkFileNames?.(ext) ?? `[name]-[hash]${ext}`,
      sourcemap,
      minifyInternalExports: false,
    });
    for (const file of output)
      if (file.type === "chunk" && file.isEntry) written.push(join(o.outDir, file.fileName));
  }
  await bundle.close();
  // Read with the options they were emitted under: the `paths` / `types` a framework hoists for its consumers.
  const errors = declarationTypeErrors(o.root, o.tsconfig, o.outDir, written, compilerOptions);
  if (errors.length > 0)
    throw new Error(
      `declarations: the written declarations have ${errors.length} type error(s):\n${errors.join("\n")}`,
    );
}
