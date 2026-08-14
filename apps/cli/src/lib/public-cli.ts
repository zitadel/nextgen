const CLI_PACKAGE_NAME = "@zitadel/cli";

export function npmDistTagForCliVersion(cliVersion: string): string {
  const normalized = cliVersion.trim().replace(/^v/, "");
  const match = normalized.match(/^\d+\.\d+\.\d+-([0-9A-Za-z][0-9A-Za-z-]*)/);
  return match?.[1] ?? "latest";
}

export function npmSelectorForCliVersion(cliVersion: string): string {
  const normalized = cliVersion.trim().replace(/^v/, "");
  if (/^\d+\.\d+\.\d+-alpha\.\d+$/.test(normalized)) {
    return normalized;
  }
  return npmDistTagForCliVersion(normalized);
}

export function publicCliCommand(args: string, cliVersion: string): string {
  const prefix = `npx ${CLI_PACKAGE_NAME}@${npmSelectorForCliVersion(cliVersion)}`;
  return args.length > 0 ? `${prefix} ${args}` : prefix;
}

export function normalizePublicCliCommand(command: string, cliVersion: string): string {
  if (command === "zitadel") {
    return publicCliCommand("", cliVersion);
  }
  if (command.startsWith("zitadel ")) {
    return publicCliCommand(command.slice("zitadel ".length), cliVersion);
  }
  return command;
}

export function normalizePublicCliCommands(
  commands: ReadonlyArray<string> | undefined,
  cliVersion: string,
): string[] | undefined {
  return commands?.map((command) => normalizePublicCliCommand(command, cliVersion));
}

/**
 * Rewrites `zitadel …` command mentions in scaffolded prose (the
 * `.zitadel/**` READMEs) to the public `npx @zitadel/cli@<version> …` form.
 *
 * The checked-in README sources stay written with the bare `zitadel`
 * command — that is the canonical, readable spelling — but the CLI is not a
 * dependency of the scaffolded app, so the bare command does not exist on
 * the user's PATH (and `npx zitadel` would fetch an unrelated npm package).
 * Covers inline code spans (`` `zitadel plan` ``) and fenced-block lines
 * that start with `zitadel `; prose file names like `zitadel.json` and
 * `zitadel.db` don't match because the word must end the span or be
 * followed by a space.
 */
export function normalizePublicCliProse(content: string, cliVersion: string): string {
  const prefix = publicCliCommand("", cliVersion);
  return rewriteCliCodeSpans(content, cliVersion).replace(
    /^(\s*)zitadel (.*)$/gm,
    (_match, indent: string, rest: string) => `${indent}${prefix} ${rest}`,
  );
}

/** The inline-code-span half of {@link normalizePublicCliProse}. */
function rewriteCliCodeSpans(content: string, cliVersion: string): string {
  const prefix = publicCliCommand("", cliVersion);
  return content.replace(
    /`zitadel( [^`\n]*)?`/g,
    (_match, args: string | undefined) => `\`${prefix}${args ?? ""}\``,
  );
}

/**
 * Rewrites `zitadel …` command mentions inside every string of a scaffolded
 * JSON document — today the `.zitadel/meta/*.json` dialect files — returning
 * a rewritten copy. The input is never mutated: the meta-schema bodies are
 * imported JSON modules shared across calls.
 *
 * Those files are byte-copies of the meta-schemas the server embeds
 * (`api/openapi/endpoints/schemas/*.json`), where the bare `zitadel` spelling
 * is the correct one — the server documents the product command, not one
 * project's install. Their `description` strings surface as editor tooltips
 * on the scaffolded `.zitadel/**` files, where the bare command does not
 * exist on the user's PATH, so the copy is normalized on the way out instead
 * of the shared source being edited (same fix PR #872 made for the READMEs).
 *
 * Unlike {@link normalizePublicCliProse} this rewrites inline code spans
 * only: a JSON `description` is prose, so a value that merely begins with
 * the word `zitadel` is a sentence, not a command line.
 */
export function normalizePublicCliJson<T>(value: T, cliVersion: string): T {
  if (typeof value === "string") {
    return rewriteCliCodeSpans(value, cliVersion) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizePublicCliJson(item, cliVersion)) as T;
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizePublicCliJson(item, cliVersion)]),
    ) as T;
  }
  return value;
}
