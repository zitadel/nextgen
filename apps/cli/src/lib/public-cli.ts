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
  return content
    .replace(/`zitadel( [^`\n]*)?`/g, (_match, args: string | undefined) => {
      return `\`${prefix}${args ?? ""}\``;
    })
    .replace(/^(\s*)zitadel (.*)$/gm, (_match, indent: string, rest: string) => {
      return `${indent}${prefix} ${rest}`;
    });
}
