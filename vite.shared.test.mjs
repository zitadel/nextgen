import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { libraryBuild } from "./vite.shared.mjs";

const roots = [];

/** A package directory holding `files` (empty modules) and a `package.json` of `manifest`. */
function packageOf(manifest, files = []) {
  const root = mkdtempSync(join(tmpdir(), "vite-shared-"));
  roots.push(root);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@zitadel/x", ...manifest }));
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), "export {};\n");
  }
  return root;
}

/** The `build` config the plugin contributes for the package at `root`. */
const buildOf = (root, options) => libraryBuild(root, options).config().build;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("libraryBuild entries", () => {
  it("builds each runtime target of the exports from its source into a file of that name", () => {
    const root = packageOf(
      {
        exports: {
          ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
          "./server": { types: "./dist/server.d.mts", import: "./dist/server.mjs" },
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
      "server.mjs",
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

  it("builds the entry of a name with an infix from the source before it", () => {
    const root = packageOf({ exports: { ".": { import: "./dist/index.qwik.mjs" } } }, [
      "src/index.tsx",
    ]);
    const { lib } = buildOf(root);
    expect(lib.entry).toEqual({ "index.qwik": join(root, "src/index.tsx") });
    expect(lib.fileName("es", "index.qwik")).toBe("index.qwik.mjs");
  });

  it("reads the sources from the directory it is given", () => {
    const root = packageOf(
      { exports: { ".": { svelte: "./src/lib/index.ts", default: "./dist/index.js" } } },
      ["src/lib/index.ts"],
    );
    expect(buildOf(root, { src: "src/lib" }).lib.entry).toEqual({
      index: join(root, "src/lib/index.ts"),
    });
  });

  it("names a file for a module kept apart without being an entry", () => {
    const root = packageOf({ exports: { ".": { import: "./dist/index.js" } } }, ["src/index.ts"]);
    expect(buildOf(root).lib.fileName("es", "lib/jwt")).toBe("lib/jwt.js");
  });

  it("accepts a types-only target that has a declaration source", () => {
    const root = packageOf({ exports: { "./jsx": { types: "./dist/jsx.d.ts" } } }, [
      "src/jsx.d.ts",
    ]);
    expect(buildOf(root).lib.entry).toEqual({});
  });

  it("fails for a runtime target without a source", () => {
    const root = packageOf({ exports: { "./server": { import: "./dist/server.js" } } });
    expect(() => libraryBuild(root)).toThrow(
      '@zitadel/x exports "./server": no source for ./dist/server.js, expected src/server.ts or src/server.tsx or src/server.mts',
    );
  });

  it("fails for a types-only target without a declaration source", () => {
    const root = packageOf({ exports: { "./jsx": { types: "./dist/jsx.d.ts" } } });
    expect(() => libraryBuild(root)).toThrow('exports "./jsx": no source for ./dist/jsx.d.ts');
  });

  it("fails for a source condition no dist target is built from", () => {
    const root = packageOf({ exports: { "./jwt": { "@zitadel/source": "./src/jwt.ts" } } }, [
      "src/jwt.ts",
    ]);
    expect(() => libraryBuild(root)).toThrow(
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
    expect(() => libraryBuild(root)).toThrow("./src/main.ts is not the source of any dist target");
  });

  it("fails for a runtime target that is not an ES module file", () => {
    const root = packageOf({ exports: { ".": { require: "./dist/index.cjs" } } }, ["src/index.ts"]);
    expect(() => libraryBuild(root)).toThrow("only ES modules are built");
  });
});

describe("libraryBuild externals and warnings", () => {
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
    const external = (id) => pattern.test(id) || node.test(id);
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

  it("does not report how long plugins took, which depends on the machine's load", () => {
    expect(buildOf(root()).rolldownOptions.checks).toEqual({ bundlerTimings: false });
  });

  it("fails the build on a warning", () => {
    const { onwarn } = buildOf(root()).rolldownOptions;
    expect(() => onwarn({ code: "EVAL", message: "Use of direct eval" })).toThrow(
      "@zitadel/x: EVAL: Use of direct eval",
    );
  });

  it("lets only the allowed warning codes through", () => {
    const { onwarn } = buildOf(root(), { allow: ["MODULE_LEVEL_DIRECTIVE"] }).rolldownOptions;
    expect(() => onwarn({ code: "MODULE_LEVEL_DIRECTIVE", message: "directive" })).not.toThrow();
    expect(() => onwarn({ code: "EVAL", message: "eval" })).toThrow();
  });
});
