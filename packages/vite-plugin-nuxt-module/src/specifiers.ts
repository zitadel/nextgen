import { existsSync, statSync } from "node:fs";
import { basename, dirname, extname, join, posix, relative, resolve, sep } from "node:path";
import { parseAst } from "vite";

/** A declaration file name. */
export const DECLARATION_RE = /\.d\.[cm]?ts$/;

/** Source extensions a relative specifier may leave out, in resolution order. */
export const SOURCE_EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".vue"];

/** A Sass stylesheet, compiled to `.css` in the runtime output. */
export const SASS_RE = /\.s[ac]ss$/;

/** A Sass partial (`_vars.scss`): only ever `@use`d, never compiled or shipped on its own. */
export const isSassPartial = (file: string): boolean =>
  SASS_RE.test(file) && basename(file).startsWith("_");

/**
 * Where a runtime source file lands in `outDir/runtime` (`.ts` → `.js`, Sass → `.css`, `.vue` and other assets keep
 * their name).
 */
export function runtimeOutName(file: string): string {
  if (DECLARATION_RE.test(file)) return file;
  return file
    .replace(/\.(ts|tsx|jsx)$/, ".js")
    .replace(/\.mts$/, ".mjs")
    .replace(/\.cts$/, ".cjs")
    .replace(SASS_RE, ".css");
}

/**
 * Where the per-file runtime sits relative to the bundled entries. A runtime file may import a source file outside
 * the runtime dir that is itself a bundled entry (`../../utils/headers` → `src/utils/headers.ts`, built as
 * `utils/headers.mjs`): that import must point at the entry's output, not at a per-file `.js` that never exists.
 */
export interface SpecifierScope {
  readonly runtimeDir: string;
  /** Absolute entry source file → its output path relative to `outDir` (`utils/headers.mjs`). */
  readonly entries: Readonly<Record<string, string>>;
}

const isFile = (p: string): boolean => existsSync(p) && statSync(p).isFile();

/** TypeScript extensions a `.js` specifier can stand for (TS NodeNext style: `./x.js` for `x.ts`). */
const TS_EXTS = [".ts", ".tsx", ".mts", ".cts"];

/**
 * The source file a relative import resolved to `target` names, the way TypeScript's bundler
 * resolution finds it: the file as written, its TypeScript source when written as `.js`, else with
 * each source extension, else as a directory's index.
 */
export function sourceFileOf(target: string): string | undefined {
  if (isFile(target)) return target;
  if (/\.[cm]?js$/.test(target)) {
    const found = TS_EXTS.map((ts) => target.replace(/\.[cm]?js$/, ts)).find(isFile);
    if (found) return found;
  }
  return (
    SOURCE_EXTS.map((e) => target + e).find(isFile) ??
    SOURCE_EXTS.map((e) => join(target, `index${e}`)).find(isFile)
  );
}

/**
 * Resolves a relative specifier the way TypeScript's bundler resolution does, against `runtimeDir` (the source
 * tree), and returns the specifier as it must read in the built tree: explicit extension, `.vue` kept, `.ts` → `.js`,
 * a directory → `dir/index.js`. With a `scope`, a target outside the runtime dir is rewritten only when it is a
 * bundled entry (to that entry's output); anything else outside is left untouched. Specifiers that are not relative
 * or do not resolve are returned untouched.
 */
