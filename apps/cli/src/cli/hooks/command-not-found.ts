import type { Hook } from "@oclif/core";
import { distance } from "fastest-levenshtein";

import { EXIT_CODES, ZitadelError } from "@/lib/errors";
import { SERVER_FLAG } from "@/cli/commands/server-command";
import { type Admitted, BaseCommand } from "@/cli/core/base";
import { aliasedNouns } from "@/lib/oclif/plural-aliases";
import type { CommandResult } from "@/cli/core/types";
import { regularPlural } from "@/lib/plural";
import { commandOf, type SuggestedCommand } from "@/lib/suggestion";
import { ServerCommand } from "@/cli/commands/server-command";

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
 * never repeats. A plural the commands of a noun answer to (`users`) is read
 * as that noun when a word follows it, so the word is looked up among the
 * noun's commands. It suggests the
 * help of the one visible command a word is the plural of (`policies` for
 * `policy`), or else is a single edit from, never the command itself, which
 * would run without the flags typed, so a typo can never turn into a
 * different, possibly destructive, command.
 *
 * A real command with no subcommands followed by a word it does not take is
 * refused as that command's own: the word is an argument it does not take.
 * After one with subcommands, the word is a subcommand that does not exist,
 * which is the longest run of visible topics, then that word.
 */
export class NotFound extends ServerCommand(BaseCommand) {
  /** The id oclif knows the command by. */
  static override readonly id = "not-found";

  /** Whether the command index leaves it out. */
  static override hidden = true;

  /** Whatever was typed is its arguments. */
  static override strict = false;

  /**
   * It names no server of its own: what was typed is refused whatever the server.
   *
   * @returns No server.
   */
  protected override async resolveServer(): Promise<string> {
    return "";
  }

  /** Whether it refused the words as naming no command, which exits as a shell does. */
  private unknown = false;

  /**
   * Refuses what was typed.
   *
   * @param input - The words typed, as arguments.
   * @returns Never; it always refuses.
   * @throws {ZitadelError} The refusal, as `E_VALIDATION`.
   */
  protected async execute(input: Admitted<typeof BaseCommand>): Promise<CommandResult> {
    const named = (hidden: boolean): string[][] => {
      return this.config.commands
        .filter((command) => Boolean(command.hidden) === hidden)
        .flatMap((command) => [command.id, ...command.aliases])
        .map((name) => name.split(":"));
    };
    /** The help of the command `words` name, which reads no scope. */
    const help = (path: readonly string[]): SuggestedCommand => {
      return commandOf([...path, "--help"], this.cliVersion);
    };
    const visible = named(false);
    const known = [...visible, ...named(true)];
    /**
     * A word is a command id typed with colons (`env:add`) only when it starts
     * with a word some command does; any other colon is the word's own (a URL).
     */
    const leading = new Set(
      known.map((c) => {
        return c[0];
      }),
    );
    const split = input.argv.flatMap((word) => {
      return leading.has(word.split(":")[0] as string) ? word.split(":") : [word];
    });
    /**
     * A blank word names nothing, and nothing after it is named either: the
     * next word may be an argument, a secret even.
     */
    const blank = split.findIndex((word) => {
      return word.trim() === "";
    });
    const read = blank === -1 ? split : split.slice(0, blank);
    /**
     * `users frob` names no command of `user`: the plural runs that noun's
     * commands, so what follows it is one of them or it is nothing.
     */
    const noun = aliasedNouns(this.config.commands).get(read[0] ?? "");
    const words = noun === undefined || read.length < 2 ? read : [noun, ...read.slice(1)];
    /** The next word of every visible command under `parent`. */
    const under = (parent: readonly string[]): string[] => {
      return visible
        .filter((c) => c.length > parent.length && parent.every((w, i) => c[i] === w))
        .map((c) => c[parent.length] as string);
    };
    /** The one candidate a word is a single edit, or a change of case, from. */
    const near = (word: string, candidates: readonly string[]): string | undefined => {
      const close = [...new Set(candidates)].filter((candidate) => {
        return (
          candidate !== word &&
          (candidate.toLowerCase() === word.toLowerCase() || distance(word, candidate) <= 1)
        );
      });
      return close.length === 1 ? close[0] : undefined;
    };

    /**
     * The one candidate a word is the plural of. A command names its noun in
     * the singular, and a plural is not always an edit away: `policies` is
     * three from `policy`.
     */
    const singular = (word: string, candidates: readonly string[]): string | undefined => {
      const plural = word.toLowerCase();
      const singulars = [...new Set(candidates)].filter((candidate) => {
        return regularPlural(candidate) === plural;
      });
      return singulars.length === 1 ? singulars[0] : undefined;
    };

    if (words[0] === undefined) {
      this.id = "(default)";
      this.unknown = true;
      throw new ZitadelError("E_VALIDATION", "That is not a zitadel command", {
        nextCommands: [help([])],
      });
    }

    for (const length of Array.from({ length: words.length - 1 }, (_, drop) => {
      return words.length - 1 - drop;
    })) {
      const prefix = words.slice(0, length);
      const exists = known.some(
        (c) => c.length === prefix.length && prefix.every((w, i) => c[i] === w),
      );
      if (exists && under(prefix).length === 0) {
        this.id = prefix.join(":");
        throw new ZitadelError(
          "E_VALIDATION",
          `${prefix.join(" ")} does not take the argument typed after it`,
          { nextCommands: [help(prefix)] },
        );
      }
    }

    const depth = words.findIndex((_, at) => {
      return at === words.length - 1 || under(words.slice(0, at + 1)).length === 0;
    });
    const typed = words.slice(0, depth + 1);
    const parent = typed.slice(0, -1);
    const word = typed[depth] as string;
    const candidates = under(parent);
    const meant = singular(word, candidates) ?? near(word, candidates);
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
    this.unknown = true;
    throw new ZitadelError("E_VALIDATION", `${typed.join(" ")} is not a zitadel command`, {
      nextCommands: next,
    });
  }

