import type { Hook } from "@oclif/core";
import { distance } from "fastest-levenshtein";

import { ZitadelError } from "@/lib/errors";
import { type Admitted, BaseCommand } from "@/lib/oclif/base";
import type { JsonEnvelope } from "@/lib/oclif/types";
import { commandOf, type SuggestedCommand } from "@/lib/suggestion";
import type { Telemetry, TelemetryDeps } from "@/lib/telemetry";

/** The exit code a shell reports for a command it cannot find, which scripts already branch on. */
export const UNKNOWN_COMMAND_EXIT_CODE = 127;

/**
 * What runs when the words typed name no command: a command like every other,
 * so it parses `--json`, prints its failure and exits as every command does,
 * and only the refusal is its own. It is never registered, so it is never
 * listed, completed or suggested.
 *
 * It names the command as far as it was wrong: the longest run of words that
 * is a topic, and the one word after it that is not a command there. Whatever
 * follows may be an argument, which a refusal never repeats. It suggests the
 * help of the one visible command a word is a single edit from, never the
 * command itself, which would run without the flags typed, so a typo can never
 * turn into a different, possibly destructive, command.
 */
export class NotFound extends BaseCommand {
  static override readonly id = "not-found";
  static override hidden = true;
  // Whatever was typed is its arguments.
  static override strict = false;
  static override meta = { resolveServer: false };

  /** Whether the words name no command, which exits as a shell does, rather than a command given a word it does not take. */
  private nameless = true;

  /**
   * Refuses what was typed.
   *
   * @param input - The words typed, as arguments.
   * @returns Never; it always refuses.
   * @throws {ZitadelError} The refusal, as `E_VALIDATION`.
   */
  protected async execute(input: Admitted<typeof BaseCommand>): Promise<JsonEnvelope> {
    const words = input.argv.flatMap((word) => word.split(":")).filter((word) => word !== "");
    const named = (hidden: boolean): string[][] => {
      return this.config.commands
        .filter((command) => Boolean(command.hidden) === hidden)
        .flatMap((command) => [command.id, ...command.aliases])
        .map((name) => name.split(":"));
    };
    // The help of the command `words` name, which reads no scope.
    const help = (words: readonly string[]): SuggestedCommand => {
      return commandOf([...words, "--help"], this.cliVersion);
    };
    const visible = named(false);
    const known = [...visible, ...named(true)];
    // The next word of every visible command under `parent`.
    const under = (parent: readonly string[]): string[] => {
      return visible
        .filter((c) => c.length > parent.length && parent.every((w, i) => c[i] === w))
        .map((c) => c[parent.length] as string);
    };
    // The one candidate a word is a single edit, or a change of case, from.
    const near = (word: string, candidates: readonly string[]): string | undefined => {
      const close = [...new Set(candidates)].filter((candidate) => {
        return (
          candidate !== word &&
          (candidate.toLowerCase() === word.toLowerCase() || distance(word, candidate) <= 1)
        );
      });
      return close.length === 1 ? close[0] : undefined;
    };

    if (words[0] === undefined) {
      this.id = "(default)";
      throw new ZitadelError("E_VALIDATION", "That is not a zitadel command.", {
        nextCommands: [help([])],
      });
    }

    // A real command followed by a word it does not take, unless that word is
    // a typo of one of its subcommands: the command's own refusal.
    for (let length = words.length - 1; length > 0; length -= 1) {
      const prefix = words.slice(0, length);
      const exists = known.some((c) => c.length === length && prefix.every((w, i) => c[i] === w));
      if (exists && near(words[length] as string, under(prefix)) === undefined) {
        this.nameless = false;
        this.id = prefix.join(":");
        throw new ZitadelError(
          "E_VALIDATION",
          `${prefix.join(" ")} does not take the argument typed after it.`,
          { nextCommands: [help(prefix)] },
        );
      }
    }

    // A word that is no command where it was typed: the longest run of visible
    // topics, then that word.
    let depth = 0;
    while (depth < words.length - 1 && under(words.slice(0, depth + 1)).length > 0) {
      depth += 1;
    }
    const typed = words.slice(0, depth + 1);
    const parent = typed.slice(0, -1);
    const meant = near(typed[depth] as string, under(parent));
    const next: SuggestedCommand[] = [];
    if (meant !== undefined) {
      next.push(help([...parent, meant]));
    }
    if (parent.length > 0) {
      next.push(help(parent));
    } else if (next.length === 0) {
      next.push(help([]));
    }
    this.id = typed.join(":");
    throw new ZitadelError("E_VALIDATION", `${typed.join(" ")} is not a zitadel command.`, {
      nextCommands: next,
    });
  }

