import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Logger, Plugin, UserConfig } from "vite";
import { describe, expect, it } from "vitest";

import { buildFixture, FIXTURE_TSCONFIG, fixture, output } from "./__tests__/fixture.ts";
import { nuxtModule } from "./index.ts";
import { buildConfig } from "./plugin.ts";
import { resolveOptions } from "./options.ts";

/** A fake `@nuxt/cli` whose prepare writes the `.nuxt/tsconfig.json` a real one would. */
const fakeNuxtCli = {
  "node_modules/@nuxt/cli/package.json": JSON.stringify({
    name: "@nuxt/cli",
    type: "module",
    exports: { ".": "./index.mjs" },
  }),
  "node_modules/@nuxt/cli/index.mjs": [
    'import { mkdir, writeFile } from "node:fs/promises";',
    'import { join } from "node:path";',
    "export const runCommand = async (_command, [cwd]) => {",
    "  await mkdir(join(cwd, '.nuxt'), { recursive: true });",
    "  await writeFile(join(cwd, '.nuxt/tsconfig.json'), '{}');",
    "};",
  ].join("\n"),
};

/** A module package: `src/module.ts` and an empty `src/runtime` unless `files` says otherwise. */
function packageRoot(files: Record<string, string> = { "src/module.ts": "" }): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "nuxt-module-plugin-")));
  const all = {
    "package.json": JSON.stringify({ name: "mod", type: "module" }),
    "tsconfig.json": "{}",
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  if ("src/module.ts" in files) mkdirSync(join(root, "src/runtime"), { recursive: true });
  return root;
}

/** The config hook of the plugin's config plugin, run for the project at `root`. */
async function configFor(
  root: string,
  options: Parameters<typeof nuxtModule>[0] = {},
  user: UserConfig = {},
): Promise<UserConfig> {
  const plugin = nuxtModule(options).find((p) => p.name === "nuxt-module:config") as Plugin;
  const hook = plugin.config as (c: UserConfig, env: object) => Promise<UserConfig>;
  return hook({ root, ...user }, { command: "build", mode: "production" });
}

describe("nuxtModule", () => {
  it("is a list of plugins that apply to builds only", () => {
    const plugins = nuxtModule();
    expect(plugins.map((p) => [p.name, p.apply])).toEqual([
      ["nuxt-module:warnings", "build"],
      ["nuxt-module:config", "build"],
      ["nuxt-module:runtime-externals", "build"],
      ["nuxt-module:implicit-dependencies", "build"],
      ["nuxt-module:no-build-paths", "build"],
      ["nuxt-module:runtime", "build"],
      ["nuxt-module:outputs", "build"],
    ]);
  });

  it("is also the default export of the package", async () => {
    const entry = await import("./index.ts");
    expect(entry.default).toBe(nuxtModule);
  });
});

describe("the Vite config the plugin adds", () => {
  it("bundles the module as an ES entry for Node", async () => {
    const root = packageRoot();
    const config = await configFor(root);
    expect([
      config.build?.lib && config.build.lib.entry,
      config.build?.lib && config.build.lib.formats,
      config.build?.ssr,
      config.build?.outDir,
      config.build?.minify,
      config.build?.emptyOutDir,
    ]).toEqual([{ module: join(root, "src/module.ts") }, ["es"], true, "dist", false, true]);
  });

  it("bundles extra entries next to the module", async () => {
    const root = packageRoot();
    const config = await configFor(root, { entry: { server: "src/server.ts" } });
    expect(config.build?.lib && config.build.lib.entry).toEqual({
      module: join(root, "src/module.ts"),
      server: join(root, "src/server.ts"),
    });
  });

  it("writes no source maps unless asked, like @nuxt/module-builder", async () => {
    expect((await configFor(packageRoot())).build?.sourcemap).toBe(false);
  });

  it("names shared chunks like @nuxt/module-builder", async () => {
    const output = (await configFor(packageRoot())).build?.rolldownOptions?.output as {
      chunkFileNames: string;
    };
    expect(output.chunkFileNames).toBe("shared/[name].[hash].mjs");
  });

  it("leaves the settings the project's own Vite config makes to it", async () => {
    const config = await configFor(
      packageRoot(),
      {},
      { build: { outDir: "out", minify: true, emptyOutDir: false, target: "node22" } },
    );
    expect([
      config.build?.outDir,
      config.build?.minify,
      config.build?.emptyOutDir,
      config.build?.target,
    ]).toEqual(["out", true, false, "node22"]);
  });

  it("keeps a logger the project set", async () => {
    const customLogger = {} as Logger;
    expect((await configFor(packageRoot(), {}, { customLogger })).customLogger).toBeUndefined();
  });

  it("transpiles the module with its own tsconfig", async () => {
    const root = packageRoot();
    expect((await configFor(root)).tsconfig).toBe(join(root, "tsconfig.json"));
  });

  it("fails before the build when the module is not prepared, saying how to prepare it", async () => {
    const root = packageRoot({
      "src/module.ts": "",
      "tsconfig.json": '{ "extends": "./.nuxt/tsconfig.json" }',
    });
    await expect(configFor(root)).rejects.toThrow(/prepare: true/);
  });

  it("prepares the module first when prepare is set", async () => {
    const root = packageRoot({
      "src/module.ts": "",
      "tsconfig.json": '{ "extends": "./.nuxt/tsconfig.json" }',
      ...fakeNuxtCli,
    });
    await configFor(root, { prepare: true });
    expect(existsSync(join(root, ".nuxt/tsconfig.json"))).toBe(true);
  }, 30_000);

  it("needs no tsconfig for a build without declarations", async () => {
    const root = packageRoot();
    rmSync(join(root, "tsconfig.json"));
    const config = await configFor(root, { dts: false });
    expect(config.tsconfig).toBeUndefined();
  });

  it("describes the same build whoever calls it", () => {
    const root = packageRoot();
    const o = resolveOptions({}, root);
    const logger = {} as Logger;
    expect(buildConfig(o, {}, logger, { failed: false }).build?.rolldownOptions?.cwd).toBe(root);
  });
});

