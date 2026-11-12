import type { Hook } from "@oclif/core";
import { distance } from "fastest-levenshtein";

import { EXIT_CODES, ZitadelError } from "@/lib/errors";
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
 * is a topic, and the one word after it that is not a command there, which it
 * repeats as typed. The words after that one may be arguments, which a refusal
 * never repeats. It suggests the
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
    const named = (hidden: boolean): string[][] => {
      return this.config.commands
        .filter((command) => Boolean(command.hidden) === hidden)
        .flatMap((command) => [command.id, ...command.aliases])
        .map((name) => name.split(":"));
    };
    // The help of the command `words` name, which reads no scope.
    const help = (path: readonly string[]): SuggestedCommand => {
      return commandOf([...path, "--help"], this.cliVersion);
    };
    const visible = named(false);
    const known = [...visible, ...named(true)];
    // A word is a command id typed with colons (`env:add`) only when it starts
    // with a word some command does; any other colon is the word's own (a URL).
    const leading = new Set(
      known.map((c) => {
        return c[0];
      }),
    );
    const words = input.argv
      .flatMap((word) => {
        return leading.has(word.split(":")[0] as string) ? word.split(":") : [word];
      })
      .filter((word) => {
        return word.trim() !== "";
      });
    // The next word of every visible command under `parent`.
    const under = (parent: readonly string[]): string[] => {
      return visible
        .filter((c) => c.length > parent.length && parent.every((w, i) => c[i] === w))
        .map((c) => c[parent.length] as string);
    };
    // The candidates a word is a single edit, or a change of case, from.
    const close = (word: string, candidates: readonly string[]): string[] => {
      return [...new Set(candidates)].filter((candidate) => {
        return (
          candidate !== word &&
          (candidate.toLowerCase() === word.toLowerCase() || distance(word, candidate) <= 1)
        );
      });
    };
    // The one candidate a word is close to, when only one is.
    const near = (word: string, candidates: readonly string[]): string | undefined => {
      const found = close(word, candidates);
      return found.length === 1 ? found[0] : undefined;
    };

    if (words[0] === undefined) {
      this.id = "(default)";
      throw new ZitadelError("E_VALIDATION", "That is not a zitadel command", {
        nextCommands: [help([])],
      });
    }

    // A real command followed by a word it does not take, unless that word is
    // a typo of one or more of its subcommands: the command's own refusal.
    for (let length = words.length - 1; length > 0; length -= 1) {
      const prefix = words.slice(0, length);
      const exists = known.some((c) => c.length === length && prefix.every((w, i) => c[i] === w));
      if (exists && close(words[length] as string, under(prefix)).length === 0) {
        this.nameless = false;
        this.id = prefix.join(":");
        throw new ZitadelError(
          "E_VALIDATION",
          `${prefix.join(" ")} does not take the argument typed after it`,
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
    throw new ZitadelError("E_VALIDATION", `${typed.join(" ")} is not a zitadel command`, {
      nextCommands: next,
    });
  }

  /**
   * Exits as a shell does for a command it cannot find, or with the refusal's
   * own code when the command exists and was given a word it does not take.
   * Any other failure, a cancel among them, keeps its own code.
   *
   * @param code - The failure's exit code.
   * @returns Never.
   */
  public override exit(code = 0): never {
    const refused = this.nameless && code === EXIT_CODES.E_VALIDATION;
    return super.exit(refused ? UNKNOWN_COMMAND_EXIT_CODE : code);
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
 * is any value it may take (`--cwd /tmp`). After `--` nothing is a flag, and
 * only when nothing was typed before it is a word there read as the name.
 * oclif joins the leading words into `id` and drops a flag after a word with a
 * colon of its own, so the process's own arguments are read when they spell
 * this id, as they do when the CLI is the program run; a run started inside
 * another process (a test runner) gets oclif's words, a colon typed in a word
 * included.
 */
const hook: Hook<"command_not_found"> = async ({ id, argv, config }) => {
  const own = process.argv.slice(2);
  const spelled = own.some((_, index) => own.slice(0, index + 1).join(":") === id);
  const parts = id.split(":");
  // A flag oclif took for the id is one word, colons and all
  // (`--token:secret:more`), so it is never split into words of its own.
  const cut = parts.findIndex((part) => {
    return part.startsWith("-");
  });
  const leading = cut === -1 ? parts : [...parts.slice(0, cut), parts.slice(cut).join(":")];
  const typed = spelled ? own : [...leading, ...(argv ?? [])];
  // A flag may take the word after it as its value, a secret even, so that
  // word is never read as a command name. Only a name that is a switch in
  // every command that declares it takes none; a letter means something else
  // in every command, so only the base flags' letters are known. A flag every
  // command takes a value for takes the next word whatever it is, as oclif
  // would; any other leaves a word that is a flag itself, such as `--json`.
  const base = Object.entries(BaseCommand.baseFlags);
  const switches = new Map<string, boolean>([["json", true]]);
  for (const [name, flag] of [
    ...base,
    ...config.commands.flatMap((command) => {
      return Object.entries(command.flags);
    }),
  ]) {
    switches.set(name, (switches.get(name) ?? true) && flag.type === "boolean");
  }
  const valued = new Set(
    base.flatMap(([name, flag]) => {
      return flag.type === "option" ? [name] : [];
    }),
  );
  const lettered = (letter: string) => {
    return Object.values(BaseCommand.baseFlags).find((flag) => {
      return flag.char === letter;
    });
  };
  const words: string[] = [];
  let json = false;
  let passed = false;
  for (let index = 0; index < typed.length; index += 1) {
    const word = typed[index] as string;
    const next = typed[index + 1];
    const takesNext = (always: boolean): void => {
      if (always || (next !== undefined && !next.startsWith("-"))) {
        index += 1;
      }
    };
    if (word === "--" && !passed) {
      if (words.length > 0) {
        break;
      }
      passed = true;
      continue;
    }
    if (!word.startsWith("-")) {
      words.push(word);
      continue;
    }
    if (passed) {
      continue;
    }
    if (word === "--json") {
      json = true;
      continue;
    }
    if (word.startsWith("--")) {
      // `--no-color` turns `color` off, but `--no-open` is a switch of its own.
      const typedName = word.slice(2);
      const name =
        switches.has(typedName) || !typedName.startsWith("no-") ? typedName : typedName.slice(3);
      if (!word.includes("=") && switches.get(name) !== true) {
        takesNext(valued.has(name));
      }
      continue;
    }
    // A cluster of short flags (`-nc`): the first letter that takes a value
    // takes the rest of the cluster, or the next word when it is the last one.
    // A letter that is no base flag may be a flag of its own, with the next
    // word its value, so it takes that word too.
    for (const [position, letter] of [...word.slice(1)].entries()) {
      const flag = lettered(letter);
      if (flag?.type === "boolean") {
        continue;
      }
      if (flag === undefined) {
        takesNext(false);
      } else if (position === word.length - 2) {
        takesNext(true);
      }
      break;
    }
  }
  const handed = [...words, ...(json ? ["--json"] : [])];
  // It runs as oclif runs a command it found, after the `prerun` hooks.
  await config.runHook("prerun", { argv: handed, Command: NotFound });
  await NotFound.run(handed, config);
};

export default hook;
