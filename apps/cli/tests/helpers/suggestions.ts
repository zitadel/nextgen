import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect } from "vitest";

import { cliPackageRoot } from "./oclif-build";

type FlagReference = Readonly<{
  name: string;
  char?: string;
  type: "boolean" | "option";
  allowNo?: true;
  multiple?: true;
}>;

type CommandReference = Readonly<{
  id: string;
  args: readonly unknown[];
  variadic?: true;
  flags: readonly FlagReference[];
}>;

const REFERENCE = JSON.parse(
  readFileSync(join(cliPackageRoot, "command-reference.json"), "utf8"),
) as { globalFlags: FlagReference[]; commands: CommandReference[] };

/** The CLI as a suggestion runs it: `npx @zitadel/cli@<version>` or `zitadel`. */
const RUNNER = /^(?:@zitadel\/cli(?:@\S+)?|zitadel)$/;

/** The words that ask for help rather than run a command. */
const HELP: ReadonlySet<string> = new Set(["--help", "-h"]);

/** One shell word: unquoted characters, escapes and quoted runs, up to the next blank. */
const SHELL_WORD = /(?:[^\s'"\\]|\\[\s\S]|'[^']*'|"(?:\\[\s\S]|[^"\\])*")+/g;
/** A quoted run or an escape inside a word, which the shell replaces with its text. */
const SHELL_QUOTING = /'([^']*)'|"((?:\\[\s\S]|[^"\\])*)"|\\([\s\S])/g;

/** The words a POSIX shell splits a command into, and the operators between them. */
function shellWords(command: string): string[] {
  return (command.match(SHELL_WORD) ?? []).map((word) =>
    word.replaceAll(
      SHELL_QUOTING,
      (_, single?: string, double?: string, escaped?: string) =>
        single ?? double?.replaceAll(/\\([\s\S])/g, "$1") ?? escaped ?? "",
    ),
  );
}

/** What a command's words hold after its name: how many arguments, and the first thing wrong with them. */
type Walk = Readonly<{ positional: number; problem?: string }>;

/** The flag a word names, and whether the word carries its own value (`--name=value`). */
function flagFor(
  token: string,
  flags: readonly FlagReference[],
): Readonly<{ flag?: FlagReference; isInline: boolean }> {
  const isLong = token.startsWith("--");
  const spelled = isLong ? (token.slice(2).split("=")[0] as string) : token.slice(1);
  const isInline = isLong && token.includes("=");
  const named =
    flags.find(({ name }) => {
      return name === spelled;
    }) ??
    flags.find(({ name, allowNo }) => {
      return allowNo && `no-${name}` === spelled;
    });
  const flag = isLong
    ? named
    : flags.find(({ char }) => {
        return char === spelled;
      });

  return { flag, isInline };
}

/**
 * Reads a command's words in order: an option takes the word after it, `--`
 * makes every word after it an argument, and a template's `...` stands for the
 * rest, which it does not spell.
 */
function walk(
  reference: CommandReference,
  flags: readonly FlagReference[],
  tokens: readonly string[],
  seen: ReadonlySet<string> = new Set(),
  positional = 0,
): Walk {
  const [token, ...rest] = tokens;

  if (token === undefined || token === "...") {
    return { positional };
  }
  if (token === "--") {
    return { positional: positional + rest.length };
  }
  if (!token.startsWith("-") || token === "-") {
    return walk(reference, flags, rest, seen, positional + 1);
  }

  const { flag, isInline } = flagFor(token, flags);

  if (flag === undefined) {
    return { positional, problem: `${reference.id} takes no ${token}` };
  }
  if (!flag.multiple && seen.has(flag.name)) {
    return { positional, problem: `${reference.id} takes --${flag.name} once` };
  }

  const remaining = flag.type === "option" && !isInline ? rest.slice(1) : rest;

  return walk(reference, flags, remaining, new Set([...seen, flag.name]), positional);
}

/**
 * Why `command` would not run as the CLI reads it, or `undefined` when it
 * would: it names a command, every flag is one that command takes, a flag
 * given once is not repeated, and it passes no more arguments than the
 * command names. A suggestion that is not a CLI command (`npm run dev`) is
 * not this check's, nor is what a template's closing `...` leaves out.
 */
function problemWith(command: string): string | undefined {
  const words = shellWords(command);
  const runner = words.findIndex((word) => RUNNER.test(word));
  if (runner === -1) {
    return undefined;
  }
  // The command ends at a pipe, a list operator or a redirection (`< value.txt`).
  const end = words.findIndex(
    (word, at) => at > runner && ["|", "&&", "||", ";", "<", ">", "2>&1"].includes(word),
  );
  const rest = words.slice(runner + 1, end === -1 ? undefined : end);
  // Help is oclif's own flag, on the CLI and on every command, so no command lists it.
  if (rest.length > 0 && HELP.has(rest.at(-1) as string)) {
    const named = rest.slice(0, -1);
    return named.length === 0 ||
      REFERENCE.commands.some(({ id }) => {
        return id === named.join(" ");
      })
      ? undefined
      : `names no command: ${named.slice(0, 2).join(" ")}`;
  }
  const reference = REFERENCE.commands
    .filter(({ id }) => id.split(" ").every((part, at) => rest[at] === part))
    .sort((a, b) => b.id.split(" ").length - a.id.split(" ").length)[0];
  if (reference === undefined) {
    return `names no command: ${rest.slice(0, 2).join(" ")}`;
  }
  const flags = [...reference.flags, ...REFERENCE.globalFlags];
  const tokens = rest.slice(reference.id.split(" ").length);
  const walked = walk(reference, flags, tokens);

  if (walked.problem !== undefined) {
    return walked.problem;
  }
  if (!reference.variadic && walked.positional > reference.args.length) {
    return `${reference.id} takes ${reference.args.length} argument(s), not ${walked.positional}`;
  }

  return undefined;
}

/**
 * Every command an envelope suggests runs as the CLI reads it, and a refusal
 * for want of `--force` says how to get past it. Checked on every spec's
 * `--json` run, so a command whose suggestion breaks fails in its own spec.
 */
export function assertRunnableSuggestions(
  where: string,
  envelope: Readonly<{
    status?: string;
    message?: string;
    hint?: string;
    next_commands?: string[];
    data?: unknown;
  }>,
): void {
  const data = envelope.data as { next_commands?: unknown } | undefined;
  const suggested = [
    ...(envelope.next_commands ?? []),
    ...(Array.isArray(data?.next_commands) ? (data.next_commands as string[]) : []),
  ];
  for (const command of suggested) {
    expect(problemWith(command), `${where} suggests \`${command}\``).toBeUndefined();
  }
  if (envelope.status === "error" && envelope.message?.includes("without --force")) {
    expect(
      suggested.some((command) => shellWords(command).includes("--force")) ||
        (envelope.hint ?? "").includes("--force"),
      `${where}: a refusal for want of --force names no way to pass it`,
    ).toBe(true);
  }
}
