import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { matchesAny } from "./externals.ts";
import { resolveOptions } from "./options.ts";

/** A module package: `src/module.ts` and an empty `src/runtime` unless `files` says otherwise. */
function packageRoot(
  files: Record<string, string> = { "src/module.ts": "" },
  pkg: Record<string, unknown> = { name: "mod", type: "module" },
): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "nuxt-module-options-")));
  const all = { "package.json": JSON.stringify(pkg), "tsconfig.json": "{}", ...files };
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  if ("src/module.ts" in files) mkdirSync(join(root, "src/runtime"), { recursive: true });
  return root;
}

describe("resolveOptions", () => {
  it("builds the module and its per-file runtime by default", () => {
    const root = packageRoot();
    const o = resolveOptions({}, root);
    expect([o.entry, o.runtimeDir, o.extension, o.dts, o.sourcemap]).toEqual([
      { module: join(root, "src/module.ts") },
      join(root, "src/runtime"),
      ".mjs",
      true,
      false,
    ]);
  });

  it("bundles extra entries next to the module", () => {
    const root = packageRoot();
    expect(resolveOptions({ entry: { server: "src/server.ts" } }, root).entry).toEqual({
      module: join(root, "src/module.ts"),
      server: join(root, "src/server.ts"),
    });
  });

  it("names listed entries after their files", () => {
    const root = packageRoot();
    expect(resolveOptions({ entry: ["src/utils/headers.ts"] }, root).entry).toEqual({
      module: join(root, "src/module.ts"),
      headers: join(root, "src/utils/headers.ts"),
    });
  });

  it("builds a module file that is not src/module.ts", () => {
    const root = packageRoot({ "src/nuxt.ts": "" });
    expect(resolveOptions({ module: "src/nuxt.ts" }, root).entry).toEqual({
      module: join(root, "src/nuxt.ts"),
    });
  });

  it("fails without a module file to build", () => {
    expect(() => resolveOptions({}, packageRoot({}))).toThrow(
      /no module to build: src\/module\.ts does not exist/,
    );
  });

  it("refuses an entry inside the runtime directory, which is built file by file", () => {
    expect(() =>
      resolveOptions({ entry: { "runtime/plugin": "src/runtime/plugin.ts" } }, packageRoot()),
    ).toThrow(/src\/runtime\/plugin\.ts lie in the runtime directory/);
  });

  it.each([[".cjs"], [".jsx"]])(
    "refuses the extension %s, which Node cannot import as ESM",
    (ext) => {
      expect(() => resolveOptions({ extension: ext as ".mjs" }, packageRoot())).toThrow(
        `extension ${ext} is not one of .mjs, .js`,
      );
    },
  );

  it("refuses the extension .js in a package that is not an ES module package", () => {
    const root = packageRoot(undefined, { name: "mod", type: "commonjs" });
    expect(() => resolveOptions({ extension: ".js" }, root)).toThrow(/"type": "module"/);
  });

  it("accepts the extension .js in an ES module package", () => {
    expect(resolveOptions({ extension: ".js" }, packageRoot()).extension).toBe(".js");
  });

  it("refuses a runtime directory that does not exist", () => {
    expect(() => resolveOptions({ runtimeDir: "src/missing" }, packageRoot())).toThrow(
      /runtime directory src\/missing not found/,
    );
  });

  it("has no runtime for a module without one", () => {
    expect(resolveOptions({ runtimeDir: false }, packageRoot()).runtimeDir).toBeUndefined();
  });

  it("has no runtime when the default directory does not exist", () => {
    const root = packageRoot();
    rmSync(join(root, "src/runtime"), { recursive: true });
    expect(resolveOptions({}, root).runtimeDir).toBeUndefined();
  });

  it("writes no source maps unless asked, like @nuxt/module-builder", () => {
    expect(resolveOptions({}, packageRoot()).sourcemap).toBe(false);
  });

  it.each([
    [{ sourcemap: true }, {}, true],
    [{}, { build: { sourcemap: true } }, true],
    [{ sourcemap: false }, { build: { sourcemap: true } }, false],
  ])("decides source maps for %j under the Vite config %j: %s", (options, vite, expected) => {
    expect(resolveOptions(options, packageRoot(), vite).sourcemap).toBe(expected);
  });

  it.each([["#app"], ["nuxt/kit"], ["@nuxt/kit"], ["h3"], ["vue"], ["node:fs"]])(
    "leaves %s to the app",
    (id) => {
      expect(matchesAny(id, resolveOptions({}, packageRoot()).external)).toBe(true);
    },
  );

  it("leaves a declared dependency and an extra external alone, and inlines the rest", () => {
    const root = packageRoot(
      { "src/module.ts": "" },
      { name: "mod", type: "module", dependencies: { dep: "1" } },
    );
    const { external } = resolveOptions({ external: ["extra"] }, root);
    expect([
      matchesAny("dep", external),
      matchesAny("extra", external),
      matchesAny("other", external),
    ]).toEqual([true, true, false]);
  });

  it("reads dts options", () => {
    const o = resolveOptions({ dts: { compatible: true, eager: true } }, packageRoot());
    expect([o.dts, o.compatible, o.eager]).toEqual([true, true, true]);
  });

  it("turns declarations off", () => {
    const o = resolveOptions({ dts: false }, packageRoot());
    expect([o.dts, o.compatible, o.eager]).toEqual([false, false, false]);
  });
});
