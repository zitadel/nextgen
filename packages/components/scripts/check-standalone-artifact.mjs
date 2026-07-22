/**
 * Verifies `dist/standalone.mjs` is genuinely self-contained — the
 * unpkg/jsDelivr entry loaded by plain `<script type="module">` pages with no
 * bundler and no import map. Two things break that promise silently, and both
 * have happened:
 *
 * - a bare package specifier surviving the bundle (an import the standalone
 *   `noExternal` list misses, or an import rolldown could not resolve because
 *   a workspace dep's dist was not built yet — see the `config:build-release`
 *   dep in moon.yml), which a browser cannot resolve;
 * - a `node:` builtin leaking in (rolldown's CJS-interop `createRequire`
 *   helper when the build platform is not "browser").
 *
 * The bundler exits successfully in both cases — only loading the file in a
 * browser fails. `components:build-release` runs this after building, and
 * `src/standalone-artifact.spec.ts` runs the same checks against the dev
 * build. Single source: both import {@link findArtifactViolations}.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Static import/export-from statements with a bare (non-relative, non-URL)
 * specifier. Relative specifiers start with `.` or `/`; anything else needs a
 * resolver a plain browser page does not have.
 */
const BARE_STATIC_IMPORT = /(?:^|\n)\s*(?:import|export)\b[^;'"]*from\s*["'](?![./])/;
const BARE_SIDE_EFFECT_IMPORT = /(?:^|\n)\s*import\s*["'](?![./])/;
const BARE_DYNAMIC_IMPORT = /\bimport\s*\(\s*["'](?![./])/;

export function findArtifactViolations(source) {
  const violations = [];
  if (
    BARE_STATIC_IMPORT.test(source) ||
    BARE_SIDE_EFFECT_IMPORT.test(source) ||
    BARE_DYNAMIC_IMPORT.test(source)
  ) {
    violations.push("bare package import (a browser cannot resolve it without an import map)");
  }
  if (source.includes(`"node:`) || source.includes(`'node:`)) {
    violations.push("node: builtin import (not available in a browser)");
  }
  return violations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2] ?? join(process.cwd(), "dist/standalone.mjs");
  const violations = findArtifactViolations(readFileSync(path, "utf8"));
  if (violations.length > 0) {
    console.error(`standalone artifact check failed for ${path}:`);
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    process.exit(1);
  }
  console.log(`standalone artifact OK: ${path}`);
}
