import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";

import dts from "unplugin-dts/vite";

/** Source extensions an entry may have, in the order they are tried. */
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts"];

/**
 * Rolldown's minify for an ES library. Vite keeps an ES library's whitespace so
 * its `__PURE__` annotations survive, but Rolldown keeps those comments while it
 * strips the whitespace too. Function and class names are kept, since a consumer
 * sees them as `.name` (an error's class, a component in a framework's devtools).
 */
export const minify = {
  compress: { keepNames: { function: true, class: true } },
  mangle: { keepNames: true },
  codegen: { removeWhitespace: true },
};

/**
 * Every string in an `exports` value, however deeply its conditions nest.
 *
 * @param {unknown} value An `exports` entry or one of its conditions.
 * @returns {string[]} The target paths it names.
 */
const leaves = (value) => {
  if (typeof value === "string") {
    return [value];
  }
  return Object.values(value ?? {}).flatMap(leaves);
};

/**
 * The Vite config every SDK shares, derived from its `package.json`. It is the
 * whole of a package's `vite.config.ts`:
 *
 *   import { libraryConfig } from "@zitadel/vite";
 *   export default defineConfig(libraryConfig(import.meta.dirname));
 *
 * It is a config, not a plugin, so tools that read `build.lib.entry` (knip)
 * find the entries.
 *
 * The published `exports` map is the one list of entry points. Each runtime
 * target `./dist/<name>.js` (or `.mjs`) is built from `src/<name>` (`.ts`,
 * `.tsx` or `.mts`) into a file of exactly that name, minified with source maps.
 * Dependencies, peer dependencies and Node built-ins stay external.
 *
 * The declarations are written by `unplugin-dts` from `tsconfig.lib.json`, one
 * per source file, as `.d.mts` when the exports name `.d.mts` files and as
 * `.d.ts` otherwise. Any type error in them fails the build.
 *
 * Any warning Rolldown reports fails the build, except `PLUGIN_TIMINGS`, which is
 * printed: whether a slow plugin is reported depends on the machine's load.
 *
 * A watch build (`vite build --watch`) leaves `dist` in place between
 * rebuilds, so an app linked to the package never finds it empty.
 *
 * It throws when a runtime target has no source, when the exports mix `.d.ts`
 * and `.d.mts` declarations, or when a `./src/` condition (the workspace-source
 * one) names another file than the one built into its subpath.
 *
 * @param {string} root The package directory.
 * @returns {import("vite").UserConfig} The package's Vite config.
 */
export function libraryConfig(root) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const sourceOf = (name) => SOURCE_EXTENSIONS.map((ext) => `src/${name}${ext}`);
  const find = (name) => sourceOf(name).find((file) => existsSync(join(root, file)));
  const entry = {};
  const fileNames = {};
  const extensions = new Set();
  const declarations = new Set();

  for (const [subpath, conditions] of Object.entries(pkg.exports ?? {})) {
    const fail = (message) => {
      throw new Error(`${pkg.name} exports "${subpath}": ${message}`);
    };
    const dist = leaves(conditions).filter((target) => target.startsWith("./dist/"));
    const types = dist.filter((target) => /\.d\.[cm]?ts$/.test(target));
    const runtime = dist.filter((target) => !types.includes(target));
    const built = [];
    for (const target of types) {
      declarations.add(/\.d\.mts$/.test(target) ? ".d.mts" : ".d.ts");
    }
    for (const target of runtime) {
      const [, name, ext] = /^\.\/dist\/(.+?)(\.m?js)$/.exec(target) ?? [];
      if (!name) {
        fail(`${target} is not a .js or .mjs file, and only ES modules are built`);
      }
      const file = find(name);
      if (!file) {
        fail(`no source for ${target}, expected ${sourceOf(name).join(" or ")}`);
      }
      entry[name] = join(root, file);
      fileNames[name] = `${name}${ext}`;
      extensions.add(ext);
      built.push(file);
    }
    for (const target of leaves(conditions).filter((target) => target.startsWith("./src/"))) {
      if (!built.includes(target.slice(2))) {
        fail(`${target} is not the source of any dist target`);
      }
    }
  }
  if (declarations.size > 1) {
    throw new Error(`${pkg.name}: the exports mix .d.ts and .d.mts declarations`);
  }

  // The patterns are a list, not a function, so another plugin can append to them.
  const external = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...builtinModules,
  ].map((name) => name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"));
  // A shared chunk takes the extension of the entries, `.mjs` unless every one is `.js`.
  const extension = extensions.size === 1 && extensions.has(".js") ? ".js" : ".mjs";

  return {
    build: {
      outDir: "dist",
      sourcemap: true,
      lib: {
        entry,
        formats: ["es"],
        fileName: (_format, name) => fileNames[name] ?? `${name}${extension}`,
      },
      rolldownOptions: {
        external: [new RegExp(`^(${external.join("|")})($|/)`), /^node:/],
        output: { minify, chunkFileNames: `[name]-[hash]${extension}` },
        onwarn: (warning, warn) => {
          if (warning.code !== "PLUGIN_TIMINGS") {
            throw new Error(`${pkg.name}: ${warning.code}: ${warning.message}`);
          }
          warn(warning);
        },
      },
    },
    plugins: [
      {
        // `vite build --watch` sets `build.watch` on the command line, which only a plugin's hook sees.
        name: "library-watch",
        config: (user) => ({ build: { emptyOutDir: !user.build?.watch } }),
      },
      dts({
        tsconfigPath: join(root, "tsconfig.lib.json"),
        afterDiagnostic: failOnDiagnostics,
        ...(declarations.has(".d.mts") && { outDirs: { dir: "dist", moduleFormat: "esm" } }),
      }),
    ],
  };
}

/**
 * An `afterDiagnostic` hook for `unplugin-dts`, which only reports the type
 * errors it finds in the declarations; this fails the build on any of them.
 *
 * @param {readonly import("./vite.shared.d.mts").DeclarationDiagnostic[]} diagnostics The type
 *   errors `unplugin-dts` found in the declarations.
 * @returns {void}
 * @throws {Error} Listing every diagnostic, when there is any.
 */
export function failOnDiagnostics(diagnostics) {
  if (diagnostics.length === 0) {
    return;
  }
  // A message chain's head says what failed and each link under it why, as tsc prints it.
  const flatten = (message, depth = 0) => {
    if (typeof message === "string") {
      return message;
    }
    return [
      `${"  ".repeat(depth)}${message.messageText}`,
      ...(message.next ?? []).map((next) => flatten(next, depth + 1)),
    ].join("\n");
  };
  const lines = diagnostics.map(({ file, start, messageText }) => {
    const text = flatten(messageText);
    if (!file) {
      return text;
    }
    const { line, character } = file.getLineAndCharacterOfPosition(start ?? 0);
    return `${file.fileName}:${line + 1}:${character + 1}: ${text}`;
  });
  throw new Error(
    `the declarations have ${diagnostics.length} type error(s):\n${lines.join("\n")}`,
  );
}
