import type { Plugin } from "vite";

import { IMPLICIT_DEPENDENCY, PLUGIN_PREFIX } from "./defaults.ts";
import { matchesAny } from "./externals.ts";
import type { ResolvedOptions } from "./options.ts";
import { readPackageJson } from "./package-json.ts";

/** The package a module id inside `node_modules` belongs to (`…/node_modules/@a/b/x.js` → `@a/b`). */
export function nodeModulesPackage(id: string): string | undefined {
  const path = id
    .replace(/[?#].*$/, "")
    .split("\\")
    .join("/");
  const at = path.lastIndexOf("/node_modules/");
  if (at < 0) return undefined;
  const [scope = "", name = ""] = path.slice(at + "/node_modules/".length).split("/");
  return scope.startsWith("@") ? `${scope}/${name}` : scope || undefined;
}

/**
 * Warns (and so, under the warnings-as-errors policy, fails the build) for every package inlined into the module
 * bundle that the module neither depends on (`dependencies`, `peerDependencies`, `optionalDependencies`, all external)
 * nor lists in `bundle`: a devDependency or a package it only reaches through another one. `nuxt-module-build` fails
 * the same way ("Implicitly bundling …"); `bundle` is the opt-in, like unbuild's `inlineDependencies`.
 */
export function implicitDependencies(options: () => ResolvedOptions): Plugin {
  const reported = new Set<string>();
  return {
    name: `${PLUGIN_PREFIX}:implicit-dependencies`,
    apply: "build",
    enforce: "pre",
    buildStart() {
      reported.clear();
    },
    // Every module the bundle inlines is loaded; externals never are.
    load(id) {
      const name = nodeModulesPackage(id);
      if (!name || reported.has(name)) return null;
      const { root, bundle } = options();
      if (matchesAny(name, bundle) || name === readPackageJson(root).name) return null;
      reported.add(name);
      this.warn({
        code: IMPLICIT_DEPENDENCY,
        message: `Implicitly bundling "${name}" into the module: it is not one of the module's dependencies or peerDependencies. Declare it, or list it in \`bundle\` to inline it on purpose.`,
      });
      return null;
    },
  };
}
