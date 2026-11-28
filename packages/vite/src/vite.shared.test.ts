import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { failOnDiagnostics, libraryConfig, minify } from "./vite.shared.mjs";

/**
 * The parts of the `build` config that the tests read.
 */
interface Build {
  emptyOutDir: boolean;
  sourcemap: boolean;
  lib: {
    entry: Record<string, string>;
    formats: string[];
    fileName: (format: string, name: string) => string;
  };
  rolldownOptions: {
    external: [RegExp, RegExp];
    output: { minify: unknown; chunkFileNames: string };
    onwarn: (warning: { code: string; message: string }, warn: (warning: unknown) => void) => void;
  };
}

/**
 * A plugin as the tests call it.
 */
interface Plugin {
  name: string;
  config?: (user: { build?: { watch?: object } }) => { build?: Partial<Build> } | undefined;
}

const roots: string[] = [];

/**
 * A package directory holding `files` (empty modules) and a `package.json` of `manifest`.
 *
 * @param manifest The `package.json` fields besides the name.
 * @param files The source files to create.
 * @returns The package directory.
 */
function packageOf(manifest: object, files: string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), "vite-shared-"));
  roots.push(root);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@zitadel/x", ...manifest }));
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), "export {};\n");
  }
  return root;
}

/**
 * The plugins of the config `libraryConfig` returns for the package at `root`.
 *
 * @param root The package directory.
 * @returns The plugins, flattened as Vite flattens them.
 */
function pluginsOf(root: string): Plugin[] {
  return ((libraryConfig(root).plugins ?? []) as unknown[]).flat(Infinity) as Plugin[];
}

/**
 * The `build` config of the package at `root`, with what its plugins add for `user`.
 *
 * @param root The package directory.
 * @param user The user config Vite passes the plugins.
 * @returns The `build` config.
 */
