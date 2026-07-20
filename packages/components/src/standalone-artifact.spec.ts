/**
 * Guards the self-contained promise of `dist/standalone.mjs` — the
 * unpkg/jsDelivr entry loaded by plain `<script type="module">` pages with no
 * bundler and no import map. Two things break that promise silently, and both
 * have happened:
 *
 * - a bare package specifier surviving the bundle (an import the standalone
 *   `noExternal` list misses — e.g. `@zitadel/config/template`), which a
 *   browser cannot resolve;
 * - a `node:` builtin leaking in (rolldown's CJS-interop `createRequire`
 *   helper when the build platform is not "browser").
 *
 * The build itself passes in both cases because unresolved imports are
 * allowed at bundle time — only loading the file in a browser fails. This
 * spec reads the built artifact (`components:test` depends on
 * `components:build` in moon.yml for exactly this reason).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Resolved from the package cwd, not `import.meta.url` — vite rewrites module
// URLs (server-relative or `/@fs/…`), and vitest always runs with the package
// directory as cwd.
const STANDALONE_PATH = join(process.cwd(), "dist/standalone.mjs");

/**
 * Static import/export-from statements with a bare (non-relative, non-URL)
 * specifier. Relative specifiers start with `.` or `/`; anything else needs a
 * resolver a plain browser page does not have.
 */
const BARE_STATIC_IMPORT = /(?:^|\n)\s*(?:import|export)\b[^;'"]*from\s*["'](?![./])/;
const BARE_SIDE_EFFECT_IMPORT = /(?:^|\n)\s*import\s*["'](?![./])/;

describe("standalone artifact", () => {
  const source = readFileSync(STANDALONE_PATH, "utf8");

  it("contains no bare package imports a browser cannot resolve", () => {
    expect(source).not.toMatch(BARE_STATIC_IMPORT);
    expect(source).not.toMatch(BARE_SIDE_EFFECT_IMPORT);
  });

  it("contains no node: builtin imports", () => {
    expect(source).not.toContain(`"node:`);
    expect(source).not.toContain(`'node:`);
  });
});