  /**
   * Exits as a shell does for a command it cannot find, or with the refusal's
   * own code when the command exists and was given a word it does not take.
   *
   * @param code - The refusal's exit code.
   * @returns Never.
   */
  public override exit(code = 0): never {
    return super.exit(this.nameless && code !== 0 ? UNKNOWN_COMMAND_EXIT_CODE : code);
  }

  /**
   * Sends nothing: the words typed are free text, which analytics never carry.
   *
   * @param deps - What telemetry is built from.
   * @returns Telemetry that is off.
   */
  protected override createTelemetry(deps: TelemetryDeps): Telemetry {
    return super.createTelemetry({ ...deps, flag: false });
  }
}

/**
 * Hands a name that is no command to {@link NotFound}. It never offers to run
 * another command, as oclif's own prompt did, taking the closest name for the
 * one typed and dropping its flags: `teams delete x --dry-run` became an offer
 * to run `grants delete`.
 *
 * It hands over only the words that name the command and `--json` when it was
 * asked for, since the flags typed belong to a command that does not exist and
 * would be refused as unknown. A flag is skipped wherever it is typed, and so
 * is the value of a flag every command takes one for (`--cwd /tmp`). oclif joins the leading words into `id` and
 * drops a flag after a word with a colon of its own, so the process's own
 * arguments are read when they spell this id, as they do when the CLI is the
 * program run; a run started inside another process (a test runner) gets
 * oclif's words.
 */
const hook: Hook<"command_not_found"> = async ({ id, argv, config }) => {
  const own = process.argv.slice(2);
  const spelled = own.some((_, index) => own.slice(0, index + 1).join(":") === id);
  const typed = spelled ? own : [...id.split(":"), ...(argv ?? [])];
  const end = typed.indexOf("--") === -1 ? typed.length : typed.indexOf("--");
  // The flags every command takes, split by whether they take a value. A flag
  // that is none of them may take one, so the word after it is never read as a
  // command name: it may be a value, a secret even, and is never repeated.
  const flags = Object.entries(BaseCommand.baseFlags);
  const valued = new Set(flags.filter(([, f]) => f.type === "option").map(([name]) => name));
  const switches = new Set([
    "json",
    ...flags.filter(([, f]) => f.type === "boolean").map(([n]) => n),
  ]);
  const named = (letter: string): string | undefined => {
    return flags.find(([, f]) => f.char === letter)?.[0];
  };
  const words: string[] = [];
  let json = false;
  for (let index = 0; index < end; index += 1) {
    const word = typed[index] as string;
    if (!word.startsWith("-")) {
      words.push(word);
      continue;
    }
    if (word === "--json") {
      json = true;
      continue;
    }
    if (word.startsWith("--")) {
      const name = word.slice(2).replace(/^no-/, "");
      if (!word.includes("=") && !switches.has(name)) {
        index += 1;
      }
      continue;
    }
    // A cluster of short flags (`-nc`): the first letter that takes a value
    // takes the rest of the cluster, or the next word when it is the last one.
    for (const [position, letter] of [...word.slice(1)].entries()) {
      const name = named(letter);
      if (name === undefined || valued.has(name)) {
        if (position === word.length - 2) {
          index += 1;
        }
        break;
      }
    }
  }
  await NotFound.run([...words, ...(json ? ["--json"] : [])], config);
};

export default hook;
