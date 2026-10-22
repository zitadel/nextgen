import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";

/** Source extensions an entry may have, in the order they are tried. */
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts"];

/** Every string in an `exports` value, however deeply its conditions nest. */
const leaves = (value) =>
  typeof value === "string" ? [value] : Object.values(value ?? {}).flatMap(leaves);

/**
 * The Vite build every SDK shares, derived from its `package.json`. List it
 * first in a package's own `plugins`, before its framework plugin and
 * `unplugin-dts`, because Qwik's plugin reads the `outDir` this sets:
 *
 *   import { libraryBuild } from "../../vite.shared.mjs";
 *   export default defineConfig({
 *     plugins: [libraryBuild(import.meta.dirname), react(), dts({ tsconfigPath })],
 *   });
 *
 * The published `exports` map is the one list of entry points. Each runtime
 * target `./dist/<name>.js` (or `.mjs`) is built from `<src>/<name>` (`.ts`,
 * `.tsx` or `.mts`) into a file of exactly that name, and `<name>.<infix>.mjs`,
 * which is how Qwik names its entry, is built from `<name>`. Dependencies, peer
 * dependencies and Node built-ins stay external. Any warning fails the build,
 * except the Rolldown codes in `allow`, each of which needs a comment at the
 * call site saying why.
 *
 * It throws when a runtime target has no source, when a types-only target has
 * no `.d.ts` source, or when a `./src/` condition (the workspace-source one)
 * names another file than the one built into its subpath.
 *
 * @param {string} root The package directory.
 * @param {import("./vite.shared.d.mts").LibraryBuildOptions} [options]
 * @returns {import("vite").Plugin}
 */
export function libraryBuild(root, { src = "src", allow = [] } = {}) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const sourceOf = (name) => SOURCE_EXTENSIONS.map((ext) => `${src}/${name}${ext}`);
  const find = (name) => sourceOf(name).find((file) => existsSync(join(root, file)));
  const entry = {};
  const fileNames = {};

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
  return {
    name: "library-build",
    config: () => ({
      build: {
        outDir: "dist",
        sourcemap: true,
        minify: false,
        lib: {
          entry,
          formats: ["es"],
          // A module kept apart without being an entry (`preserveModules`) is a `.js` file.
          fileName: (_format, name) => fileNames[name] ?? `${name}.js`,
        },
        rolldownOptions: {
          // Whether a slow plugin (type generation) is reported depends on the machine's load.
          checks: { bundlerTimings: false },
          external: [new RegExp(`^(${external.join("|")})($|/)`), /^node:/],
          onwarn: (warning) => {
            if (!allow.includes(warning.code)) {
              throw new Error(`${pkg.name}: ${warning.code}: ${warning.message}`);
            }
          },
        },
      },
    }),
  };
}