describe("nuxtModule builds", () => {
  const files = {
    "package.json": JSON.stringify({ name: "mod", version: "1.2.3", type: "module" }),
    "tsconfig.lib.json": FIXTURE_TSCONFIG,
    "src/module.ts":
      'import type { Options } from "./runtime/types.js";\nconst setup = (_o: Options): void => {};\nexport default Object.assign(setup, { getMeta: async () => ({ configKey: "mod" }) });\n',
    "src/index.ts": 'export { useThing } from "./runtime/composables/useThing.js";\n',
    "src/runtime/types.ts": "export interface Options { a: number }\n",
    "src/runtime/lib/helper.ts":
      "export interface Helper { n: number }\nexport const helper = (): Helper => ({ n: 1 });\n",
    "src/runtime/composables/useThing.ts":
      'import { type Helper, helper } from "../lib/helper";\nexport const useThing = (): Helper => helper();\n',
    "src/runtime/composables/useOther.ts": "export const useOther = (): number => 2;\n",
    "src/runtime/composables/useThing.test.ts": "export {};\n",
  };
  const entry = { index: "src/index.ts" };

  it("writes what @nuxt/module-builder writes", async () => {
    const root = fixture(files);
    await buildFixture(root, { entry });
    expect([
      readdirSync(join(root, "dist"))
        .filter((f) => !f.endsWith(".map"))
        .sort(),
      readdirSync(join(root, "dist/runtime/composables")).sort(),
      JSON.parse(output(root, "dist/module.json")),
    ]).toEqual([
      ["index.d.mts", "index.mjs", "module.d.mts", "module.json", "module.mjs", "runtime"],
      ["useOther.d.ts", "useOther.js", "useThing.d.ts", "useThing.js"],
      expect.objectContaining({ configKey: "mod", name: "mod", version: "1.2.3" }),
    ]);
  }, 60_000);

  it("writes into the outDir of the project's Vite config", async () => {
    const root = fixture(files);
    await buildFixture(root, { entry }, { build: { outDir: "build/out" } });
    expect(existsSync(join(root, "build/out/module.mjs"))).toBe(true);
  }, 60_000);

  it("writes .js entries and .d.ts declarations with extension .js", async () => {
    const root = fixture(files);
    await buildFixture(root, { entry, extension: ".js" });
    expect(
      readdirSync(join(root, "dist"))
        .filter((f) => !f.endsWith(".map"))
        .sort(),
    ).toEqual(["index.d.ts", "index.js", "module.d.ts", "module.js", "module.json", "runtime"]);
  }, 60_000);

  it("writes no runtime after a build that fails on a warning Vite logs once the bundle is written", async () => {
    const root = fixture(files);
    let logger: Logger | undefined;
    const lateWarning: Plugin = {
      name: "late-warning",
      configResolved(config) {
        logger = config.logger;
      },
      writeBundle() {
        logger?.warn("late warning");
      },
    };
    await expect(buildFixture(root, { entry }, { plugins: [lateWarning] })).rejects.toThrow(
      /late warning/,
    );
    expect(existsSync(join(root, "dist/runtime"))).toBe(false);
  }, 60_000);

  it("gives runtime JS and declarations explicit .js specifiers", async () => {
    const root = fixture(files);
    await buildFixture(root, { entry });
    expect([
      output(root, "dist/runtime/composables/useThing.js"),
      output(root, "dist/runtime/composables/useThing.d.ts"),
    ]).toEqual([
      expect.stringContaining('from "../lib/helper.js"'),
      expect.stringMatching(/["']\.\.\/lib\/helper\.js["']/),
    ]);
  }, 60_000);

  it("types a bundled entry's .js import of a runtime file by importing it, not by copying it", async () => {
    const root = fixture(files);
    await buildFixture(root, { entry });
    expect(output(root, "dist/index.d.mts")).toMatch(
      /from ["']\.\/runtime\/composables\/useThing\.js["']/,
    );
  }, 60_000);

  it("fails on a type error in the runtime", async () => {
    const root = fixture({
      ...files,
      "src/runtime/composables/useOther.ts": 'export const useOther = (): number => "s";\n',
    });
    await expect(buildFixture(root, { entry })).rejects.toThrow(/type error/);
  }, 60_000);

  it("writes .d.ts copies of the bundled entries with dts.compatible", async () => {
    const root = fixture(files);
    await buildFixture(root, { dts: { compatible: true } });
    expect(existsSync(join(root, "dist/module.d.ts"))).toBe(true);
  }, 60_000);

  it("writes no declarations with dts: false", async () => {
    const root = fixture(files);
    await buildFixture(root, { dts: false });
    expect(existsSync(join(root, "dist/module.d.mts"))).toBe(false);
  }, 60_000);

  it("writes no runtime for a module without one", async () => {
    const root = fixture(files);
    await buildFixture(root, { runtimeDir: false });
    expect(existsSync(join(root, "dist/runtime"))).toBe(false);
  }, 60_000);

  it("writes source maps when asked", async () => {
    const root = fixture(files);
    await buildFixture(root, { sourcemap: true });
    expect(existsSync(join(root, "dist/module.mjs.map"))).toBe(true);
  }, 60_000);
});
