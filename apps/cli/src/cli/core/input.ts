import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { text } from "node:stream/consumers";

import { Errors, Flags, type Command, type Interfaces, Parser } from "@oclif/core";

import { ZitadelError } from "@/lib/errors";
import { isObject, parseJsonObject, parseJsonOrUndefined, wordOf } from "@/lib/json";
import { kebab } from "@/lib/names";
import { environmentFlags } from "./environment-flags";
import { refusalError, type Refusal } from "./refusal";

/**
 * An `--input` path or `@path` that cannot be read.
 */
const UNREADABLE_REFUSAL = {
  message: "--input cannot read {path}: {problem}",
  hint: "Pass a path to a JSON file, '@path', '-' for stdin, or the JSON itself.",
} as const satisfies Refusal;

/**
 * `--input -` with nothing piped in.
 */
const NOTHING_PIPED_REFUSAL = {
  message: "--input - reads the invocation from a pipe, but nothing is piped in",
  hint: "Pipe a JSON document in, or pass --input <path> or --input '{...}'.",
} as const satisfies Refusal;

/**
 * `--input` given nothing, or only whitespace.
 */
const EMPTY_REFUSAL = {
  message: "--input is empty",
  hint: "Pass a JSON object, '@path' to a file holding one, or '-' to read one from stdin.",
} as const satisfies Refusal;

/**
 * A key that points the command at a server or a project, which only the
 * command line may do, so a document read from elsewhere cannot send the
 * run's credentials somewhere the person did not type.
 */
const POINTING_REFUSAL = {
  message: '--input has "{key}", which points the command at a server or project',
  hint: "Type it on the command line, beside --input.",
} as const satisfies Refusal;

/**
 * The flags that point a command at a server or a project.
 */
const POINTING = new Set(["server", "env", "env-file", "cwd", "project"]);

/**
 * A file that is not a regular file, or is too large to be a document.
 */
const NOT_A_SMALL_FILE_REFUSAL = {
  message: "--input cannot read {path}: it is not a regular file of at most 8 MB",
  hint: "Pass a path to a JSON file, '@path', '-' for stdin, or the JSON itself.",
} as const satisfies Refusal;

/**
 * A document that is no JSON object.
 */
const NOT_A_DOCUMENT_REFUSAL = {
  message: "{problem}",
  hint: '--input takes one JSON object: the flags by name, and the arguments under "args".',
} as const satisfies Refusal;

/**
 * A key that names no flag of the command.
 */
const UNKNOWN_KEY_REFUSAL = {
  message: '--input has "{key}", which is no flag of this command',
  hint: 'Use the flag names the command\'s help lists, without the dashes; positional arguments go under "args".',
  details: { key: "{key}" },
} as const satisfies Refusal;

/**
 * A boolean flag given something other than true or false.
 */
const NOT_A_BOOLEAN_REFUSAL = {
  message: '--input has "{key}" as a flag that takes true or false',
  details: { key: "{key}" },
} as const satisfies Refusal;

/**
 * A list given to a flag that takes one value.
 */
const NOT_A_VALUE_REFUSAL = {
  message: '--input has "{key}" as a list, but the flag takes one value',
  details: { key: "{key}" },
} as const satisfies Refusal;

/**
 * An `args` that is neither an object nor a list.
 */
const BAD_ARGS_REFUSAL = {
  message: '--input has "args" that is neither an object nor a list',
} as const satisfies Refusal;

/**
 * An argument that is a list or an object, where an argument is one word.
 */
const NOT_A_WORD_REFUSAL = {
  message: "--input has an argument that is a list or an object, but an argument is one word",
} as const satisfies Refusal;

/**
 * An argument the command lacks.
 */
const UNKNOWN_ARGUMENT_REFUSAL = {
  message: '--input has the argument "{name}", which this command lacks',
  hint: "It takes {takes}.",
} as const satisfies Refusal;

/**
 * An argument given after one that was left out.
 */
const ARGUMENT_GAP_REFUSAL = {
  message: '--input gives the argument "{name}" but not "{missing}", which comes before it',
  hint: "Give the arguments in order, without leaving one out.",
} as const satisfies Refusal;

