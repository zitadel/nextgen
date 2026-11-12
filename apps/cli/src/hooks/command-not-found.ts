import { type Hook, ux } from "@oclif/core";
import { distance } from "fastest-levenshtein";

import { ZitadelError } from "@/lib/errors";
import { stderrColour } from "@/lib/oclif/base";
import {
  asideText,
  envelopeText,
  Failure,
  JsonFailureOutput,
  TerminalFailureOutput,
} from "@/lib/oclif/failure";
import { type SuggestedCommand, unscopedCommand } from "@/lib/suggestion";
import { Ui } from "@/lib/ui";
import { closest } from "@/lib/zitadel/utils/spelling";

/** The exit code a shell reports for a command it cannot find, which scripts already branch on. */
export const UNKNOWN_COMMAND_EXIT_CODE = 127;

/**
 * The words typed that name no command, and the refusal for them.
 *
 * It names the command as far as it was wrong: the longest run of words that is
 * a topic, and the one word after it that is not a command there. Whatever
 * follows may be an argument, which a refusal never repeats.
 *
 * The follow-ups are the help of the one word the last of those is a single
 * edit from (never the command itself, which would run without the flags
 * typed), and the help of the topic the first words name. A command that merely
 * resembles another is never one of them, so a destructive command is not
 * offered for a different one's name.
 */
export class UnknownCommand {
  /** The words typed that name no command, without the arguments after them. */
  readonly typed: readonly string[];
  /** The refusal. */
  readonly error: ZitadelError;

  /** The commands a refusal may suggest: the visible ones and their aliases. */
  private readonly commands: ReadonlyArray<readonly string[]>;
  /** Every command that exists, hidden ones included, for telling a command from a typo. */
  private readonly known: ReadonlyArray<readonly string[]>;

  /**
   * @param id - What oclif made of the words typed, joined by `:`.
   * @param commands - Every command a person may run, as the words that name it
   *   (`["variable", "list"]`): visible ones and their aliases.
   * @param hidden - The hidden commands, which exist but are never suggested.
   */
  constructor(
    id: string,
    commands: ReadonlyArray<readonly string[]>,
    hidden: ReadonlyArray<readonly string[]> = [],
  ) {
    this.commands = commands;
    this.known = [...commands, ...hidden];
    const words = id.split(":").filter((word) => {
      return word !== "";
    });
    const refused =
      this.nothingUsable(words) ?? this.unwantedArgument(words) ?? this.misspelled(words);
    this.typed = refused.typed;
    this.error = refused.error;
  }

  /**
   * The command as every envelope names it: oclif's id, or `(default)` when no
   * word named one.
   *
   * @returns The id.
   */
  get command(): string {
    return this.typed.length === 0 ? "(default)" : this.typed.join(":");
  }

  /**
   * The refusal for what was typed, among the commands the CLI declares. Only
   * a command that is not hidden, or one of its aliases, is ever suggested.
   *
   * @param id - What oclif made of the words typed, joined by `:`.
   * @param commands - The commands the CLI declares, as oclif lists them.
   * @returns The refusal.
   */
  static among(
    id: string,
    commands: ReadonlyArray<Readonly<{ id: string; hidden?: boolean; aliases: readonly string[] }>>,
  ): UnknownCommand {
    const named = (hidden: boolean): string[][] => {
      return commands
        .filter((command) => {
          return (command.hidden === true) === hidden;
        })
        .flatMap((command) => {
          return [command.id, ...command.aliases];
        })
        .map((commandId) => {
          return commandId.split(":");
        });
    };
    return new UnknownCommand(id, named(false), named(true));
  }

  /**
   * Nothing that could name a command was typed, such as only a flag.
   *
   * @param words - The words typed.
   * @returns The refusal, or `undefined` when a word was typed.
   */
  private nothingUsable(words: readonly string[]): Refused | undefined {
    if (words[0] !== undefined && !words[0].startsWith("-")) {
      return undefined;
    }
    return {
      typed: [],
      error: new ZitadelError("E_VALIDATION", "That is not a zitadel command.", {
        nextCommands: [unscopedCommand("--help")],
      }),
    };
  }

  /**
   * A real command followed by an argument it does not take. A command that is
   * also a topic is not refused this way when the next word is a typo of one of
   * its subcommands.
   *
   * @param words - The words typed.
   * @returns The refusal, or `undefined` when no command begins the words.
   */
  private unwantedArgument(words: readonly string[]): Refused | undefined {
    for (let length = words.length - 1; length > 0; length -= 1) {
      const command = words.slice(0, length);
      if (!this.isCommand(command)) {
        continue;
      }
      if (this.oneEditFrom(words[length] as string, this.childrenOf(command)) !== undefined) {
        return undefined;
      }
      return {
        typed: command,
        error: new ZitadelError(
          "E_VALIDATION",
          `${command.join(" ")} does not take the argument typed after it.`,
          { nextCommands: [unscopedCommand(`${command.join(" ")} --help`)] },
        ),
      };
    }
    return undefined;
  }

  /**
   * A word that is not a command where it was typed, with the help of the one
   * it is a single edit from and of the topic it was typed in.
   *
   * @param words - The words typed.
   * @returns The refusal.
   */
  private misspelled(words: readonly string[]): Refused {
    let depth = 0;
    while (depth < words.length - 1 && this.isTopic(words.slice(0, depth + 1))) {
      depth += 1;
    }
    const typed = words.slice(0, depth + 1);
    const parent = typed.slice(0, -1);
    const meant = this.oneEditFrom(typed[depth] as string, this.childrenOf(parent));
    const next: SuggestedCommand[] = [];
    if (meant !== undefined) {
      next.push(unscopedCommand(`${[...parent, meant].join(" ")} --help`));
    }
    if (depth > 0) {
      next.push(unscopedCommand(`${parent.join(" ")} --help`));
    } else if (next.length === 0) {
      next.push(unscopedCommand("--help"));
    }
    return {
      typed,
      error: new ZitadelError("E_VALIDATION", `${typed.join(" ")} is not a zitadel command.`, {
        nextCommands: next,
      }),
    };
  }

