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

/** The words a POSIX shell splits a command into, and the operators between them. */
function shellWords(command: string): string[] {
  const words: string[] = [];
  let word: string | undefined;
  for (let at = 0; at < command.length; at++) {
    const char = command[at] as string;
    if (char === "'") {
      const end = command.indexOf("'", at + 1);
      word = (word ?? "") + command.slice(at + 1, end);
      at = end;
    } else if (char === '"') {
      let text = "";
      for (at++; at < command.length && command[at] !== '"'; at++) {
        text += command[at] === "\\" ? (command[++at] ?? "") : command[at];
      }
      word = (word ?? "") + text;
    } else if (char === "\\") {
      word = (word ?? "") + (command[++at] ?? "");
    } else if (/\s/.test(char)) {
      if (word !== undefined) words.push(word);
      word = undefined;
    } else {
      word = (word ?? "") + char;
    }
  }
  if (word !== undefined) words.push(word);
  return words;
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
  const reference = REFERENCE.commands
    .filter(({ id }) => id.split(" ").every((part, at) => rest[at] === part))
    .sort((a, b) => b.id.split(" ").length - a.id.split(" ").length)[0];
  if (reference === undefined) {
    return `names no command: ${rest.slice(0, 2).join(" ")}`;
  }
  const flags = [...reference.flags, ...REFERENCE.globalFlags];
  const seen = new Map<string, number>();
  let positional = 0;
  const tokens = rest.slice(reference.id.split(" ").length);
  for (let at = 0; at < tokens.length; at++) {
    const token = tokens[at] as string;
    // A template's `...` stands for the rest, which it does not spell.
    if (token === "...") {
      break;
    }
    if (token === "--") {
      positional += tokens.length - at - 1;
      break;
    }
    if (!token.startsWith("-") || token === "-") {
      positional++;
      continue;
    }
    const [spelled, inline] = token.startsWith("--")
      ? [token.slice(2).split("=")[0] as string, token.includes("=")]
      : [token.slice(1), false];
    const flag = token.startsWith("--")
      ? (flags.find(({ name }) => name === spelled) ??
        flags.find(({ name, allowNo }) => allowNo && `no-${name}` === spelled))
      : flags.find(({ char }) => char === spelled);
    if (flag === undefined) {
      return `${reference.id} takes no ${token}`;
    }
    seen.set(flag.name, (seen.get(flag.name) ?? 0) + 1);
    if (!flag.multiple && (seen.get(flag.name) ?? 0) > 1) {
      return `${reference.id} takes --${flag.name} once`;
    }
    if (flag.type === "option" && !inline) {
      at++;
    }
  }
  if (!reference.variadic && positional > reference.args.length) {
    return `${reference.id} takes ${reference.args.length} argument(s), not ${positional}`;
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
