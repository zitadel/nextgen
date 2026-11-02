import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, resolve } from "node:path";

/** Source extensions an entry may have, in the order they are tried. */
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts"];

/**
 * Rolldown's minify for an ES library. Vite keeps an ES library's whitespace so
 * its `__PURE__` annotations survive, but Rolldown keeps those comments while it
 * strips the whitespace too. A build that does not go through `libraryBuild()`
 * sets it as `build.rolldownOptions.output.minify`.
 */
export const minify = { compress: true, mangle: true, codegen: { removeWhitespace: true } };

/** Every string in an `exports` value, however deeply its conditions nest. */
const leaves = (value) =>
  typeof value === "string" ? [value] : Object.values(value ?? {}).flatMap(leaves);

/**
 * The Vite build every SDK shares, derived from its `package.json`. List it
 * first in a package's own `plugins`, before its framework plugin and
 * `unplugin-dts`:
 *
 *   import { libraryBuild } from "@zitadel/vite";
 *   export default defineConfig({
 *     plugins: [libraryBuild(import.meta.dirname), react(), dts({ tsconfigPath })],
 *   });
 *
 * The published `exports` map is the one list of entry points. Each runtime
 * target `./dist/<name>.js` (or `.mjs`) is built from `<src>/<name>` (`.ts`,
 * `.tsx` or `.mts`) into a file of exactly that name, and `<name>.<infix>.mjs`,
 * which is how Qwik names its entry, is built from `<name>`. A module kept
 * apart without being an entry (`preserveModules`) is a `.js` file when every
 * runtime target is one, and a `.mjs` file otherwise. Dependencies, peer
 * dependencies and Node built-ins stay external.
 *
 * Any warning Rolldown reports fails the build, except the codes in `allow`, each
 * of which needs a comment at the call site saying why, `PLUGIN_TIMINGS`, and a
 * `MODULE_LEVEL_DIRECTIVE` Rolldown keeps: one on an entry, or on any module of
 * a build that preserves modules. A directive on another module is merged into
 * a chunk and lost, so it still fails. A plugin that prints its own warnings
 * (the Svelte compiler, Qwik, `unplugin-dts`) never reports them to Rolldown,
 * so they do not fail it.
 *
 * It throws when a runtime target has no source, when a types-only target has
 * no `.d.ts` source, or when a `./src/` condition (the workspace-source one)
 * names another file than the one built into its subpath.
 *
 * @param {string} root The package directory.
 * @param {import("./vite.shared.d.mts").LibraryBuildOptions} [options]
 * @returns {import("vite").Plugin}
 */
export function libraryBuild(root, { src = "src", allow = [], minify: minified = true } = {}) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const sourceOf = (name) => SOURCE_EXTENSIONS.map((ext) => `${src}/${name}${ext}`);
  const find = (name) => sourceOf(name).find((file) => existsSync(join(root, file)));
  const entry = {};
  const fileNames = {};
  const extensions = new Set();

  for (const [subpath, conditions] of Object.entries(pkg.exports ?? {})) {
    const fail = (message) => {
      throw new Error(`${pkg.name} exports "${subpath}": ${message}`);
    };
    const dist = leaves(conditions).filter((target) => target.startsWith("./dist/"));
    const types = dist.filter((target) => /\.d\.[cm]?ts$/.test(target));
    const runtime = dist.filter((target) => !types.includes(target));
    const built = [];
    for (const target of runtime) {
      const [, name, ext] = /^\.\/dist\/(.+?)(\.m?js)$/.exec(target) ?? [];
      if (!name) fail(`${target} is not a .js or .mjs file, and only ES modules are built`);
      const file = find(name) ?? find(name.replace(/\.[^./]+$/, ""));
      if (!file) fail(`no source for ${target}, expected ${sourceOf(name).join(" or ")}`);
      entry[name] = join(root, file);
      fileNames[name] = `${name}${ext}`;
      extensions.add(ext);
      built.push(file);
    }
    for (const target of runtime.length === 0 ? types : []) {
      const file = `${src}/${target.slice("./dist/".length).replace(/\.d\.[cm]?ts$/, "")}.d.ts`;
      if (!existsSync(join(root, file))) fail(`no source for ${target}, expected ${file}`);
    }
    for (const target of leaves(conditions).filter((target) => target.startsWith("./src/"))) {
      if (!built.includes(target.slice(2))) fail(`${target} is not the source of any dist target`);
    }
  }

  // The patterns are a list, not a function: Qwik's plugin appends to them.
  const external = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...builtinModules,
  ].map((name) => name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"));
  const extension = extensions.size === 1 && extensions.has(".js") ? ".js" : ".mjs";
  const entries = new Set(Object.values(entry).map((file) => resolve(file)));
  // Read from the resolved config, since a package sets `preserveModules` in its own `build`.
  let preserveModules = false;
  const keptDirective = (warning) =>
    warning.code === "MODULE_LEVEL_DIRECTIVE" &&
    (preserveModules || (typeof warning.id === "string" && entries.has(resolve(warning.id))));
  return {
    name: "library-build",
    config: () => ({
      build: {
        outDir: "dist",
        sourcemap: true,
        minify: minified,
        lib: {
          entry,
          formats: ["es"],
          fileName: (_format, name) => fileNames[name] ?? `${name}${extension}`,
        },
        rolldownOptions: {
          external: [new RegExp(`^(${external.join("|")})($|/)`), /^node:/],
          ...(minified && { output: { minify } }),
          onwarn: (warning) => {
            // Whether a slow plugin (type generation) is reported depends on the machine's load.
            if (warning.code === "PLUGIN_TIMINGS" || keptDirective(warning)) return;
            if (!allow.includes(warning.code)) {
              throw new Error(`${pkg.name}: ${warning.code}: ${warning.message}`);
            }
          },
        },
      },
    }),
    configResolved: ({ build }) => {
      const output = build.rolldownOptions?.output ?? build.rollupOptions?.output;
      preserveModules = [output].flat().some((options) => options?.preserveModules === true);
    },
  };
}

/**
 * An `afterDiagnostic` hook for `unplugin-dts`, which only reports the type
 * errors it finds in the declarations; this fails the build on any of them:
 *
 *   dts({ tsconfigPath: "./tsconfig.lib.json", afterDiagnostic: failOnDiagnostics })
 *
 * @param {readonly import("typescript").Diagnostic[]} diagnostics
 * @returns {void}
 */
export function failOnDiagnostics(diagnostics) {
  if (diagnostics.length === 0) return;
  // A message chain's head says what failed and each link under it why, as tsc prints it.
  const flatten = (message, depth = 0) =>
    typeof message === "string"
      ? message
      : [
          `${"  ".repeat(depth)}${message.messageText}`,
          ...(message.next ?? []).map((next) => flatten(next, depth + 1)),
        ].join("\n");
  const lines = diagnostics.map(({ file, start, messageText }) => {
    const text = flatten(messageText);
    if (!file) return text;
    const { line, character } = file.getLineAndCharacterOfPosition(start ?? 0);
    return `${file.fileName}:${line + 1}:${character + 1}: ${text}`;
  });
  throw new Error(
    `the declarations have ${diagnostics.length} type error(s):\n${lines.join("\n")}`,
  );
}
