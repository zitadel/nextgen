import { type Hook, ux } from "@oclif/core";
import { distance } from "fastest-levenshtein";

import { ZitadelError } from "@/lib/errors";
import { renderError, toErrorEnvelope } from "@/lib/oclif/base";
import { type SuggestedCommand, unscopedCommand } from "@/lib/suggestion";
import { escapeJsonControlCharacters } from "@/lib/terminal-text";
import { closest } from "@/lib/zitadel/utils/spelling";

/** The exit code a shell reports for a command it cannot find, which scripts already branch on. */
export const UNKNOWN_COMMAND_EXIT_CODE = 127;

/** The refusal for a command that does not exist, and the words it names. */
export type UnknownCommand = Readonly<{
  /** The words typed that name no command, without the arguments after them. */
  typed: readonly string[];
  error: ZitadelError;
}>;

/**
 * The refusal for a command that does not exist.
 *
 * It names the command as far as it was wrong: the longest run of words that is
 * a topic, and the one word after it that is not a command there. Whatever
 * follows may be an argument, which a refusal never repeats.
 *
 * The follow-ups are the one word the last of those is a single edit from, as the
 * command or topic that would run it, and the help of the topic the first words
 * name. A command that merely resembles another is never one of them, so a
 * destructive command is not offered for a different one's name.
 *
 * @param id - What oclif made of the words typed, joined by `:`.
 * @param commands - Every command the CLI lists, as the words that name it (`["variable", "list"]`).
 * @returns The refusal and the words it names.
 */
export function unknownCommand(
  id: string,
  commands: ReadonlyArray<readonly string[]>,
): UnknownCommand {
  // A topic is a name that only begins a command: oclif lists a command as a topic too.
  const isTopic = (name: readonly string[]): boolean => {
    return commands.some((command) => {
      return command.length > name.length && name.every((word, index) => command[index] === word);
    });
  };
  const words = id.split(":").filter((word) => word !== "");
  if (words[0] === undefined || words[0].startsWith("-")) {
    return {
      typed: [],
      error: new ZitadelError("E_VALIDATION", "That is not a zitadel command.", {
        nextCommands: [unscopedCommand("--help")],
      }),
    };
  }
  for (let length = words.length - 1; length > 0; length -= 1) {
    const command = words.slice(0, length);
    if (
      commands.some(
        (known) => known.length === length && command.every((word, index) => known[index] === word),
      )
    ) {
      return {
        typed: command,
        error: new ZitadelError(
          "E_VALIDATION",
          `${command.join(" ")} does not take the argument typed after it.`,
          { nextCommands: [unscopedCommand(`${command.join(" ")} --help`)] },
        ),
      };
    }
  }
  let topicDepth = 0;
  while (topicDepth < words.length - 1 && isTopic(words.slice(0, topicDepth + 1))) {
    topicDepth += 1;
  }
  const typed = words.slice(0, topicDepth + 1);
  const parent = typed.slice(0, -1);
  const siblings = commands
    .filter((command) => {
      return (
        parent.every((word, index) => command[index] === word) && command.length > parent.length
      );
    })
    .map((command) => command[parent.length] as string);
  const wrote = typed[topicDepth] as string;
  const guess = closest(wrote, siblings);
  const meant = guess !== undefined && distance(wrote, guess) <= 1 ? guess : undefined;
  const next: SuggestedCommand[] = [];
  if (meant !== undefined) {
    const meantWords = [...parent, meant];
    const asTopic = isTopic(meantWords);
    next.push(unscopedCommand(`${meantWords.join(" ")}${asTopic ? " --help" : ""}`));
  }
  if (topicDepth > 0) {
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
 * Whether the run asked for JSON, read as oclif reads it for a command: a
 * `--json` before any `--`, or the content type the environment names.
 *
 * @param argv - The arguments typed after the program.
 * @param contentType - The CLI's `CONTENT_TYPE` environment variable, if set.
 * @returns Whether the failure is written as an envelope.
 */
export function wantsJson(argv: readonly string[], contentType: string | undefined): boolean {
  if (contentType?.toLowerCase() === "json") {
    return true;
  }
  const json = argv.indexOf("--json");
  const passThrough = argv.indexOf("--");
  return json !== -1 && (passThrough === -1 || json < passThrough);
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
  const { error, typed } = unknownCommand(
    id,
    config.commandIDs.map((commandId) => commandId.split(":")),
  );
  const meta = { cliVersion: config.version, command: typed.join(" "), source: "" };
  const contentType = config.scopedEnvVar("CONTENT_TYPE");
  if (
    wantsJson([...id.split(":"), ...(argv ?? [])], contentType) ||
    wantsJson(process.argv.slice(2), contentType)
  ) {
    ux.stdout(
      escapeJsonControlCharacters(
        ux.colorizeJson(toErrorEnvelope(error, meta), {
          pretty: true,
          theme: config.theme?.json,
        }),
      ),
    );
  } else {
    process.stderr.write(`${renderError(error, meta)}\n`);
  }
  return this.exit(UNKNOWN_COMMAND_EXIT_CODE);
};

export default hook;