  /**
   * Exits as a shell does for a command it cannot find. Every other failure,
   * the refusal of a word a real command does not take, a validation failure
   * before it refused and a cancel among them, keeps its own code.
   *
   * @param code - The failure's exit code.
   * @returns Never.
   */
  public override exit(code = 0): never {
    const refused = this.unknown && code === EXIT_CODES.E_VALIDATION;
    return super.exit(refused ? UNKNOWN_COMMAND_EXIT_CODE : code);
  }
}

/**
 * Hands a name that is no command to {@link NotFound}. It never offers to run
 * another command, as oclif's own prompt did, taking the closest name for the
 * one typed and dropping its flags: `team delete x --dry-run` became an offer
 * to run `grant delete`.
 *
 * It hands over only the words that name the command and `--json` when it was
 * asked for, since the flags typed belong to a command that does not exist and
 * would be refused as unknown. A flag is skipped wherever it is typed, and so
 * is any value it may take (`--cwd /tmp`). The words after `--` are read as
 * the name only when nothing was typed before it, and only up to the first one
 * that reads as a flag.
 * oclif joins the leading words into `id` and drops a flag after a word with a
 * colon of its own, so the process's own arguments are read when they spell
 * this id, as they do when the CLI is the program run; a run started inside
 * another process (a test runner) gets oclif's words, a colon typed in a word
 * included.
 *
 * A flag oclif took for the id is one word, colons and all
 * (`--token:secret:more`), so it is never split into words of its own. A flag
 * may take the word after it as its value, a secret even, so that word is
 * never read as a command name. Only a name that is a switch in every command
 * that declares it takes none; a letter means something else in every command,
 * so only the base flags' letters are known. A flag every command takes a value
 * for takes the next word whatever it is, as oclif would; any other leaves a
 * word that is a flag itself, such as `--json`. The flags every command takes
 * are the base flags and `--server`. After `--` a word that reads as a flag is
 * an argument, so it ends the name rather than letting a later word, a secret
 * even, be named. `--no-color` turns `color` off, but `--no-open` is a switch
 * of its own. In a cluster of short flags (`-nc`) the first letter that takes a
 * value takes the rest of the cluster, or the next word when it is the last
 * one; a letter that is no base flag may be a flag of its own, with the next
 * word its value, so it takes that word too. The command then runs as oclif
 * runs a command it found, after the `prerun` hooks.
 */
