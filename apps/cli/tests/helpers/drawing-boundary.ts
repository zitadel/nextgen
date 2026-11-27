/**
 * Who is allowed to draw, as a scan of the source tree.
 *
 * Only `lib/ui/` *draws*: a module that reaches for `@clack/prompts`,
 * `consola`, `console.log` or `process.stdout.write` produces output the UI
 * package never sees, so it cannot be framed, wrapped, marked, silenced under
 * `--json` or drawn inside the chain. (Who may *ask* is `clack-imports`.)
 *
 * It scans text rather than a parsed AST: an import is a line of source, the
 * forms it can take are few, and a regex that is wrong is wrong loudly. It
 * reports every form that cannot be told apart from taking everything (`*`),
 * so a name cannot be smuggled past the boundary by spelling it differently.
 */

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
