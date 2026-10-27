/** What may be taken from clack outside `lib/input.ts`: output, never input. */
const OUTPUT_ONLY = new Set(["spinner", "note", "intro", "outro", "log"]);

const FROM = String.raw`from\s*["']@clack/prompts["']`;

/**
 * What `source` takes from `@clack/prompts` that is not output. Named imports
 * and re-exports are reported by name, and every form that cannot be told
 * apart from taking everything is reported as `*`: a namespace or default
 * import, `export * from`, `import("…")` and `require("…")`. Quotes are
 * single or double, and a type-only import counts, so a name cannot be
 * smuggled past the boundary by spelling.
 */
export function clackInputImports(source: string): string[] {
  const found: string[] = [];

  const named = new RegExp(
    String.raw`(?:import|export)\s+(?:type\s+)?(?:\w+\s*,\s*)?\{([^}]*)\}\s*${FROM}`,
    "g",
  );
  for (const match of source.matchAll(named)) {
    for (const entry of (match[1] ?? "").split(",")) {
      const name = entry
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0];
      if (name !== undefined && name !== "" && !OUTPUT_ONLY.has(name)) {
        found.push(name);
      }
    }
  }

  const everything = [
    new RegExp(String.raw`import\s+(?:type\s+)?\*\s+as\s+\w+\s+${FROM}`),
    new RegExp(String.raw`import\s+(?:type\s+)?\w+\s*(?:,\s*\{[^}]*\}\s*)?${FROM}`),
    new RegExp(String.raw`export\s+(?:type\s+)?\*(?:\s+as\s+\w+)?\s+${FROM}`),
    /import\s*\(\s*["']@clack\/prompts["']\s*\)/,
    /require\s*\(\s*["']@clack\/prompts["']\s*\)/,
  ];
  if (everything.some((form) => form.test(source))) {
    found.push("*");
  }
  return found;
}