  /**
   * @param name - The words that may name a command.
   * @returns Whether they name one exactly.
   */
  private isCommand(name: readonly string[]): boolean {
    return this.known.some((command) => {
      return command.length === name.length && this.begins(name, command);
    });
  }

  /**
   * A topic is a name that only begins a command: oclif lists a command as a topic too.
   *
   * @param name - The words that may name a topic.
   * @returns Whether some longer command begins with them.
   */
  private isTopic(name: readonly string[]): boolean {
    return this.known.some((command) => {
      return command.length > name.length && this.begins(name, command);
    });
  }

  /**
   * @param parent - The words of a topic, or none for the top level.
   * @returns The next word of every command under it.
   */
  private childrenOf(parent: readonly string[]): string[] {
    return this.commands
      .filter((command) => {
        return command.length > parent.length && this.begins(parent, command);
      })
      .map((command) => {
        return command[parent.length] as string;
      });
  }

  /**
   * @param word - The word typed.
   * @param candidates - The words it may have meant.
   * @returns The candidate a single edit from it, or the one it differs from
   *   only in case, if there is one.
   */
  private oneEditFrom(word: string, candidates: readonly string[]): string | undefined {
    const guess = closest(word, candidates);
    if (guess === undefined) {
      return undefined;
    }
    return guess.toLowerCase() === word.toLowerCase() || distance(word, guess) <= 1
      ? guess
      : undefined;
  }

  /**
   * @param prefix - The words that may begin a command.
   * @param command - The command's words.
   * @returns Whether the command begins with them.
   */
  private begins(prefix: readonly string[], command: readonly string[]): boolean {
    return prefix.every((word, index) => {
      return command[index] === word;
    });
  }
}

/** What a refusal names, and the refusal. */
type Refused = Readonly<{ typed: readonly string[]; error: ZitadelError }>;

/**
 * What was typed on the command line, read as oclif reads it for a command,
 * since no command was found to read it.
 */
export class Invocation {
  private readonly argv: readonly string[];
  private readonly contentType: string | undefined;

  /**
   * @param argv - The arguments typed after the program.
   * @param contentType - The CLI's `CONTENT_TYPE` environment variable, if set.
   */
  constructor(argv: readonly string[], contentType: string | undefined) {
    this.argv = argv;
    this.contentType = contentType;
  }

  /**
   * What was typed, as the words themselves.
   *
   * oclif joins the leading words into the id with `:` and hands over the rest,
   * but drops a flag after a word that has a colon of its own, and the id cannot
   * be split back into words without inventing flags (`frobnicate:--json`). The
   * process's own arguments are the words when they spell this id, as they do
   * when the CLI is the program run; a run started inside another process (a
   * test runner) gets oclif's words, and never that process's own flags.
   *
   * @param id - What oclif made of the leading words, joined by `:`.
   * @param argv - The words oclif handed over after them.
   * @param processArgv - The process's arguments after the program.
   * @param contentType - The CLI's `CONTENT_TYPE` environment variable, if set.
   * @returns The invocation.
   */
  static typed(
    id: string,
    argv: readonly string[],
    processArgv: readonly string[],
    contentType: string | undefined,
  ): Invocation {
    const leading: string[] = [];
    for (const word of processArgv) {
      leading.push(word);
      if (leading.join(":") === id) {
        return new Invocation(processArgv, contentType);
      }
    }
    return new Invocation(argv, contentType);
  }

  /**
   * Whether the run asked for JSON: a `--json` before any `--`, or the content type.
   *
   * @returns Whether the failure is written as an envelope.
   */
  get wantsJson(): boolean {
    if (this.contentType?.toLowerCase() === "json") {
      return true;
    }
    const json = this.argv.indexOf("--json");
    const passThrough = this.argv.indexOf("--");
    return json !== -1 && (passThrough === -1 || json < passThrough);
  }
}

/**
 * Refuses a command that does not exist the way every other failure is
 * refused: one error envelope on stdout under `--json`, the error block on
 * stderr otherwise, and the exit code a shell gives a command it cannot find.
 *
 * It never offers to run another command. oclif's own prompt does, and takes
 * the closest name for the one typed, dropping its flags: `teams delete x
 * --dry-run` became an offer to run `grants delete`.
 */
const hook: Hook<"command_not_found"> = async function ({ id, argv, config }) {
  const unknown = UnknownCommand.among(id, config.commands);
  const failure = new Failure(unknown.error, {
    cliVersion: config.version,
    command: unknown.command,
    source: "",
  });
  const invocation = Invocation.typed(
    id,
    argv ?? [],
    process.argv.slice(2),
    config.scopedEnvVar("CONTENT_TYPE"),
  );
  const output = invocation.wantsJson
    ? new JsonFailureOutput((envelope) => {
        ux.stdout(envelopeText(envelope, config.theme?.json));
      })
    : new TerminalFailureOutput((summary) => {
        // Nothing has been drawn yet, so the summary is written out as a run off a terminal writes it.
        const ui = new Ui({ interactive: false, force: false }, "plain");
        ux.stderr(asideText(ui.written(summary).replace(/\n+$/, ""), stderrColour()));
      });
  output.write(failure);
  return this.exit(UNKNOWN_COMMAND_EXIT_CODE);
};

export default hook;