/**
 * A word on the line beside `--input` that is not a global flag.
 */
const OTHER_WORDS_REFUSAL = {
  message: "--input is the whole invocation, but the line also has {words}",
  hint: "Put them in the JSON document, or leave --input out. Only the global flags go beside it.",
  details: { words: "{words}" },
} as const satisfies Refusal;

/**
 * A flag, with the name it is declared under.
 */
type Named = Readonly<{ name: string; flag: Interfaces.Flag<unknown> }>;

/**
 * What a command line holds around its documents.
 */
type Line = Readonly<{
  /**
   * The global flags given, with their values, as typed.
   */
  kept: readonly string[];
  /**
   * The names of the global flags given.
   */
  given: readonly string[];
  /**
   * What each `--input` was given, in order.
   */
  sources: readonly string[];
  /**
   * The words that are neither a global flag nor `--input`.
   */
  others: readonly string[];
}>;

/**
 * Turns a JSON document into the words a command is run with: the whole
 * invocation, flags and arguments, as one object, the way `aws
 * --cli-input-json` and `gcloud --flags-file` take theirs.
 *
 * The document's keys are the flag names a command's help lists (`given_name`
 * and `givenName` reach `--given-name`), `args` holds the positionals by name
 * or in order, a list is a repeated flag, and a `false` for a flag that has a
 * `--no-` form is that form. The document is the whole invocation: only the
 * global flags may stand beside it, and any other word is refused.
 *
 * Flags become `--name=value` and the arguments follow a `--`, so no value can
 * be read as a flag. It works before oclif parses, so no command knows it
 * exists, and every flag and argument is checked by its own declaration
 * afterwards, exactly as if the words had been typed.
 */
