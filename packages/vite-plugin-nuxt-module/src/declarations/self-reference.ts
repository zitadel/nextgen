import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { posixPath } from "../entries.ts";
import { escapeRegExp } from "../externals.ts";
import { readPackageJson } from "../package-json.ts";
import { packageTypeScript } from "../resolve.ts";
import { absolutePaths, parsedTsconfig } from "../tsconfig.ts";
import { walk } from "../walk.ts";

/** What {@link selfReferenceOptions} adds to the declaration step's options. */
export interface SelfReferenceOptions {
  readonly compilerOptions?: { readonly paths: Record<string, string[]> };
  readonly aliasesExclude?: RegExp[];
}

/** Source extensions a declaration file can be generated from. */
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];

/** The `types` target of an exports-map entry: a `.d.ts` string, or the first `types` condition found. */
export function typesTarget(entry: unknown): string | undefined {
  if (typeof entry === "string") return /\.d\.[cm]?ts$/.test(entry) ? entry : undefined;
  if (!entry || typeof entry !== "object") return undefined;
  const conditions = entry as Record<string, unknown>;
  if (typeof conditions.types === "string") return conditions.types;
  for (const nested of Object.values(conditions)) {
    const found = typesTarget(nested);
    if (found) return found;
  }
  return undefined;
}

/** Whether a source file under `entryRoot` names package `name` (`"name"` or `"name/…"`). */
function importsItself(entryRoot: string, name: string): boolean {
  if (!existsSync(entryRoot)) return false;
  return walk(entryRoot).some((file) => {
    const text = readFileSync(join(entryRoot, file), "utf8");
    return text.includes(`"${name}"`) || text.includes(`"${name}/`) || text.includes(`'${name}`);
  });
}

/**
 * The declaration step pins TypeScript's `outDir` to the package root, so a package importing its
 * own name (`import config from "next-intl/config"`) no longer maps the exports' `types` target back
 * to the source. This maps each self-reference to its source file instead, and keeps the specifier
 * bare in the output: `paths` for every `exports` subpath whose `types` target lies in `dtsOutDir`,
 * pointing at the source file it is generated from (merged over the `paths` the tsconfig compiles
 * with, made absolute): the entry of that name (`entries`, output name to source file), else the
 * file at the same path under `entryRoot`. Empty when no source imports the package's own name.
 */
export function selfReferenceOptions(
  root: string,
  dtsOutDir: string,
  entryRoot: string,
  tsconfig: string,
  entries: Readonly<Record<string, string>> = {},
): SelfReferenceOptions {
  const pkg = readPackageJson(root);
  if (!pkg.name || !pkg.exports || typeof pkg.exports !== "object") return {};
  if (!importsItself(entryRoot, pkg.name)) return {};
  const paths: Record<string, string[]> = {};
  const map = Object.keys(pkg.exports).some((k) => k.startsWith("."))
    ? (pkg.exports as Record<string, unknown>)
    : { ".": pkg.exports };
  for (const [sub, target] of Object.entries(map)) {
    const types = typesTarget(target);
    if (!types || sub.includes("*")) continue;
    const rel = relative(dtsOutDir, resolve(root, types));
    if (rel.startsWith("..")) continue;
    const name = posixPath(rel.replace(/\.d\.[cm]?ts$/, ""));
    const base = resolve(entryRoot, name);
    const source =
      entries[name] ?? SOURCE_EXTENSIONS.map((e) => base + e).find((f) => existsSync(f));
    if (source) paths[sub === "." ? pkg.name : `${pkg.name}${sub.slice(1)}`] = [source];
  }
  if (Object.keys(paths).length === 0) return {};
  // `compilerOptions` replaces the tsconfig's `paths` wholesale: carry those over, made absolute.
  const names = Object.keys(paths).map((n) => new RegExp(`^${escapeRegExp(n)}$`));
  const own = existsSync(tsconfig)
    ? absolutePaths(parsedTsconfig(packageTypeScript(root), tsconfig).options, tsconfig)
    : {};
  return {
    compilerOptions: { paths: { ...own, ...paths } },
    aliasesExclude: names,
  };
}