export function rewriteSpecifier(spec: string, fromFile: string, scope?: SpecifierScope): string {
  if (!/^\.\.?(\/|$)/.test(spec)) return spec;
  const suffix = /[?#].*$/.exec(spec)?.[0] ?? "";
  const bare = suffix ? spec.slice(0, -suffix.length) : spec;
  const target = resolve(dirname(fromFile), bare);
  const specifierOf = (rel: string): string => (rel.startsWith(".") ? rel : `./${rel}`) + suffix;
  const inside = (p: string) => !scope || p.startsWith(scope.runtimeDir + sep);
  const located = (p: string): string => {
    if (!scope || inside(p))
      return specifierOf(relative(dirname(fromFile), runtimeOutName(p)).split(sep).join("/"));
    const entry = scope.entries[p];
    if (!entry) return spec;
    // `fromFile` lands at `outDir/runtime/<rel>`, the entry at `outDir/<entry>`.
    const fromOut = posix.join(
      "/out/runtime",
      relative(scope.runtimeDir, dirname(fromFile)).split(sep).join("/"),
    );
    return specifierOf(posix.relative(fromOut, posix.join("/out", entry)));
  };
  // `./x.js` written for `x.ts` (TS NodeNext style), or `./x.ts` itself.
  const explicit = extname(bare);
  if (explicit && isFile(target)) {
    // A Sass import names the stylesheet the runtime build compiles it to (`./theme.scss` → `./theme.css`).
    return (/\.(?:ts|tsx|jsx|mts|cts)$/.test(explicit) && !DECLARATION_RE.test(bare)) ||
      (SASS_RE.test(explicit) && inside(target) && !isSassPartial(target))
      ? located(target)
      : spec;
  }
  const source = sourceFileOf(target);
  if (!source) return spec;
  // `./x.js` written for a runtime `x.ts` already names the file built per file.
  if (/\.[cm]?js$/.test(explicit) && inside(source)) return spec;
  return located(source);
}

/** An ESTree node, as far as the specifier walk reads it. */
interface AstNode {
  readonly type?: string;
  readonly start?: number;
  readonly end?: number;
  readonly source?: AstNode | null;
  readonly value?: unknown;
}

/** Node types whose `source` is a module specifier: imports, re-exports, `import()` and `import("x").T` types. */
const IMPORTING_NODES = new Set([
  "ImportDeclaration",
  "ExportAllDeclaration",
  "ExportNamedDeclaration",
  "ImportExpression",
  "TSImportType",
]);

/** One replacement of a source range. */
export interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** How a specifier is written in the source text: the quote it had is kept. */
function quoted(original: string, specifier: string): string {
  const quote = original.slice(0, 1);
  return (quote === "'" || quote === '"') && !/['"\\]/.test(specifier)
    ? `${quote}${specifier}${quote}`
    : JSON.stringify(specifier);
}

/**
 * The edits that rewrite the module specifiers of `code` (a JS module, or a declaration with `lang: "dts"`):
 * every static and dynamic import, re-export and import type. `map` returns the new specifier, or nothing to leave
 * it. Found with the parser, never by pattern.
 */
export function specifierEdits(
  code: string,
  lang: "js" | "dts",
  map: (specifier: string) => string | undefined,
): Edit[] {
  const ast = parseAst(code, { lang }) as unknown as { body: unknown };
  const edits: Edit[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const node = value as AstNode;
    const src =
      node.type && IMPORTING_NODES.has(node.type) && node.source ? node.source : undefined;
    if (src && typeof src.value === "string" && src.start !== undefined && src.end !== undefined) {
      const next = map(src.value);
      if (next !== undefined && next !== src.value)
        edits.push({
          start: src.start,
          end: src.end,
          text: quoted(code.slice(src.start, src.end), next),
        });
    }
    for (const [key, child] of Object.entries(node)) if (key !== "source" || !src) visit(child);
  };
  visit(ast.body);
  return edits;
}

/** `code` with `edits` applied. */
export function applyEdits(code: string, edits: readonly Edit[]): string {
  return [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce((c, e) => c.slice(0, e.start) + e.text + c.slice(e.end), code);
}

/** Rewrites every static / dynamic import and re-export specifier of a transpiled JS module. */
export function rewriteImports(code: string, fromFile: string, scope?: SpecifierScope): string {
  return applyEdits(
    code,
    specifierEdits(code, "js", (spec) => rewriteSpecifier(spec, fromFile, scope)),
  );
}

/** Same for a declaration: `from "./x"`, `import("./x")`, `import "./x"`. */
export function rewriteDeclarationImports(
  code: string,
  fromFile: string,
  scope?: SpecifierScope,
): string {
  return applyEdits(
    code,
    specifierEdits(code, "dts", (spec) => rewriteSpecifier(spec, fromFile, scope)),
  );
}
