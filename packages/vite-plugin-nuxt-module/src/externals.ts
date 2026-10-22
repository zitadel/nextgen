import { builtinModules } from "node:module";

import { readPackageJson } from "./package-json.ts";

/** A module specifier matcher: an exact string or a pattern. */
export type Matcher = string | RegExp;

/** `text` with every regular-expression metacharacter escaped. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** Matches a package name and every subpath of it (`lit`, `lit/decorators.js`), but not `lit-html`. */
export function packageMatcher(name: string): RegExp {
  return new RegExp(`^${escapeRegExp(name)}(/|$)`);
}

/** Whether `id` is matched by any entry of `list`. */
export function matchesAny(id: string, list: readonly Matcher[]): boolean {
  return list.some((m) => (typeof m === "string" ? m === id : m.test(id)));
}

/** Declared runtime dependency names of the package at `root` (not its devDependencies). */
export function declaredDependencies(root: string): readonly string[] {
  const pkg = readPackageJson(root);
  return [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ];
}

/**
 * Node builtins, with and without the `node:` prefix. They stay external: the module runs in Node.
 */
export const BUILTIN_MATCHERS: readonly Matcher[] = [
  /^node:/,
  ...builtinModules.map(packageMatcher),
];

/** What decides the module build's externals. */
export interface ExternalsOptions {
  /** Extra specifiers to keep external. */
  readonly external?: readonly Matcher[];
  /** Specifiers to inline although declared. */
  readonly bundle?: readonly Matcher[];
}

/**
 * What the module build leaves external: every declared dependency not listed in `bundle`, the
 * package's own name (a self-import resolves to the published entry, never to a stale `dist`
 * inlined into the build), the extra `external` matchers, and the Node builtins.
 */
export function moduleExternals(root: string, options: ExternalsOptions = {}): Matcher[] {
  const { external = [], bundle = [] } = options;
  const pkg = readPackageJson(root);
  const inlined = (name: string): boolean => matchesAny(name, bundle);
  return [
    ...declaredDependencies(root)
      .filter((d) => !inlined(d))
      .map(packageMatcher),
    ...(pkg.name && !inlined(pkg.name) ? [packageMatcher(pkg.name)] : []),
    ...external,
    ...BUILTIN_MATCHERS,
  ];
}
