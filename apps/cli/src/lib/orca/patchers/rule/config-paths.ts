/**
 * The module extensions a JS/TS config file can use, in resolution priority.
 * Shared so every config-editing patcher (Vite, Nuxt, …) accepts the same set
 * instead of hardcoding a partial list per framework. CommonJS extensions
 * (`cts`/`cjs`) are excluded: magicast injects ESM `import`/`import.meta.url`,
 * which a CommonJS config file cannot evaluate.
 */
const CONFIG_EXTENSIONS = ["ts", "mts", "js", "mjs"] as const;

/**
 * Candidate config filenames for `basename` across every supported extension,
 * e.g. `configCandidates("vite.config")` →
 * `["vite.config.ts", "vite.config.mts", …, "vite.config.cjs"]`. Handed to the
 * generic `edit` file-op, which patches the first one that exists.
 */
export function configCandidates(basename: string): string[] {
  return CONFIG_EXTENSIONS.map((ext) => `${basename}.${ext}`);
}