function buildOf(root: string, user = {}): Build {
  const added = pluginsOf(root).map((plugin) => plugin.config?.(user)?.build ?? {});
  return Object.assign({}, libraryConfig(root).build, ...added) as Build;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("libraryConfig entries", () => {
  it("builds each runtime target of the exports from its source into a file of that name", () => {
    const root = packageOf(
      {
        exports: {
          ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
          "./server": { types: "./dist/server.d.ts", import: "./dist/server.js" },
        },
      },
      ["src/index.tsx", "src/server.mts"],
    );
    const { lib } = buildOf(root);
    expect(lib.entry).toEqual({
      index: join(root, "src/index.tsx"),
      server: join(root, "src/server.mts"),
    });
    expect([lib.fileName("es", "index"), lib.fileName("es", "server")]).toEqual([
      "index.js",
      "server.js",
    ]);
    expect(lib.formats).toEqual(["es"]);
  });

  it("keeps a nested subpath in its directory", () => {
    const root = packageOf({ exports: { "./runtime/foo": { import: "./dist/runtime/foo.js" } } }, [
      "src/runtime/foo.ts",
    ]);
    const { lib } = buildOf(root);
    expect(lib.entry).toEqual({ "runtime/foo": join(root, "src/runtime/foo.ts") });
    expect(lib.fileName("es", "runtime/foo")).toBe("runtime/foo.js");
  });

  it("builds one entry for a target several conditions name", () => {
    const root = packageOf(
      {
        exports: {
          ".": {
            "@zitadel/source": "./src/index.ts",
            types: "./dist/index.d.ts",
            import: "./dist/index.js",
            default: "./dist/index.js",
          },
        },
      },
      ["src/index.ts"],
    );
    expect(Object.keys(buildOf(root).lib.entry)).toEqual(["index"]);
  });

  it("names a shared chunk a .js file when every target is one", () => {
    const root = packageOf({ exports: { ".": { import: "./dist/index.js" } } }, ["src/index.ts"]);
    expect(buildOf(root).rolldownOptions.output.chunkFileNames).toBe("[name]-[hash].js");
  });

  it("names a shared chunk a .mjs file when the targets are", () => {
    const root = packageOf({ exports: { ".": { import: "./dist/index.mjs" } } }, ["src/index.ts"]);
    expect(buildOf(root).rolldownOptions.output.chunkFileNames).toBe("[name]-[hash].mjs");
  });

  it("names a shared chunk a .mjs file when the targets mix", () => {
    const root = packageOf(
      {
        exports: {
          ".": { import: "./dist/index.js" },
          "./server": { import: "./dist/server.mjs" },
        },
      },
      ["src/index.ts", "src/server.ts"],
    );
    expect(buildOf(root).rolldownOptions.output.chunkFileNames).toBe("[name]-[hash].mjs");
  });

  it("fails for a runtime target without a source", () => {
    const root = packageOf({ exports: { "./server": { import: "./dist/server.js" } } });
    expect(() => libraryConfig(root)).toThrow(
      '@zitadel/x exports "./server": no source for ./dist/server.js, expected src/server.ts or src/server.tsx or src/server.mts',
    );
  });

  it("fails for a target whose name has an infix its source lacks", () => {
    const root = packageOf({ exports: { ".": { import: "./dist/index.edge.js" } } }, [
      "src/index.ts",
    ]);
    expect(() => libraryConfig(root)).toThrow("no source for ./dist/index.edge.js");
  });

  it("fails for a source condition no dist target is built from", () => {
    const root = packageOf({ exports: { "./jwt": { "@zitadel/source": "./src/jwt.ts" } } }, [
      "src/jwt.ts",
    ]);
    expect(() => libraryConfig(root)).toThrow(
      'exports "./jwt": ./src/jwt.ts is not the source of any dist target',
    );
  });

  it("fails for a source condition that names another file than the dist target's source", () => {
    const root = packageOf(
      {
        exports: {
          ".": { "@zitadel/source": "./src/main.ts", import: "./dist/index.js" },
        },
      },
      ["src/index.ts", "src/main.ts"],
    );
    expect(() => libraryConfig(root)).toThrow("./src/main.ts is not the source of any dist target");
  });

  it("fails for a runtime target that is not an ES module file", () => {
    const root = packageOf({ exports: { ".": { require: "./dist/index.cjs" } } }, ["src/index.ts"]);
    expect(() => libraryConfig(root)).toThrow("only ES modules are built");
  });

  it("fails for exports that mix .d.ts and .d.mts declarations", () => {
    const root = packageOf(
      {
        exports: {
          ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
          "./server": { types: "./dist/server.d.mts", import: "./dist/server.mjs" },
        },
      },
      ["src/index.ts", "src/server.ts"],
    );
    expect(() => libraryConfig(root)).toThrow(
      "@zitadel/x: the exports mix .d.ts and .d.mts declarations",
    );
  });
});

describe("libraryConfig output", () => {
  const root = () =>
    packageOf({ exports: { ".": { import: "./dist/index.js" } } }, ["src/index.ts"]);

  it("minifies the JavaScript, whitespace included", () => {
    expect(buildOf(root()).rolldownOptions.output.minify).toBe(minify);
    expect(minify.codegen).toEqual({ removeWhitespace: true });
  });

  it("keeps the names of functions and classes a consumer reads as .name", () => {
    expect(minify.compress.keepNames).toEqual({ function: true, class: true });
    expect(minify.mangle.keepNames).toBe(true);
  });

  it("keeps a source map beside each file", () => {
    expect(buildOf(root()).sourcemap).toBe(true);
  });

  it("empties dist before a build", () => {
    expect(buildOf(root()).emptyOutDir).toBe(true);
  });

  it("leaves dist in place between the rebuilds of a watch build", () => {
    expect(buildOf(root(), { build: { watch: {} } }).emptyOutDir).toBe(false);
  });

  it("writes the declarations too", () => {
    expect(pluginsOf(root()).map((plugin) => plugin.name)).toContain("unplugin-dts");
  });
});

describe("libraryConfig externals and warnings", () => {
  const root = () =>
    packageOf(
      {
        dependencies: { ufo: "1", "@zitadel/api": "1" },
        peerDependencies: { react: ">=18" },
        devDependencies: { vitest: "1" },
        exports: { ".": { import: "./dist/index.js" } },
      },
      ["src/index.ts"],
    );

  it("keeps dependencies, peer dependencies, their subpaths and Node built-ins external", () => {
    const [pattern, node] = buildOf(root()).rolldownOptions.external;
    const external = (id: string) => pattern.test(id) || node.test(id);
    for (const id of [
      "ufo",
      "@zitadel/api/config",
      "react/jsx-runtime",
      "node:fs",
      "fs/promises",
    ]) {
      expect(external(id), id).toBe(true);
    }
    for (const id of ["vitest", "react-dom", "ufo-like", "./local", "/abs/path.ts"]) {
      expect(external(id), id).toBe(false);
    }
  });

  it("prints a report of how long plugins took, which depends on the machine's load", () => {
    const { onwarn } = buildOf(root()).rolldownOptions;
    const printed: unknown[] = [];
    const warning = { code: "PLUGIN_TIMINGS", message: "slow plugin" };
    onwarn(warning, (reported) => {
      printed.push(reported);
    });
    expect(printed).toEqual([warning]);
  });

  it("fails the build on any other warning", () => {
    const { onwarn } = buildOf(root()).rolldownOptions;
    expect(() => onwarn({ code: "EVAL", message: "Use of direct eval" }, () => {})).toThrow(
      "@zitadel/x: EVAL: Use of direct eval",
    );
  });
});

describe("failOnDiagnostics", () => {
  const file = {
    fileName: "/pkg/src/index.ts",
    getLineAndCharacterOfPosition: (position: number) => ({ line: 2, character: position }),
  };

  it("passes when the declarations have no diagnostic", () => {
    expect(() => failOnDiagnostics([])).not.toThrow();
  });

  it("fails with the place and message of each diagnostic", () => {
    expect(() =>
      failOnDiagnostics([
        { file, start: 4, messageText: "Type 'string' is not assignable to type 'number'." },
        { messageText: { messageText: "Cannot find module './x'." } },
      ]),
    ).toThrow(
      "the declarations have 2 type error(s):\n" +
        "/pkg/src/index.ts:3:5: Type 'string' is not assignable to type 'number'.\n" +
        "Cannot find module './x'.",
    );
  });

  it("fails with every link of a message chain, each indented under the one it explains", () => {
    expect(() =>
      failOnDiagnostics([
        {
          messageText: {
            messageText: "Type 'A' is not assignable to type 'B'.",
            next: [
              {
                messageText: "Types of property 'x' are incompatible.",
                next: [{ messageText: "Type 'string' is not assignable to type 'number'." }],
              },
            ],
          },
        },
      ]),
    ).toThrow(
      "Type 'A' is not assignable to type 'B'.\n" +
        "  Types of property 'x' are incompatible.\n" +
        "    Type 'string' is not assignable to type 'number'.",
    );
  });
});
