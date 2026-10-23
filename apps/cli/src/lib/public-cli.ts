const CLI_PACKAGE_NAME = "@zitadel/cli";

export function npmDistTagForCliVersion(cliVersion: string): string {
  const normalized = cliVersion.trim().replace(/^v/, "");
  const match = normalized.match(/^\d+\.\d+\.\d+-([0-9A-Za-z][0-9A-Za-z-]*)/);
  return match?.[1] ?? "latest";
}

/**
 * Whether a version is one the release train publishes: a release (`0.1.0`) or
 * an alpha prerelease (`1.0.0-alpha.25`). Any other prerelease (`1.0.0-beta.2`,
 * `0.0.0-test`) has only its dist-tag to point at.
 */
export function isTrainVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+(-alpha\.\d+)?$/.test(version.trim().replace(/^v/, ""));
}

export function npmSelectorForCliVersion(cliVersion: string): string {
  const normalized = cliVersion.trim().replace(/^v/, "");
  if (isTrainVersion(normalized)) {
    return normalized;
  }
  return npmDistTagForCliVersion(normalized);
}

/**
 * The version a scaffold writes for the `@zitadel/*` packages it adds: the
 * CLI's own exact version on the train, else its dist-tag (`beta` for
 * `1.0.0-beta.2`). The packages publish as one lockstep train, so the exact pin
 * keeps the app on the SDK that matches the files this CLI wrote, and lets
 * doctor's `dependency-version` check compare it against the CLI.
 */
export function sdkVersionForCli(cliVersion: string): string {
  return npmSelectorForCliVersion(cliVersion);
}

/**
 * Whether a value can sit in a suggested command unquoted on every shell the
 * CLI runs under (POSIX shells, PowerShell and cmd.exe). Quoting differs
 * between them, so a value that needs quoting is not put in a suggested
 * command at all; callers hand it over as an argument list instead.
 */
export function isPortableShellWord(value: string): boolean {
  // `/` is included so a POSIX-style --cwd path can be suggested as written.
  return /^[A-Za-z0-9_./-]+$/.test(value);
}

/**
 * Suggested commands as strings, built from argument lists. Every argument
 * must be a portable shell word, or none of the commands is returned: a
 * caller then hands over the argument lists alone, which no shell interprets.
 */
export function portableCommands(argLists: readonly string[][], cliVersion: string): string[] {
  if (!argLists.every((args) => args.every(isPortableShellWord))) {
    return [];
  }
  return argLists.map((args) => publicCliCommand(args.join(" "), cliVersion));
}

/**
 * An option and its value as arguments for a suggested command. A value that
 * starts with `-` would be read as the next flag, so it is joined with `=`
 * instead. That token is not a portable shell word, so it also keeps the
 * string form out of {@link portableCommands}.
 *
 * @param option - The option, with its dashes, e.g. `--schema`.
 * @param value - The value it takes, as the user or a file name gave it.
 */
export function optionArgs(option: string, value: string): string[] {
  return value.startsWith("-") ? [`${option}=${value}`] : [option, value];
}

export function publicCliCommand(args: string, cliVersion: string): string {
  const prefix = `npx ${CLI_PACKAGE_NAME}@${npmSelectorForCliVersion(cliVersion)}`;
  return args.length > 0 ? `${prefix} ${args}` : prefix;
}

/** How a suggested follow-up is written out. */
export type FollowUpOptions = {
  /**
   * The suggesting command ran with `--json`: a follow-up that runs this CLI
   * asks for JSON too, so it can be run as given. `--non-interactive` is not
   * added, because `--json` turns prompts off on its own.
   */
  readonly json?: boolean;
};

/**
 * A suggested follow-up in the form a user runs it: a bare `zitadel …` gets
 * the public `npx` prefix, and another tool's command (`npm install`,
 * `docker version`) stays as it is.
 */
export function normalizePublicCliCommand(
  command: string,
  cliVersion: string,
  { json = false }: FollowUpOptions = {},
): string {
  const normalized =
    command === "zitadel"
      ? publicCliCommand("", cliVersion)
      : command.startsWith("zitadel ")
        ? publicCliCommand(command.slice("zitadel ".length), cliVersion)
        : command;
  return json ? withJsonFlag(normalized) : normalized;
}

export function normalizePublicCliCommands(
  commands: ReadonlyArray<string> | undefined,
  cliVersion: string,
  options: FollowUpOptions = {},
): string[] | undefined {
  return commands?.map((command) => normalizePublicCliCommand(command, cliVersion, options));
}

const JSON_FLAG = "--json";

/**
 * A follow-up given as this CLI's arguments rather than a command string,
 * asking for JSON: `--json` is appended unless the arguments carry it.
 */
export function jsonFollowUpArgs(args: ReadonlyArray<string>): string[] {
  return args.includes(JSON_FLAG) ? [...args] : [...args, JSON_FLAG];
}

/**
 * `command` with `--json` appended when it runs one of this CLI's commands
 * and does not carry it yet. The bare `npx @zitadel/cli@<selector>`, which
 * prints help, and other tools' commands are returned as they are.
 */
function withJsonFlag(command: string): string {
  const prefix = `npx ${CLI_PACKAGE_NAME}@`;
  if (!command.startsWith(prefix) || !command.includes(" ", prefix.length)) {
    return command;
  }
  return command.split(" ").includes(JSON_FLAG) ? command : `${command} ${JSON_FLAG}`;
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
 * Those files are generated copies of the meta-schemas the server embeds
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