const hook: Hook<"command_not_found"> = async ({ id, argv, config }) => {
  const own = process.argv.slice(2);
  const spelled = own.some((_, index) => own.slice(0, index + 1).join(":") === id);
  const parts = id.split(":");
  const cut = parts.findIndex((part) => {
    return part.startsWith("-");
  });
  const leading = cut === -1 ? parts : [...parts.slice(0, cut), parts.slice(cut).join(":")];
  const typed = spelled ? own : [...leading, ...(argv ?? [])];
  const base = Object.entries({ ...BaseCommand.baseFlags, server: SERVER_FLAG });
  const switches = new Map<string, boolean>([["json", true]]);
  for (const [name, flag] of [
    ...base,
    ...config.commands.flatMap((command) => {
      return Object.entries(command.flags);
    }),
  ]) {
    switches.set(name, (switches.get(name) ?? true) && flag.type === "boolean");
  }
  /** A flag that takes every word after it as a value, as `--origin` does: nothing after it can be named. */
  const greedy = new Set(
    config.commands.flatMap((command) => {
      return Object.entries(command.flags).flatMap(([name, flag]) => {
        return flag.type === "option" && flag.multiple === true && flag.multipleNonGreedy !== true
          ? [name]
          : [];
      });
    }),
  );
  const valued = new Set(
    base.flatMap(([name, flag]) => {
      return flag.type === "option" ? [name] : [];
    }),
  );
  const lettered = (letter: string) => {
    return base
      .map(([, flag]) => {
        return flag;
      })
      .find((flag) => {
        return flag.char === letter;
      });
  };
  /** The scanner's state after each word, replaced by the next word and never changed. */
  type Scan = {
    readonly words: readonly string[];
    readonly json: boolean;
    readonly passed: boolean;
    readonly closed: boolean;
    readonly skipping: boolean;
    readonly finished: boolean;
  };
  const step = (scan: Scan, word: string, index: number): Scan => {
    if (scan.finished) {
      return scan;
    }
    if (scan.skipping) {
      return { ...scan, skipping: false };
    }
    const next = typed[index + 1];
    const takesNext = (always: boolean): Scan => {
      return {
        ...scan,
        skipping: always || (next !== undefined && !next.startsWith("-")),
      };
    };
    if (word === "--" && !scan.passed) {
      return scan.words.length > 0 ? { ...scan, finished: true } : { ...scan, passed: true };
    }
    if (!word.startsWith("-")) {
      return scan.closed
        ? scan
        : {
            ...scan,
            words: [...scan.words, word],
          };
    }
    if (scan.passed) {
      return { ...scan, finished: true };
    }
    if (word === "--json") {
      return { ...scan, json: true };
    }
    if (word.startsWith("--")) {
      const typedName = word.slice(2);
      const name =
        switches.has(typedName) || !typedName.startsWith("no-") ? typedName : typedName.slice(3);
      if (greedy.has(name)) {
        return { ...scan, closed: true };
      }

      return !word.includes("=") && switches.get(name) !== true
        ? takesNext(valued.has(name))
        : scan;
    }
    const letters = [...word.slice(1)].map((letter) => {
      return lettered(letter);
    });
    const position = letters.findIndex((flag) => {
      return flag?.type !== "boolean";
    });
    if (position < 0) {
      return scan;
    }
    if (letters[position] === undefined) {
      return takesNext(false);
    }

    return position === word.length - 2 ? takesNext(true) : scan;
  };
  const scanned = typed.reduce<Scan>(step, {
    words: [],
    json: false,
    passed: false,
    closed: false,
    skipping: false,
    finished: false,
  });
  const handed = [...scanned.words, ...(scanned.json ? ["--json"] : [])];
  await config.runHook("prerun", { argv: handed, Command: NotFound });
  await NotFound.run(handed, config);
};

export default hook;
