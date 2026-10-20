import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import * as root from "./index.js";
import * as server from "./server.js";

/**
 * `server.ts` is what the package root resolves to on runtimes without a DOM
 * (see its header). Three things keep that promise: the entry only re-exports
 * what `index.ts` already exports, the built package really loads under the
 * conditions those runtimes bundle with, and it still carries what the SDKs
 * import from the root as values.
 *
 * The load checks read the built `dist/` (the `test` task depends on `build`
 * in moon.yml, as `standalone-artifact.spec.ts` does).
 */

// Resolved from the package cwd, not `import.meta.url` — vite rewrites module
// URLs and vitest always runs with the package directory as cwd (same
// convention as standalone-artifact.spec.ts).
const PACKAGE_ROOT = process.cwd();
const PACKAGES_DIR = join(PACKAGE_ROOT, "..");
const SPECIFIER = "@zitadel/components";

/** Written out, not derived, so deleting one from `package.json` fails. */
const EDGE_CONDITIONS = ["workerd", "worker", "edge-light"];

/** SDKs whose sources import nothing from the root but locale data and types. */
const EDGE_SAFE_SDKS = ["sdk-vue", "sdk-svelte", "sdk-qwik", "sdk-solid", "sdk-angular"];

type ExportsMap = Record<string, string | Record<string, string | Record<string, string>>>;
const manifest: { exports: ExportsMap } = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"),
);
const rootEntry = manifest.exports["."];

/** Names a package's sources import from the root as values (not `import type`). */
function valueImportsFromRoot(sdk: string): string[] {
  const dir = join(PACKAGES_DIR, sdk, "src");
  const names = new Set<string>();
  for (const file of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    if (!/\.(ts|tsx|svelte)$/.test(file) || /\.(spec|test)\./.test(file)) continue;
    const source = readFileSync(join(dir, file), "utf8");
    const statement =
      /\b(?:import|export)\s+(type\s+)?\{([^}]*)\}\s*from\s*["']@zitadel\/components["']/g;
    for (const [, typeOnly, list] of source.matchAll(statement)) {
      if (typeOnly || list === undefined) continue;
      for (const member of list.split(",")) {
        const name = member.trim();
        if (name === "" || name.startsWith("type ")) continue;
        names.add(name.split(/\s+as\s+/)[0] ?? name);
      }
    }
  }
  return [...names];
}

/**
 * Imports the package root in a fresh Node process, which has no `HTMLElement`,
 * `document` or `customElements`, and returns what it exports. `browser` is
 * passed alongside an edge condition because that is how Wrangler and Next
 * target the edge, and it is the condition that makes Lit pick its browser
 * build.
 */
function importRoot(conditions: string[]) {
  const script = `
    if (typeof HTMLElement !== "undefined") throw new Error("the harness has a DOM");
    const entry = await import(${JSON.stringify(SPECIFIER)});
    console.log(JSON.stringify(Object.keys(entry)));
  `;
  const result = spawnSync(
    process.execPath,
    [
      ...conditions.map((condition) => `--conditions=${condition}`),
      "--input-type=module",
      "-e",
      script,
    ],
    { cwd: PACKAGE_ROOT, encoding: "utf8" },
  );
  const names: string[] = result.status === 0 ? JSON.parse(result.stdout) : [];
  return { ...result, names };
}

/** Where TypeScript resolves the root with the given `customConditions`. */
function resolveTypes(customConditions: string[]) {
  const { resolvedModule } = ts.resolveModuleName(
    SPECIFIER,
    join(PACKAGE_ROOT, "src/index.ts"),
    {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      customConditions,
    },
    ts.sys,
  );
  return resolvedModule?.resolvedFileName;
}

describe("server entry", () => {
  it("re-exports the very bindings the package root exports", () => {
    expect(Object.keys(server).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(server)) {
      expect(Reflect.get(root, name), name).toBe(value);
    }
  });

  it("carries the locale data the SDKs re-export", () => {
    expect(Object.keys(server)).toContain("businessLocales");
  });

  describe("package.json", () => {
    for (const condition of EDGE_CONDITIONS) {
      it(`resolves the root to the server build under ${condition} with browser`, () => {
        expect(rootEntry).toMatchObject({
          [condition]: {
            types: "./dist/server.d.mts",
            browser: "./dist/server.mjs",
            default: "./dist/index.mjs",
          },
        });
      });

      it(`types the root as the server build under ${condition}`, () => {
        expect(resolveTypes([condition])).toMatch(/\/dist\/server\.d\.mts$/);
      });
    }

    it("keeps the full types without an edge condition", () => {
      expect(resolveTypes([])).toMatch(/\/dist\/index\.d\.mts$/);
    });

    it("lists every edge condition before the generic ones", () => {
      const keys = Object.keys(rootEntry ?? {});
      const firstGeneric = keys.indexOf("types");
      for (const condition of EDGE_CONDITIONS) {
        expect(keys.indexOf(condition), condition).toBeGreaterThanOrEqual(0);
        expect(keys.indexOf(condition), condition).toBeLessThan(firstGeneric);
      }
    });
  });

  describe("without a DOM", () => {
    it("is a harness where the root under browser alone still needs Lit's DOM", () => {
      const result = importRoot(["browser"]);
      expect(result.stderr).toContain("HTMLElement is not defined");
    });

    for (const condition of EDGE_CONDITIONS) {
      it(`loads the root under ${condition} with browser and keeps what the server entry exports`, () => {
        const result = importRoot([condition, "browser"]);
        expect(result.stderr).toBe("");
        expect(result.names.sort()).toEqual(Object.keys(server).sort());
      });

      it(`still loads the full root under ${condition} without browser`, () => {
        const result = importRoot([condition]);
        expect(result.stderr).toBe("");
        expect(result.names).toContain("ZitadelLogin");
      });
    }

    for (const sdk of EDGE_SAFE_SDKS) {
      it(`${sdk} only imports names the server entry exports`, () => {
        const imported = valueImportsFromRoot(sdk);
        expect(imported, `${sdk} reads nothing from the root`).not.toEqual([]);
        expect(Object.keys(server)).toEqual(expect.arrayContaining(imported));
      });
    }
  });
});
