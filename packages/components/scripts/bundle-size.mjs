/**
 * Measures what `@zitadel/components` adds to a page: the standalone file,
 * and the library files an app's bundler reaches from the package root
 * through static imports, with the third-party packages they import.
 *
 * A dynamic `import()` is not followed: bundlers split it into a chunk that
 * loads only when the code runs, so it is not on the default path.
 *
 * `src/standalone-artifact.spec.ts` holds the build to the budgets in
 * {@link BUDGETS} and prints the report; run this file by hand
 * (`node scripts/bundle-size.mjs`) to print it for a build.
 */
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

/**
 * The gzip budgets, in bytes. Raise one only with the reason in the commit.
 */
export const BUDGETS = {
  standalone: 205_000,
  defaultPath: 142_000,
};

/**
 * Relative specifiers of static `import`/`export … from` statements.
 */
const STATIC_RELATIVE =
  /(?:^|\n)\s*(?:import|export)\b[^;'"]*?(?:from\s*)?["'](\.{1,2}\/[^"']+)["']/g;

/**
 * Bare specifiers of static `import`/`export … from` statements.
 */
const STATIC_BARE = /(?:^|\n)\s*(?:import|export)\b[^;'"]*?(?:from\s*)?["']((?![./])[^"']+)["']/g;

/**
 * The size of one file.
 *
 * @param {string} path - The file.
 * @returns {{ raw: number, gzip: number }} Bytes on disk and at gzip level 9.
 */
export function sizeOf(path) {
  const content = readFileSync(path);
  return { raw: content.length, gzip: gzipSync(content, { level: 9 }).length };
}

/**
 * The files an entry reaches through static relative imports, and the
 * packages those files import.
 *
 * @param {string} entry - The entry file.
 * @returns {{ files: string[], packages: string[] }} Absolute file paths and
 *   package names, each sorted.
 */
export function staticGraph(entry) {
  const files = new Set();
  const packages = new Set();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop();
    if (files.has(file)) {
      continue;
    }
    files.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(STATIC_RELATIVE)) {
      pending.push(join(dirname(file), match[1]));
    }
    for (const match of source.matchAll(STATIC_BARE)) {
      const parts = match[1].split("/");
      packages.add(match[1].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
    }
  }
  return { files: [...files].sort(), packages: [...packages].sort() };
}

/**
 * The size report for a built `dist/`.
 *
 * @param {string} distDir - The package's `dist` directory.
 * @returns {{
 *   standalone: { raw: number, gzip: number },
 *   defaultPath: { raw: number, gzip: number, files: Array<{ file: string, raw: number, gzip: number }>, packages: string[] },
 * }} The standalone file's size, and the default path's files, total and packages.
 */
export function bundleReport(distDir) {
  const graph = staticGraph(join(distDir, "index.mjs"));
  const files = graph.files.map((file) => ({ file: relative(distDir, file), ...sizeOf(file) }));
  return {
    standalone: sizeOf(join(distDir, "standalone.mjs")),
    defaultPath: {
      raw: files.reduce((sum, file) => sum + file.raw, 0),
      gzip: files.reduce((sum, file) => sum + file.gzip, 0),
      files,
      packages: graph.packages,
    },
  };
}

/**
 * The report as text.
 *
 * @param {ReturnType<typeof bundleReport>} report - The report.
 * @returns {string} One line per file, the totals and the packages.
 */
export function formatReport(report) {
  const lines = ["@zitadel/components bundle size (bytes, raw / gzip -9)"];
  lines.push(
    `standalone.mjs  ${report.standalone.raw} / ${report.standalone.gzip}  (budget ${BUDGETS.standalone})`,
  );
  lines.push("default path from index.mjs, static imports only:");
  for (const file of report.defaultPath.files) {
    lines.push(`  ${file.file}  ${file.raw} / ${file.gzip}`);
  }
  lines.push(
    `  total  ${report.defaultPath.raw} / ${report.defaultPath.gzip}  (budget ${BUDGETS.defaultPath})`,
  );
  lines.push(`  packages it imports: ${report.defaultPath.packages.join(", ")}`);
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(formatReport(bundleReport(process.argv[2] ?? join(process.cwd(), "dist"))));
}
