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
 *   helper when the build platform is not "browser");
 * - the shadow roots not being closed, because the `define` in
 *   tsdown.config.ts did not reach this entry (src/internal/shadow-root.ts).
 *
 * The bundler exits successfully in both cases — only loading the file in a
 * browser fails. `components:build-release` runs this after building, and
 * `src/standalone-artifact.spec.ts` runs the same checks against the dev
 * build. Single source: both import {@link findArtifactViolations}.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
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
  if (!/\bconst SHADOW_ROOT_MODE = "closed";/.test(source)) {
    violations.push("shadow roots are not closed (the build-time shadow root mode is missing)");
  }
  return violations;
}

/**
 * The npm library build: some module of it sets the shadow root mode, and none
 * sets anything but closed. `standalone.mjs` is checked by
 * {@link findArtifactViolations}; this covers the entries and chunks beside it.
 */
export function findLibraryViolations(distDir) {
  const modules = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return modules(path);
      return name.endsWith(".mjs") && name !== "standalone.mjs" ? [path] : [];
    });
  const modes = modules(distDir).flatMap((path) =>
    [...readFileSync(path, "utf8").matchAll(/\bconst SHADOW_ROOT_MODE = ([^;\n]+);/g)].map(
      (match) => match[1],
    ),
  );
  const violations = [];
  if (modes.length === 0) {
    violations.push("the library build does not set the shadow root mode");
  }
  if (modes.some((mode) => mode !== '"closed"')) {
    violations.push("the library build does not close the shadow roots");
  }
  return violations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2] ?? join(process.cwd(), "dist/standalone.mjs");
  const violations = [
    ...findArtifactViolations(readFileSync(path, "utf8")),
    ...findLibraryViolations(dirname(path)),
  ];
  if (violations.length > 0) {
    console.error(`standalone artifact check failed for ${path}:`);
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    process.exit(1);
  }
  console.log(`standalone artifact OK: ${path}`);
}