export class Input {
  /**
   * What a document given inline starts with: an object, a list, a string,
   * `null`, `true` or `false`.
   */
  private static readonly inline = /^(?:[{["]|null$|true$|false$)/u;

  /**
   * The names the whole invocation is passed under.
   */
  private static readonly names: ReadonlySet<string> = new Set([
    "input",
    "flags-file",
    "cli-input-json",
  ]);

  /**
   * The flags that decide what a run does to the world. Previewable and
   * Destructive commands declare them with the other base flags, yet they are
   * the document's to give, so a line may not carry one beside it.
   */
  private static readonly deciding: ReadonlySet<string> = new Set(["dry-run", "force"]);

  /**
   * The flags the command declares, by every name they answer to.
   */
  private readonly byName: ReadonlyMap<string, Named>;

  /**
   * The flags the command declares as oclif tokenizes a line with them: the
   * names, kinds and short forms, with nothing that checks or reads a value.
   */
  private readonly tokenizing: Record<string, Interfaces.Flag<unknown>>;

  /**
   * The flags that may stand beside a document, by every name they answer to.
   */
  private readonly globals: ReadonlyMap<string, Named>;

  /**
   * The command's arguments, in the order it takes them.
   */
  private readonly argNames: readonly string[];

  /**
   * Whether the command refuses words beyond its declared arguments.
   */
  private readonly strict: boolean;

  /**
   * @param command - The command class whose declarations documents are read against.
   */
  public constructor(
    command: Pick<typeof Command, "flags" | "baseFlags" | "args" | "enableJsonFlag" | "strict">,
  ) {
    const byName = new Map<string, Named>();
    const globals = new Map<string, Named>();
    const tokenizing: Record<string, Interfaces.Flag<unknown>> = {};
    const declared = {
      ...(command.enableJsonFlag ? { json: Flags.boolean() } : {}),
      ...command.baseFlags,
      ...command.flags,
    };
    for (const [name, flag] of Object.entries(declared)) {
      const one = { name, flag } satisfies Named;
      const isGlobal =
        !Input.names.has(name) &&
        !Input.deciding.has(name) &&
        (name === "json" ||
          Object.hasOwn(command.baseFlags ?? {}, name) ||
          Object.hasOwn(environmentFlags, name));
      for (const alias of [name, ...(flag.aliases ?? [])]) {
        byName.set(alias, one);
        if (isGlobal) {
          globals.set(alias, one);
        }
      }
      const plain = {
        ...flag,
        parse: async (value: unknown) => {
          return value;
        },
        required: false,
        default: undefined,
        dependsOn: undefined,
        exclusive: undefined,
        relationships: undefined,
        options: undefined,
      };
      tokenizing[name] = plain;
    }
    this.byName = byName;
    this.globals = globals;
    this.tokenizing = tokenizing;
    this.argNames = Object.keys(command.args ?? {});
    this.strict = command.strict !== false;
  }

  /**
   * The words the command is run with when the line holds a document: the
   * global flags as typed, then the document's flags as `--name=value`, then
   * `--` and its arguments.
   *
   * A document that cannot be used, or a line with other words beside it,
   * changes nothing: the documents' text stays on the line as
   * `--input=<text>`, so that the flag refuses it with the reason when oclif
   * parses it, and a document piped in is not read twice. A document that asks
   * for `--json` keeps that, so its refusal is the envelope. Nothing here throws.
   *
   * @param argv - The words after the command's name.
   * @returns The words to run the command with.
   */
  public async rewrite(argv: readonly string[]): Promise<readonly string[]> {
    const line = await this.scan(argv);
    const [source] = line.sources;
    if (source === undefined) {
      for (const [index, word] of argv.entries()) {
        const [name = ""] = word.split("=");
        if (!["--input", "--flags-file", "--cli-input-json"].includes(name)) {
          continue;
        }
        const value = word.includes("=") ? word.slice(word.indexOf("=") + 1) : argv[index + 1];
        if (value !== undefined) {
          try {
            const parsed = parseJsonOrUndefined(await Input.textOf(value));
            const asksForJson = isObject(parsed) && parsed.json === true;

            return asksForJson && !argv.includes("--json") ? [...argv, "--json"] : argv;
          } catch (error) {
            if (!(error instanceof ZitadelError)) {
              throw error;
            }
          }
        }

        return argv;
      }

      return argv;
    }
    if (line.sources.length > 1) {
      return argv;
    }
    try {
      const body = await Input.textOf(source);
      const parsed = parseJsonOrUndefined(body);
      const asked = isObject(parsed) && parsed.json === true;
      const fallback = [
        ...line.kept,
        ...(asked && !line.given.includes("json") ? ["--json"] : []),
        ...line.others,
        `--input=${Input.inline.test(body.trim()) ? body : JSON.stringify(body)}`,
      ];
      if (line.others.length > 0) {
        return fallback;
      }
      try {
        const { flags, args } = await this.check(body, line.given);

        return [...line.kept, ...flags, ...(args.length === 0 ? [] : ["--", ...args])];
      } catch {
        return fallback;
      }
    } catch (error) {
      if (error instanceof ZitadelError) {
        return argv;
      }
      throw error;
    }
  }

  /**
   * Whether a document can be used with this command: what the `--input` flag
   * asks when oclif parses it.
   *
   * @param source - What the flag was given: the document's text, once `Documented` has read it, or what names it.
   * @param words - The words the command was given, to refuse any beside the document.
   * @returns Nothing, when it can.
   * @throws {ZitadelError} E_VALIDATION when it cannot be read, is no JSON object, names a flag or argument the command lacks, or has other words beside it.
   */
  public async verify(source: string, words: readonly string[] = []): Promise<void> {
    const { others } = await this.scan(words);
    if (others.length > 0) {
      throw refusalError(OTHER_WORDS_REFUSAL, { words: others.join(" ") });
    }
    try {
      await this.check(await Input.textOf(source));
    } catch (error) {
      if (error instanceof ZitadelError) {
        throw error;
      }
      if (error instanceof SyntaxError) {
        throw refusalError(NOT_A_DOCUMENT_REFUSAL, {
          problem: "--input is not valid JSON",
        });
      }
      throw refusalError(NOT_A_DOCUMENT_REFUSAL, {
        problem: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * The words the documents give, when they fit the command.
   *
   * @param body - The document's text.
   * @param given - The names of the global flags the line gave, which the documents do not repeat.
   * @returns The words for the flags and for the arguments.
   * @throws {ZitadelError} E_VALIDATION when the document is no JSON object, or names a flag or argument the command lacks.
   */
  private async check(
    body: string,
    given: readonly string[] = [],
  ): Promise<Readonly<{ flags: readonly string[]; args: readonly string[] }>> {
    const { args, ...rest } = parseJsonObject(body, "--input");
    const flags: string[] = [];
    const named: Record<string, unknown> = Object.create(null);
    for (const [key, value] of Object.entries(rest)) {
      const flag = this.byName.get(key) ?? this.byName.get(kebab(key));
      const argument = this.argNames.find((name) => {
        return kebab(name) === kebab(key);
      });
      if (flag === undefined && argument !== undefined) {
        named[argument] = value;
        continue;
      }
      if (flag === undefined || Input.names.has(flag.name)) {
        throw refusalError(UNKNOWN_KEY_REFUSAL, { key });
      }
      if (POINTING.has(flag.name)) {
        throw refusalError(POINTING_REFUSAL, { key });
      }
      if (value === null || given.includes(flag.name)) {
        continue;
      }
      if (flag.flag.type === "boolean") {
        if (typeof value !== "boolean") {
          throw refusalError(NOT_A_BOOLEAN_REFUSAL, { key });
        }
        if (value) {
          flags.push(`--${flag.name}`);
        } else if (flag.flag.allowNo === true) {
          flags.push(`--no-${flag.name}`);
        }
        continue;
      }
      if (!Array.isArray(value)) {
        flags.push(`--${flag.name}=${wordOf(value)}`);
        continue;
      }
      if (flag.flag.multiple === true) {
        for (const one of value) {
          flags.push(`--${flag.name}=${wordOf(one)}`);
        }
        continue;
      }
      if (flag.flag.type !== "option" || flag.flag.delimiter === undefined) {
        throw refusalError(NOT_A_VALUE_REFUSAL, { key });
      }
      flags.push(`--${flag.name}=${value.map(wordOf).join(flag.flag.delimiter)}`);
    }
    if (args !== undefined && args !== null && typeof args !== "object") {
      throw refusalError(BAD_ARGS_REFUSAL, {});
    }
    const takes = this.argNames.length === 0 ? "none" : this.argNames.join(", ");
    const extras: unknown[] = [];
    if (Array.isArray(args)) {
      for (const [index, value] of args.entries()) {
        const name = this.argNames[index];
        if (name !== undefined) {
          named[name] = value;
        } else if (this.strict) {
          throw refusalError(UNKNOWN_ARGUMENT_REFUSAL, {
            name: `#${index + 1}`,
            takes,
          });
        } else if (value !== null) {
          extras.push(value);
        }
      }
    } else {
      Object.assign(named, args);
    }
    for (const name of Object.keys(named)) {
      if (!this.argNames.includes(name)) {
        throw refusalError(UNKNOWN_ARGUMENT_REFUSAL, { name, takes });
      }
    }
    for (const value of [...Object.values(named), ...extras]) {
      if (value !== null && typeof value === "object") {
        throw refusalError(NOT_A_WORD_REFUSAL, {});
      }
    }
    const filled = this.argNames.map((name) => {
      return named[name] !== undefined && named[name] !== null;
    });
    const missing = filled.indexOf(false);
    const gap = missing === -1 ? -1 : filled.indexOf(true, missing);
    if (gap !== -1) {
      throw refusalError(ARGUMENT_GAP_REFUSAL, {
        name: this.argNames[gap] ?? "",
        missing: this.argNames[missing] ?? "",
      });
    }

    return {
      flags,
      args: [
        ...this.argNames.slice(0, missing === -1 ? undefined : missing).map((name) => {
          return wordOf(named[name]);
        }),
        ...extras.map(wordOf),
      ],
    };
  }

  /**
   * What a flag's value names, as the document's text.
   *
   * @param source - Inline JSON (an object, a list, a string, `null`, `true` or `false`), `-` for stdin, `@path`, `file://path` or a path.
   * @returns The text.
   * @throws {ZitadelError} E_VALIDATION when it is stdin with nothing piped in, or a file that cannot be read.
   */
  private static async textOf(source: string): Promise<string> {
    const trimmed = source.trim();
    if (trimmed === "") {
      throw refusalError(EMPTY_REFUSAL, {});
    }
    if (Input.inline.test(trimmed)) {
      return trimmed;
    }
    if (trimmed === "-") {
      if (process.stdin.isTTY) {
        throw refusalError(NOTHING_PIPED_REFUSAL, {});
      }
      const piped = await text(process.stdin);
      if (piped.trim() === "") {
        throw refusalError(NOTHING_PIPED_REFUSAL, {});
      }

      return piped.replace(/^\uFEFF/u, "");
    }
    const path = trimmed.replace(/^@|^file:\/\//u, "");
    const unreadable = (error: unknown): never => {
      throw refusalError(UNREADABLE_REFUSAL, {
        path,
        problem: error instanceof Error ? error.message : String(error),
      });
    };
    try {
      const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
      try {
        const found = await handle.stat();
        if (!found.isFile() || found.size > 8_000_000) {
          throw refusalError(NOT_A_SMALL_FILE_REFUSAL, { path });
        }
        const content = await handle.readFile("utf8");

        return content.replace(/^\uFEFF/u, "");
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (!(error instanceof ZitadelError)) {
        return unreadable(error);
      }
      throw error;
    }
  }

  /**
   * Sorts a command line into the global flags, the documents asked for with
   * `--input`, and everything else, by what oclif's own parser makes of it, so
   * `--`, short flags with their value attached and every spelling a flag
   * answers to are read as oclif reads them. A line oclif cannot parse holds
   * nothing here: the command's own parse says why.
   *
   * @param argv - The words typed.
   * @returns What the line holds.
   */
  private async scan(argv: readonly string[]): Promise<Line> {
    try {
      const parsed = await Parser.parse([...argv], {
        flags: this.tokenizing,
        args: {},
        strict: false,
      });
      const typed = (name: string, input: string): string[] => {
        const flag = this.byName.get(name);
        if (flag?.flag.type === "option") {
          return [`--${flag.name}=${input}`];
        }

        return [parsed.flags[flag?.name ?? name] === false ? `--no-${name}` : `--${name}`];
      };

      const line = {
        kept: [] as string[],
        given: [] as string[],
        sources: [] as string[],
        others: [] as string[],
      };
      for (const token of parsed.raw) {
        const flag = token.type === "flag" ? this.byName.get(token.flag) : undefined;
        if (flag !== undefined && Input.names.has(flag.name)) {
          line.sources.push(token.input);
        } else if (flag !== undefined && this.globals.has(flag.name) && token.type === "flag") {
          line.kept.push(...typed(token.flag, token.input));
          line.given.push(flag.name);
        } else {
          line.others.push(
            ...(token.type === "flag" ? typed(token.flag, token.input) : [token.input]),
          );
        }
      }

      return line;
    } catch (error) {
      if (error instanceof Errors.CLIError) {
        return {
          kept: [],
          given: [],
          sources: [],
          others: [],
        };
      }
      throw error;
    }
  }
}

/**
 * The flag that passes a whole invocation as one JSON document, under the
 * three names people and models reach for. `Documented` has laid the
 * document under the line before this parses, so what parsing it does is the
 * refusal of a document it could not use.
 */
export const inputFlag = Flags.string({
  description:
    "The whole invocation as JSON: inline, '@file.json' or '-' for stdin. Keys are flag names; positional arguments go under \"args\". Only the global flags may stand beside it.",
  aliases: ["flags-file", "cli-input-json"],
  parse: async (value, context) => {
    const command = await context.config.findCommand(context.id ?? "")?.load();
    if (command !== undefined) {
      await new Input(command).verify(value, context.argv);
    }
    return value;
  },
}) satisfies Interfaces.OptionFlag<string | undefined>;
