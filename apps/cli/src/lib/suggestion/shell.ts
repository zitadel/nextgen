import { CLI_BINARY, CLI_PACKAGE_NAME } from "@/lib/public-cli";

/**
 * Package runners: each fetches the package named after it and runs its
 * binary, as `npx @zitadel/cli@1.0.0 deploy` does.
 */
const RUNNERS = ["bunx", "npx", "pnpx"] as const;

/**
 * Package managers. Each runs a package or a binary through one of
 * {@link EXECUTES}, and `pnpm` and `yarn` run an installed binary named
 * straight after them (`pnpm zitadel deploy`).
 */
const MANAGERS = ["bun", "npm", "pnpm", "yarn"] as const;

/** The subcommands of a package manager that run a package or a binary: `pnpm dlx @zitadel/cli`. */
const EXECUTES = ["dlx", "exec", "x"] as const;

/**
 * Words that run the command after them rather than being it: `sudo zitadel
 * deploy` runs the CLI as surely as `zitadel deploy` does.
 */
const PREFIXES: ReadonlySet<string> = new Set([
  "builtin",
  "command",
  "env",
  "exec",
  "nice",
  "nohup",
  "sudo",
  "time",
]);

/** {@link RUNNERS}, for looking a word up. */
const RUNNING: ReadonlySet<string> = new Set(RUNNERS);

/** {@link MANAGERS}, for looking a word up. */
const MANAGING: ReadonlySet<string> = new Set(MANAGERS);

/** {@link EXECUTES}, for looking a word up. */
const EXECUTING: ReadonlySet<string> = new Set(EXECUTES);

/**
 * Each quoted span of a command line, `'…'`, `"…"` or `$'…'`: text the shell
 * hands to a command as data and never runs.
 */
const QUOTED = /\$'(?:[^'\\]|\\.)*'|'[^']*'|"(?:[^"\\]|\\.)*"/g;

/**
 * What ends one command of a line and starts the next: `&&`, `||`, `;`, `&`, a
 * pipe, a newline, a subshell's parenthesis or a command substitution.
 */
const BETWEEN_STEPS = /&&|\|\||\$\(|[;&|\n()`]/;

/** A shell variable set for the command after it, as in `CI=1 zitadel deploy`. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** A package runner as a command line starts with one: `npx`, or a manager's `pnpm dlx`. */
type Runner =
  | (typeof RUNNERS)[number]
  | `${(typeof MANAGERS)[number]} ${(typeof EXECUTES)[number]}`;

/** This CLI as a runner is given it: its package, at a version or not, or its binary. */
type Launched =
  | typeof CLI_BINARY
  | typeof CLI_PACKAGE_NAME
  | `${typeof CLI_PACKAGE_NAME}@${string}`;

/**
 * A command line whose first step runs this CLI, as far as its text alone can
 * tell: the binary itself, a package manager running the binary, or a package
 * runner given the CLI, with or without `-y`.
 *
 * It is the part of {@link runsTheCli} the compiler can check in a literal. A
 * later step, a prefix such as `sudo`, or a runner's other options are left to
 * `runsTheCli`, which refuses every line this type matches as well.
 */
export type StartsWithTheCli =
  | typeof CLI_BINARY
  | `${typeof CLI_BINARY} ${string}`
  | `${(typeof MANAGERS)[number]} ${typeof CLI_BINARY}${"" | ` ${string}`}`
  | `${Runner} ${"" | "-y " | "--yes "}${Launched}${"" | ` ${string}`}`;

/**
 * Whether any step of `line` runs this CLI: as the command the step runs once
 * its `VAR=value` assignments and prefixes such as `sudo` are passed, as the
 * package or binary a runner or a manager's `dlx`, `exec` or `x` runs, or as
 * the binary `pnpm` or `yarn` is given.
 *
 * Quoted text is taken out first. The shell hands it to the command as data,
 * so a commit message or a path that mentions the CLI does not run it, and a
 * `;` inside one does not start a step.
 *
 * @param line - The command line, as a shell would read it.
 * @returns Whether a step of it runs the CLI.
 */
export function runsTheCli(line: string): boolean {
  return line
    .replace(QUOTED, "''")
    .split(BETWEEN_STEPS)
    .some((step) => {
      const words = step.split(/\s+/).filter((word) => {
        return word.length > 0;
      });
      return stepRunsTheCli(words);
    });
}

/**
 * Whether one step of a command line runs this CLI.
 *
 * @param words - The step's words, its quoted text already taken out.
 * @returns Whether it runs the CLI.
 */
function stepRunsTheCli(words: readonly string[]): boolean {
  const [command, ...rest] = withoutPrefixes(words);
  if (command === undefined) {
    return false;
  }
  if (RUNNING.has(command)) {
    return isTheCli(firstOperand(rest));
  }
  if (MANAGING.has(command)) {
    const [subcommand, ...operands] = rest;
    if (subcommand !== undefined && EXECUTING.has(subcommand)) {
      return isTheCli(firstOperand(operands));
    }
    return subcommand === CLI_BINARY;
  }

  return isTheCli(command);
}

/**
 * A step's words from the command it runs on: without the `VAR=value`
 * assignments, the prefixes such as `sudo`, and the options a prefix takes
 * that come before it.
 *
 * @param words - The step's words.
 * @returns The command and its arguments, or nothing when the step has none.
 */
function withoutPrefixes(words: readonly string[]): readonly string[] {
  const command = words.findIndex((word) => {
    return !ASSIGNMENT.test(word) && !PREFIXES.has(word) && !word.startsWith("-");
  });

  return command === -1 ? [] : words.slice(command);
}

/**
 * The first of a runner's words that is not an option: the package or binary
 * it runs, or the value of the `-p` that names one.
 *
 * @param words - The words after the runner.
 * @returns The word, or nothing when only options follow.
 */
function firstOperand(words: readonly string[]): string | undefined {
  return words.find((word) => {
    return !word.startsWith("-");
  });
}

/**
 * Whether `word` names this CLI: its package, at a version or not, its binary,
 * or a path to the binary such as `./node_modules/.bin/zitadel`.
 *
 * @param word - A command, or what a runner runs.
 * @returns Whether it is the CLI.
 */
function isTheCli(word: string | undefined): boolean {
  if (word === undefined) {
    return false;
  }

  return (
    word === CLI_BINARY ||
    word.endsWith(`/${CLI_BINARY}`) ||
    word === CLI_PACKAGE_NAME ||
    word.startsWith(`${CLI_PACKAGE_NAME}@`)
  );
}
