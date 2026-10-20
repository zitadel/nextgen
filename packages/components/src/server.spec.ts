import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import * as root from "./index.js";
import * as server from "./server.js";

/**
 * `server.ts` is what the package root resolves to on runtimes without a DOM
 * (see its header). Two things keep that promise: the entry only re-exports
 * what `index.ts` already exports, and the built package really loads under
 * the conditions those runtimes bundle with.
 */

// Resolved from the package cwd, not `import.meta.url` — vite rewrites module
// URLs and vitest always runs with the package directory as cwd (same
// convention as standalone-artifact.spec.ts).
const PACKAGE_ROOT = process.cwd();

type ExportsMap = Record<string, string | Record<string, string>>;
const manifest: { name: string; exports: ExportsMap } = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"),
);

const EDGE_CONDITIONS = ["workerd", "worker", "edge-light"];

/** The public subpaths whose `exports` entry names an edge condition. */
const edgeEntries = Object.entries(manifest.exports).flatMap(([subpath, target]) => {
  if (typeof target === "string") return [];
  const conditions = EDGE_CONDITIONS.filter((condition) => condition in target);
  return conditions.length > 0 ? [{ subpath, conditions }] : [];
});

/**
 * Imports `specifier` in a fresh Node process, which has no `HTMLElement`,
 * `document` or `customElements`. `browser` is passed alongside the edge
 * condition because that is how Wrangler and Next target the edge, and it is
 * the condition that makes Lit pick its browser build.
 */
function importWithoutDom(specifier: string, conditions: string[]) {
  const script = `
    if (typeof HTMLElement !== "undefined") throw new Error("the harness has a DOM");
    await import(${JSON.stringify(specifier)});
  `;
  return spawnSync(
    process.execPath,
    [
      ...conditions.map((condition) => `--conditions=${condition}`),
      "--input-type=module",
      "-e",
      script,
    ],
    { cwd: PACKAGE_ROOT, encoding: "utf8" },
  );
}

describe("server entry", () => {
  it("re-exports the very bindings the package root exports", () => {
    for (const [name, value] of Object.entries(server)) {
      expect(Reflect.get(root, name), name).toBe(value);
    }
  });

  it("is what the package root resolves to on at least one edge condition", () => {
    expect(edgeEntries.map((entry) => entry.subpath)).toContain(".");
  });

  it("is a no-DOM harness: the root without an edge condition still needs Lit's DOM", () => {
    const result = importWithoutDom(manifest.name, ["browser"]);
    expect(result.stderr).toContain("HTMLElement is not defined");
  });

  for (const { subpath, conditions } of edgeEntries) {
    for (const condition of conditions) {
      it(`${manifest.name}${subpath.slice(1)} imports without a DOM under ${condition}`, () => {
        const result = importWithoutDom(`${manifest.name}${subpath.slice(1)}`, [
          condition,
          "browser",
        ]);
        expect(result.stderr).toBe("");
        expect(result.status).toBe(0);
      });
    }
  }
});
