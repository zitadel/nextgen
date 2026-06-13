/**
 * The module extensions the config edits can actually write, in resolution
 * priority. magicast injects ESM `import`/`import.meta.url`, so only ESM-capable
 * extensions are editable; CommonJS (`cts`/`cjs`) is not.
 */
const CONFIG_EXTENSIONS = ["ts", "mts", "js", "mjs"] as const;

/**
 * The CommonJS extensions we still *probe* (after the ESM ones) so a project
 * whose only config is `*.cjs`/`*.cts` is found and rejected with a targeted
 * "CommonJS is unsupported" error, rather than a misleading "file not found".
 * {@link parseConfigModule} surfaces that error when it sees CommonJS source.
 */
const COMMONJS_EXTENSIONS = ["cts", "cjs"] as const;

/**
 * Candidate config filenames for `basename`, ESM extensions first then the
 * CommonJS ones, e.g. `configCandidates("vite.config")` → `["vite.config.ts",
 * "vite.config.mts", "vite.config.js", "vite.config.mjs", "vite.config.cts",
 * "vite.config.cjs"]`. Handed to the
 * generic `edit` file-op, which patches the first one that exists — an ESM
 * config wins, and a CommonJS-only project is still read so the edit can emit a
 * clear unsupported-format error.
 */
export function configCandidates(basename: string): string[] {
  return [...CONFIG_EXTENSIONS, ...COMMONJS_EXTENSIONS].map((ext) => `${basename}.${ext}`);
}

/**
 * A human-readable glob of the *editable* (ESM) filenames for `basename`, e.g.
 * `configPattern("vite.config")` → `vite.config.{ts,mts,js,mjs}`. Used in error
 * messages so a failure names the extensions setup can actually write (the
 * CommonJS variants are probed but not editable, so they're intentionally
 * omitted here).
 */
export function configPattern(basename: string): string {
  return `${basename}.{${CONFIG_EXTENSIONS.join(",")}}`;
}
