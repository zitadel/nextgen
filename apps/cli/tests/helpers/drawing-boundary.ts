/**
 * Who is allowed to draw, as a scan of the source tree.
 *
 * Two boundaries are checked with the same machinery, because they are the
 * same rule at two depths:
 *
 * - {@link clackInputImports}: only `lib/input.ts` *asks*. Every prompt
 *   behaves the same way only if every prompt is asked the same way.
 * - {@link drawsDirectly}: only `lib/ui/` *draws*. A module that reaches for
 *   `@clack/prompts`, `consola`, `console.log` or `process.stdout.write`
 *   produces output the UI package never sees, so it cannot be framed,
 *   wrapped, marked, silenced under `--json` or drawn inside the chain.
 *
 * Both scan text rather than a parsed AST: an import is a line of source, the
 * forms it can take are few, and a regex that is wrong is wrong loudly. Each
 * reports every form that cannot be told apart from taking everything (`*`),
 * so a name cannot be smuggled past the boundary by spelling it differently.
 */

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

/**
 * Drops comments, so prose that quotes a forbidden call ("never
 * `consola.warn`") is not read as the call itself. Block comments go whole;
 * a line comment counts only where `//` opens the line, which leaves the
 * `//` of a URL inside a string alone.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Whether `source` takes anything at all from the module `name`. */
function imports(source: string, name: string): boolean {
  const quoted = `["']${name.replace("/", String.raw`\/`)}["']`;
  return [
    new RegExp(String.raw`(?:import|export)[\s\S]{0,200}?from\s*${quoted}`),
    new RegExp(String.raw`import\s+${quoted}`),
    new RegExp(String.raw`import\s*\(\s*${quoted}\s*\)`),
    new RegExp(String.raw`require\s*\(\s*${quoted}\s*\)`),
  ].some((form) => form.test(source));
}

/**
 * Every way `source` draws for itself, named so a failure says what to do
 * about it, or empty for a file that leaves drawing to the UI package.
 *
 * `consola/utils` is not drawing: it is `box` and `stripAnsi`, string work
 * that writes nothing. Writing to a child process's stdin, or reading either
 * stream, is not drawing either — only a write to this process's stdout or
 * stderr is.
 */
export function drawsDirectly(source: string): string[] {
  const text = code(source);
  const found: string[] = [];
  if (imports(text, "@clack/prompts")) {
    found.push("imports @clack/prompts");
  }
  if (imports(text, "consola")) {
    found.push("imports consola");
  }
  const console_ = /\bconsole\s*\.\s*(log|error|warn|info|debug|trace|table|dir|group)\s*\(/.exec(
    text,
  );
  if (console_ !== null) {
    found.push(`calls console.${console_[1]}`);
  }
  for (const stream of ["stdout", "stderr"] as const) {
    if (new RegExp(String.raw`\bprocess\s*\.\s*${stream}\s*\.\s*write\s*\(`).test(text)) {
      found.push(`writes to process.${stream}`);
    }
  }
  return found;
}
