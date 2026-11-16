/**
 * The package this CLI is published as, which `npx` fetches and runs:
 * `npx @zitadel/cli@1.0.0 deploy`.
 */
export const CLI_PACKAGE_NAME = "@zitadel/cli";

/**
 * The name of the binary the package installs, which is how a person runs an
 * installed CLI and how a `hint:` quotes one: `zitadel deploy`.
 */
export const CLI_BINARY = "zitadel";

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
 * An option and its value as arguments for a suggested command. A value that
 * starts with `-` would be read as the next flag, so it is joined with `=`
 * instead.
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

/**
 * The command on this CLI's dist-tag rather than its exact version, for what
 * has to run the newest release: `upgrade` run by the old version would not
 * know what the new one writes.
 */
export function newestCliCommand(args: string, cliVersion: string): string {
  return `npx ${CLI_PACKAGE_NAME}@${npmDistTagForCliVersion(cliVersion)} ${args}`;
}

export function normalizePublicCliCommand(command: string, cliVersion: string): string {
  if (command === CLI_BINARY) {
    return publicCliCommand("", cliVersion);
  }
  if (command.startsWith(`${CLI_BINARY} `)) {
    return publicCliCommand(command.slice(`${CLI_BINARY} `.length), cliVersion);
  }
  return command;
}

export function normalizePublicCliCommands<T extends string>(
  commands: ReadonlyArray<T> | undefined,
  cliVersion: string,
): T[] | undefined {
  // Only the `zitadel` prefix changes, so a suggestion stays a suggestion.
  return commands?.map((command) => {
    return normalizePublicCliCommand(command, cliVersion) as T;
  });
}

/**
 * Text as a terminal shows it: a command quoted in backticks is written out
 * as the one that runs on the reader's machine, and every other backtick span
 * loses its backticks, because a terminal prints them rather than rendering
 * them as code.
 *
 * Library code writes its hints in the readable form, with the command in
 * backticks. This is the single place that form becomes what a person sees,
 * so no hint has to know the version of the CLI or how it is run.
 *
 * @param text - A message or hint as its author wrote it.
 * @param cliVersion - The running CLI's version, which the public command pins.
 * @returns The text without backticks and with each `zitadel …` command spelled out.
 */
export function spellOutCommands(text: string, cliVersion: string): string {
  return text.replace(/`([^`\n]+)`/g, (_match, span: string) => {
    return span.replace(/(^|\|\s*)zitadel(?= |$)/g, (_found, lead: string) => {
      return `${lead}${publicCliCommand("", cliVersion)}`;
    });
  });
}

/**
 * Rewrites `zitadel …` command mentions in scaffolded prose (the
 * `.zitadel/**` READMEs) to the public `npx @zitadel/cli@<version> …` form.
 *
 * The checked-in README sources stay written with the bare `zitadel`
 * command — that is the canonical, readable spelling — but the CLI is not a
 * dependency of the scaffolded app, so the bare command does not exist on
 * the user's PATH (and `npx zitadel` would fetch an unrelated npm package).
 * Covers inline code spans (`` `zitadel deploy` ``) and fenced-block lines
 * that start with `zitadel `; prose file names like `zitadel.json` and
 * `zitadel.db` don't match because the word must end the span or be
 * followed by a space.
 */
export function normalizePublicCliProse(content: string, cliVersion: string): string {
  const prefix = publicCliCommand("", cliVersion);
  return rewriteCliCodeSpans(content, cliVersion).replace(
    /^(\s*)zitadel (.*)$/gm,
    (_match, indent: string, rest: string) => {
      return `${indent}${prefix} ${rest}`;
    },
  );
}

/** The inline-code-span half of {@link normalizePublicCliProse}. */
function rewriteCliCodeSpans(content: string, cliVersion: string): string {
  const prefix = publicCliCommand("", cliVersion);
  return content.replace(/`zitadel( [^`\n]*)?`/g, (_match, args: string | undefined) => {
    return `\`${prefix}${args ?? ""}\``;
  });
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
 * of the shared source being edited.
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
    return value.map((item) => {
      return normalizePublicCliJson(item, cliVersion);
    }) as T;
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        return [key, normalizePublicCliJson(item, cliVersion)];
      }),
    ) as T;
  }
  return value;
}

/** The version selector of a public `npx @zitadel/cli@<selector>` mention. */
const PUBLIC_CLI_VERSION = new RegExp(`${CLI_PACKAGE_NAME.replaceAll("/", "\\/")}@[^\\s\`]+`, "g");

/**
 * Replaces the version in every public CLI mention inside a JSON document
 * with `*`, so two documents {@link normalizePublicCliJson} wrote for
 * different CLI versions compare equal when nothing else differs. Returns a
 * rewritten copy.
 */
export function maskPublicCliVersion<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(PUBLIC_CLI_VERSION, `${CLI_PACKAGE_NAME}@*`) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      return maskPublicCliVersion(item);
    }) as T;
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        return [key, maskPublicCliVersion(item)];
      }),
    ) as T;
  }
  return value;
}
