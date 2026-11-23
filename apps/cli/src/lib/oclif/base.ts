import { resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";

import { Command, Flags, type Interfaces, ux } from "@oclif/core";

import { Cmd } from "@/lib/cmd";
import { byName, type ByName } from "@/lib/names";
import { nonBlankString } from "./flags";
import { inputFlag } from "./input";
import { Documented } from "./documented";
import { Interruptible } from "./interruptible";
import { log, Output, warnings } from "@/lib/ui";

import { failureText, toZitadelError, ZitadelError } from "@/lib/errors";
import { isObject } from "@/lib/json";
import { LocalServerError } from "@/lib/server";
import { LOCAL_SERVER_ADVICE, type LocalServerAdvice } from "@/lib/suggestion/local-server-advice";
import { interpolate } from "./refusal";
import { resolveCwd } from "@/lib/paths";
import {
  Spelling,
  commandOf,
  declaredOf,
  helpOf,
  shellCommand,
  isSuggestion,
  spelled,
  type Again,
  type FlagNameOf,
  type LooseNext,
  type Scope,
  type Suggest,
  type Suggested,
  type SuggestedCommand,
} from "@/lib/suggestion";
import { Runtime } from "@/lib/runtime";
import { Skills } from "@/lib/skills";
import type { Presentation, Summary } from "@/lib/ui";
import { NEXT_LABEL } from "@/lib/ui/summary";
import { Ui } from "@/lib/ui";
import { DrawnSpinner } from "@/lib/ui/spinner";
import { escapeControlCharacters, escapeJsonControlCharacters } from "@/lib/terminal-text";
import type { RELATIONS } from "@/lib/suggestion/relations";
import { type Rerun, type RerunOf, RunSuggestions, typedScopeOf } from "@/lib/suggestion/run";
import { normalizeCommandResult, Presenter, withWarnings } from "./presenter";
import type {
  CommandResult,
  ErrorEnvelope,
  FlagVariable,
  GlobalOptions,
  JsonEnvelope,
} from "./types";

/** The variable the server is named by when `--server` is not given. */
const SERVER: FlagVariable = {
  name: "ZITADEL_API_BASE",
  flag: "server",
  description: "The server URL, or `local`, as `--server` takes it.",
  precedence: "`--server` wins over it, and it wins over `server` in `zitadel.json`.",
};

/**
 * The colour variables, which `bin/run.js` sets from `--color`/`--no-color`
 * and the colour libraries read. The libraries agree that off wins.
 */
const NO_COLOR: FlagVariable = {
  name: "NO_COLOR",
  flag: "color",
  description: "A non-empty value turns color off, as `--no-color` does (https://no-color.org).",
  precedence: "Turns color off even with `--color` or `FORCE_COLOR`.",
};
const FORCE_COLOR: FlagVariable = {
  name: "FORCE_COLOR",
  flag: "color",
  description:
    "Turns color on where it would be off, such as in a pipe, as `--color` does; `0` or `false` turns it off.",
  precedence: "`--no-color` and `NO_COLOR` win over it.",
};

/**
 * The environment variables that set what a global flag sets, each declared
 * beside the code that reads it. The CLI reference lists them beside the
 * flags (`./reference.ts`).
 */
export const FLAG_VARIABLES: readonly FlagVariable[] = [SERVER, NO_COLOR, FORCE_COLOR];

/**
 * What a command knows about its run, by name: enums, booleans, counts or lists
 * of enums, never a value the developer typed.
 */
export type Facts = Readonly<
  Record<string, string | number | boolean | readonly string[] | null | undefined>
>;

/** How a command resolves the context it runs in; see {@link BaseCommand.meta}. */
export type MetaOptions = {
  source?: string;
  environment?: boolean;
};

/**
 * What {@link BaseCommand.execute} receives once a command has been admitted:
 * its parsed flags, arguments and positional words. A flag or argument is read
 * as code reads it (`flags.clientId` for `--client-id`); see `./names`.
 */
export type Admitted<C extends typeof BaseCommand> = Readonly<{
  flags: ByName<Interfaces.InferredFlags<Omit<C["flags"], typeof RELATIONS> & C["baseFlags"]>>;
  args: ByName<Interfaces.InferredArgs<C["args"]>>;
  argv: readonly string[];
}>;

/**
 * Base class for every oclif command. Owns the global flags, builds the
 * {@link GlobalOptions} context (including server `source` resolution) the
 * subclass's `run` reads via `this.meta`, and turns the {@link CommandResult}
 * it returns into the JSON envelope (oclif serialises it natively in `--json`
 * mode) or human-facing text. Errors are translated into the failure envelope
 * and the mapped process exit code. Subclasses stay thin: parse flags, call
 * {@link toMeta}, do their work, and `return this.emit(...)`. The agent
 * contract (ADR 004) is preserved — oclif only replaces parsing, dispatch,
 * help, and JSON emission.
 */
export abstract class BaseCommand extends Documented(Interruptible(Command)) {
  /** Opt into oclif's native `--json` flag and JSON serialisation of the result. */
  static override enableJsonFlag = true;

  /**
   * What this command is doing, as the heading of its output
   * (`┌  Listing origins`): a gerund phrase said of the command itself, never of
   * the project it runs on, which is added after it. A command that sets none
   * is headed by its own name.
   */
  static heading?: string;

  /**
   * Whether this command is a wizard: it walks a person through something, so
   * it draws a chain (`┌`/`│`/`└`), asks its questions inside it, and closes
   * on the summary box holding what it did, what to do next and where it ran.
   *
   * It belongs to the kind of command and nothing else, which is the whole
   * point of declaring it: an unset one is a normal command, and a normal
   * command draws no chain and no box on any run, however many questions it
   * asked, whatever it warned about, and whether or not `--force` spared it a
   * question. See {@link Presentation}.
   *
   * {@link Presentation} names the one that sets it, `setup`. A command that merely
   * *does* something — `variable rm`, `user delete` — is not one of them,
   * however much it asks on the way.
   */
  static wizard?: boolean;

  /**
   * The group the root help lists this command under (the CLI's own list, `cli/commands/groups`).
   * Every product command must set it; the root-help test fails otherwise.
   */
  static group?: string;

  /** Position within {@link group} on the root help, lowest first. */
  static groupOrder?: number;

  /**
   * Flags shared by every command, inherited via oclif `baseFlags`. `--force` is
   * deliberately absent: what it permits differs per command (overwrite a
   * managed file, delete a resource), so each command that honours it declares
   * its own with wording that says what it does. {@link toMeta} still reads
   * `flags.force` into {@link GlobalOptions.force} for those commands.
   */
  static override baseFlags = {
    cwd: nonBlankString({ char: "c", description: "Project directory to operate on." }),
    input: inputFlag,
    "non-interactive": Flags.boolean({
      char: "n",
      description: "Disable prompts. Required when scripting or running as an agent.",
    }),
    "dry-run": Flags.boolean({ description: "Preview without mutating files or the platform." }),
    // `-v` is the short form curl, ssh and wget bind to verbosity, so an agent
    // reaches for it by reflex; the root `--version` here carries no short form,
    // so there is nothing to collide with.
    verbose: Flags.boolean({ char: "v", description: "Verbose logging." }),
    debug: Flags.boolean({ description: "Debug logging." }),
    // Declared so oclif accepts `--color`/`--no-color` rather than refusing them
    // as unknown; the colour decision itself is applied in `bin/run.js` (which
    // sets NO_COLOR/FORCE_COLOR before the libraries load) and honoured here.
    // picocolors reads `--no-color` from argv on its own; the env covers the rest.
    color: Flags.boolean({
      default: true,
      allowNo: true,
      description:
        "Colorize human output. Disable with --no-color; NO_COLOR and FORCE_COLOR are honored too.",
    }),
  };

  /** How the run's context is resolved; see {@link toMeta}. */
  static meta: MetaOptions = {};

  /** Resolved context for the current invocation; set by {@link toMeta}. */
  protected meta: GlobalOptions = this.fallbackMeta();

  /** Everything a command shows a person. Silent until {@link toMeta} finds a terminal. */
  protected ui: Ui = new Ui(
    {
      interactive: false,
      force: false,
    },
    this.presentation(),
  );

  /**
   * Whether this run may offer the Zitadel skills, resolved while the command
   * works so the summary can be built without waiting on a filesystem scan.
   */
  private skillsOffered = false;

  /** The project directory this run is about: `--cwd`, else where it was run. */
  protected get cwd(): string {
    return this.meta.cwd;
  }

  /** The process environment, read through the run so a test can stand it in. */
  protected get env(): NodeJS.ProcessEnv {
    return this.meta.env;
  }

  /** Whether this run previews its work instead of doing it (`--dry-run`). */
  protected get dryRun(): boolean {
    return this.meta.dryRun;
  }

  /** Whether this run may not ask a question (`--non-interactive`, `--json`, no terminal). */
  protected get nonInteractive(): boolean {
    return this.meta.nonInteractive;
  }

  /** Whether this run was told to go ahead regardless (`--force`). */
  protected get force(): boolean {
    return this.meta.force;
  }

  /** Whether a person is at the terminal, on both ends of the run. */
  protected get isTTY(): boolean {
    return this.meta.isTTY;
  }

  /**
   * Runs a read only a person reads the result of: the extra lookup that fills
   * a human rendering and appears nowhere in `data`. Under `--json` it is not
   * run, so the envelope never costs a request, or a permission, that nothing
   * in it uses.
   *
   * @param read - The lookup, which a command states without asking where its output goes.
   * @returns What it read, or `undefined` when nobody reads a rendering.
   */
  protected async forHumans<T>(read: () => Promise<T>): Promise<T | undefined> {
    return Output.json ? undefined : read();
  }

  /** The release of the CLI that is running. */
  protected get cliVersion(): string {
    return this.meta.cliVersion;
  }

  private reading: ReturnType<BaseCommand["parse"]> | undefined;

  /**
   * How the command line chose the project, as typed: `--cwd`, `--env` or
   * `--env-file`, and `--server`, carried into the commands this run suggests.
   */
  private typedScope: Scope = {};

  /** The commands this run suggests next; see {@link suggest}. */
  private readonly suggestions = new RunSuggestions({
    findCommand: (id) => {
      return this.config.findCommand(id);
    },
    cliVersion: () => {
      return this.cliVersion;
    },
    scope: () => {
      return this.scope();
    },
  });

  /** Whether the flags were read and the run's context settled, as opposed to a failure before it. */
  private settled = false;

  /**
   * The one lifecycle every command shares: parse the flags, resolve the
   * context, and only then hand the work to {@link execute}. A flag or
   * argument reaching `execute` has already been refused if it was not one the
   * command accepts; anything else a command needs settled, it settles on
   * `execute`'s first lines.
   */
  async run(): Promise<JsonEnvelope> {
    return this.execute(await this.admit());
  }

  /**
   * The server this run is about, where the command knows it before any work:
   * the one a local runtime's record names, say. It is resolved before the
   * context is built, so every event this run reports — the first one included
   * — classifies the same invocation the same way. `cwd` is the directory the
   * run addresses, resolved already, because `this.cwd` is not set this early.
   * A command that learns its server later sets `this.meta.source` when it does.
   *
   * This runs before the run has a context, so it may only read what is
   * already here — a file, a flag. It is too early to ask a server: the user
   * agent is installed by `init` and the run's context is settled afterwards, so a
   * request from here would go out unidentified and a failure would be
   * reported with no command behind it.
   */
  protected async sourceOf(
    _flags: Record<string, unknown>,
    _cwd: string,
  ): Promise<string | undefined> {
    return undefined;
  }

  /** The command's work, which receives the flags and arguments it accepts. */
  protected abstract execute(input: Admitted<typeof BaseCommand>): Promise<JsonEnvelope>;

  private get command(): typeof BaseCommand {
    return this.ctor as typeof BaseCommand;
  }

  /**
   * The command line, parsed once however many times it is asked for, with the
   * message a flag's `parse` raised put back (see {@link asRaised}). A command
   * that reads an argument before the run is admitted — `api`, for the `help`
   * word — asks for it here rather than parsing again.
   *
   * The flags come back as oclif types them for `BaseCommand`, which is what
   * the command is here: only {@link execute} is handed the names and types
   * its own command declared, which is why {@link admit} asserts them.
   */
  protected parseOnce(): ReturnType<BaseCommand["parse"]> {
    this.reading ??= this.parse(this.command).catch((error: unknown) => {
      throw asRaised(error);
    });

    return this.reading;
  }

  private async admit(): Promise<Admitted<typeof BaseCommand>> {
    const parsed: Interfaces.ParserOutput<
      Interfaces.InferredFlags<(typeof BaseCommand)["flags"] & (typeof BaseCommand)["baseFlags"]>,
      Interfaces.InferredArgs<(typeof BaseCommand)["args"]>
    > = await this.parseOnce();
    const flags = byName(parsed.flags);
    const source = await this.sourceOf(
      flags,
      resolveCwd(typeof flags.cwd === "string" ? flags.cwd : undefined),
    );
    await this.toMeta(flags, {
      ...this.command.meta,
      ...(source === undefined ? {} : { source }),
    });
    // oclif types a parse against `BaseCommand` by its base flags alone, so
    // the names and types a command declared for itself are known only to
    // `execute`, which {@link Admitted} states for the concrete command.
    return {
      flags,
      args: byName(parsed.args),
      argv: parsed.argv.map(String),
    } as Admitted<typeof BaseCommand>;
  }

  /**
   * oclif runs this before `run`. The user agent goes in here, ahead of flag
   * parsing and server resolution, so every request the command makes carries
   * it — including the local-server health probes {@link toMeta} can trigger.
   * (oclif's own `config.userAgent` only feeds its `http-call` client, which the
   * CLI does not use.)
   */
  protected override async init(): Promise<void> {
    // A fresh invocation starts with no warnings, even when an earlier one in
    // the same process (a test run, say) failed before emitting its own.
    warnings.take();
    await super.init();
    this.listenForInterrupt();
    Runtime.current().useUserAgent(Runtime.userAgentFor(this.config.version));
  }

  /**
   * What this run puts back on every command it suggests: how its command line
   * chose the project (`--cwd`, `--env` or `--env-file`, `--server`), as typed.
   * Only what was typed is carried: a name that came from `ZITADEL_ENV` or a
   * platform signal needs none, because the next run in the same environment
   * inherits it. The renderer gives the environment half only to a target
   * that takes it.
   *
   * @returns The scope, holding only what the command line named.
   */
  protected scope(): Scope {
    return this.typedScope;
  }

  /**
   * A command this run suggests next, checked against the command it names
   * and rendered with this run's {@link scope} ({@link RunSuggestions}). It is
   * a property, so it can be handed to a helper as it is.
   *
   * @param next - The target and its arguments and flags, by the names code reads them.
   * @returns The command, in the public `npx @zitadel/cli@<version>` form.
   * @throws {Error} When the target is no command this CLI loaded.
   */
  protected readonly suggest: Suggest = (next: Suggested | LooseNext) => {
    return this.suggestions.render(next, this.scope());
  };

  /**
   * {@link suggest} aimed at a scope of its own rather than this run's, such as
   * the environment a command just created, or run as another release.
   *
   * @param scope - What every suggestion is aimed at, in place of this run's.
   * @param cliVersion - The release the suggestions run as.
   * @returns The renderer.
   */
  protected suggestWith(scope: Scope, cliVersion: string = this.cliVersion): Suggest {
    return this.suggestions.aimedAt(scope, cliVersion);
  }

  /**
   * A command this run rendered, as the words after the CLI (`next_args`).
   *
   * @param command - A command {@link suggest}, {@link again} or {@link rerun} rendered.
   * @returns Its words.
   * @throws {Error} When this run did not render `command`.
   */
  protected argsOf(command: SuggestedCommand): readonly string[] {
    return this.suggestions.argsOf(command);
  }

  /**
   * This run again, `without` some of its flags and `with` others, as a dry
   * run's real command or a refusal's `--force` retry suggests it. `id` must be
   * the command that is running, so what changes is checked against it.
   *
   * @param id - The running command, as oclif names it.
   * @param change - The flags to drop and to add, by the names code reads them.
   * @returns The command.
   * @throws {Error} When `id` is not the running command.
   */
  protected readonly again: Again = async (id, change) => {
    // A class run on its own, outside the command table, has no id oclif
    // knows to compare: the one named stands in for it.
    if (this.id !== undefined && this.config.findCommand(this.id) !== undefined && id !== this.id) {
      throw new Error(`${this.id} cannot suggest itself as ${id}`);
    }

    return this.rebuilt({ without: change.without, with: change.with }, id);
  };

  /**
   * {@link again} for code that does not know which command it runs in, such
   * as a mixin. It names the flags it relies on as `Defs`, which is never
   * inferred, so the change is checked against them when it is compiled; the
   * run then refuses one the command does not declare
   * ({@link RunSuggestions.rerun}).
   *
   * @typeParam Defs - The flags the rerun relies on the command declaring, as
   *   a command declares them. Nothing infers it, so a caller names it.
   * @param change - What the rerun changes, by the names code reads them.
   * @returns The command.
   * @throws {Error} When the change names a flag the running command does not
   *   declare.
   * @example
   * await this.rerun<{ force: Interfaces.BooleanFlag<boolean> }>({ with: { force: true } });
   */
  protected async rerun<Defs extends object = Record<never, never>>(
    change: RerunOf<NoInfer<Defs>> = {},
  ): Promise<SuggestedCommand> {
    return this.rebuilt(change);
  }

  /**
   * Refuses this run unless its command declares each of `names`: the flags
   * that code shared by many commands, such as a mixin, sets or leaves out
   * when it reruns one, and cannot see declared. That code calls this where
   * it starts, so a command without one fails on every run of it, not only on
   * the rare one that builds the rerun.
   *
   * @typeParam Defs - The flags relied on, as a command declares them.
   * @param names - The flags, by the names code reads them.
   * @throws {Error} When the command does not declare one of them.
   */
  protected relyOn<Defs extends object>(...names: readonly FlagNameOf<{ flags: Defs }>[]): void {
    const declared = { ...this.command.baseFlags, ...this.command.flags };
    const lacking = names.filter((name) => {
      return !(spelled(name) in declared);
    });
    if (lacking.length > 0) {
      throw new Error(
        `${this.id ?? ""} declares no --${lacking.map(spelled).join(", --")}, which it reruns with`,
      );
    }
  }

  /**
   * This run again with `change`, its flags only names by now: the one
   * implementation {@link again}, {@link rerun} and {@link realRun} share.
   *
   * @param change - What the rerun changes.
   * @param id - The running command; this run's own id unless {@link again}
   *   names it.
   * @returns The command.
   * @throws {Error} When the change names a flag the running command does not
   *   declare.
   */
  private async rebuilt(change: Rerun, id: string = this.id ?? ""): Promise<SuggestedCommand> {
    const { raw } = await this.parseOnce();
    // Read off the running class itself rather than looked up by id: this run
    // is the command, whatever table it was loaded from.
    const target = declaredOf(id, {
      flags: {
        ...this.command.baseFlags,
        ...this.command.flags,
        ...(this.command.enableJsonFlag ? { json: { type: "boolean" as const } } : {}),
      },
      args: this.command.args ?? {},
    });

    return this.suggestions.rerun(id, target, raw, change);
  }

  /**
   * The command a dry run offers next: this run again with `--dry-run` taken
   * off, every typed flag kept but the ones that only say how it answered.
   *
   * @returns The command.
   */
  protected async realRun(): Promise<SuggestedCommand> {
    return this.rebuilt({ without: ["dryRun"] });
  }

  /**
   * Says the text a publish step produced for a person, such as the diff a
   * deploy is about to make. It goes through the narration, so a command that
   * draws a chain draws it inside the chain, and `--json` silences it.
   */
  protected narrate(notices: readonly string[]): void {
    for (const notice of notices) {
      log.plain(notice.replace(/\n+$/, ""));
    }
  }

  /**
   * What this command knows about its run, as facts, for whoever reports on
   * it. A command or a layer between adds its own and keeps what the layers
   * below it say.
   *
   * @returns The facts, by name: enums, booleans, counts or lists of enums.
   */
  protected describe(): Facts {
    return {};
  }

  /**
   * The failure this run ended with, once it has, as it is shown and exits.
   */
  protected failed: ZitadelError | undefined;

  /**
   * Builds {@link GlobalOptions} from parsed flags and stores the result on
   * `this.meta` so the error handler can render a complete envelope. The server
   * `source` is what the command's {@link sourceOf} names, or else what
   * {@link resolveServer} makes of `--server`: nothing for a command that takes
   * no server, the flag or the cloud default for one that does (`ServerCommand`),
   * and the environment's for one that reads it (`EnvironmentCommand`). The
   * flags are read as code reads them, whether
   * they arrive from {@link admit} or straight from `parse`.
   */
  protected async toMeta(
    given: Record<string, unknown>,
    options: MetaOptions = {},
  ): Promise<GlobalOptions> {
    const flags = byName(given);
    const cwd = resolveCwd(typeof flags.cwd === "string" ? flags.cwd : undefined);
    this.typedScope = typedScopeOf({
      cwd: flags.cwd,
      env: flags.env,
      envFile: flags.envFile,
      server: this.serverFlagOf(flags),
    });
    const serverFlag = this.serverFlagOf(flags);
    const source = await this.serverOf(cwd, serverFlag, options);
    const json = this.jsonEnabled();
    const isTTY = isTerminal();
    const debug = Boolean(flags.debug);
    // `--no-color` (or the `NO_COLOR` env) turns colour off; both reach this
    // process as `NO_COLOR` via `bin/run.js`, and `--no-color` also unsets the
    // parsed `color` flag. The flag's value is the source of truth here so that
    // a programmatic `run()` (tests) honours it without the entry-point shim.
    const useColor =
      flags.color !== false && !process.env[NO_COLOR.name] && forcedColour(process.env) !== false;
    // Colour is about where the output goes, so it asks stdout alone. `isTTY`
    // is about whether a person can be asked something and needs stdin too: a
    // run with its stdin redirected still writes to a terminal that reads
    // colour.
    const colored =
      useColor &&
      (forcedColour(process.env) === true ||
        (Boolean(process.stdout.isTTY) && process.env.TERM !== "dumb"));
    this.meta = {
      cwd,
      nonInteractive: Boolean(flags.nonInteractive) || !isTTY || json,
      dryRun: Boolean(flags.dryRun),
      force: Boolean(flags.force),
      command: this.id ?? "(default)",
      cliVersion: this.config.version,
      source: source.value,
      serverFlag,
      verbose: Boolean(flags.verbose),
      debug,
      env: process.env,
      isTTY,
    };
    Output.settle({
      json,
      color: !json && colored,
    });
    this.ui = new Ui(
      {
        interactive: !this.meta.nonInteractive,
        force: this.meta.force,
      },
      this.presentation(),
    );
    this.ui.describe(
      (this.constructor as typeof BaseCommand).heading ??
        `zitadel ${(this.id ?? "").replaceAll(":", " ")}`.trim(),
    );
    this.ui.bridgeNarration({
      debug,
      silent: json,
    });
    this.skillsOffered =
      this.summarises() && !this.meta.dryRun
        ? await new Skills(process.env, !this.meta.nonInteractive).eligible()
        : false;
    this.settled = true;
    return this.meta;
  }

  /**
   * The server a run is about, as {@link toMeta} and a failure that came before
   * it both state it: the one a command's own `source` names, or else what
   * {@link resolveServer} makes of `--server`.
   */
  private async serverOf(
    cwd: string,
    serverFlag: string | undefined,
    options: MetaOptions,
  ): Promise<{ value: string }> {
    if (options.source === undefined) {
      return { value: await this.resolveServer(cwd, serverFlag) };
    } else {
      return { value: options.source };
    }
  }

  /**
   * The server of a run whose command names none of its own: nothing, for a
   * command that takes no server. A command that takes one resolves `--server`
   * here (`ServerCommand`).
   *
   * @param _cwd - The directory the run addresses.
   * @param _serverFlag - What `--server` was given, if it was.
   * @returns The run's server.
   */
  protected async resolveServer(_cwd: string, _serverFlag: string | undefined): Promise<string> {
    return "";
  }

  /**
   * What `--server` was given as, read from the parsed flags: a command that
   * takes the flag says (`ServerCommand`), and one that does not has none.
   *
   * @param flags - The parsed flags, by name.
   * @returns The flag as it was typed, if it was.
   */
  protected serverFlagOf(_flags: Record<string, unknown>): string | undefined {
    return undefined;
  }

  /**
   * What `--server` was given as on the command line, for a failure that came
   * before the flags were parsed.
   *
   * @returns The flag as it was typed, if it was.
   */
  protected serverFlagFromArgv(): string | undefined {
    return undefined;
  }

  /**
   * What an option has on the command line, as `--name value` or `--name=value`,
   * for a command that reads one of its own flags before any is parsed.
   *
   * @param names - The spellings of the option.
   * @returns The value, if it was typed.
   */
  protected argvFlag(...names: string[]): string | undefined {
    return argvValue(this.argv, ...names);
  }

  /**
   * What the command line says of the run before any flag was parsed, for a
   * failure that came from parsing: the directory and server it named, so the
   * failure's envelope names the same `source` and its follow-ups carry the
   * same `--cwd` as one raised later. A value that cannot be read is left as
   * the failure's own to report.
   */
  private async metaFromArgv(meta: GlobalOptions): Promise<GlobalOptions> {
    const typed = argvValue(this.argv, "--cwd", "-c");
    const serverFlag = this.serverFlagFromArgv();
    this.typedScope = typedScopeOf({
      cwd: typed,
      env: argvValue(this.argv, "--env", "-e"),
      envFile: argvValue(this.argv, "--env-file"),
      server: serverFlag,
    });
    const cwd = resolveCwd(typed);
    try {
      const source = await this.serverOf(cwd, serverFlag, this.command.meta);
      return { ...meta, cwd, serverFlag, source: source.value };
    } catch {
      return { ...meta, cwd, serverFlag };
    }
  }

  /**
   * Final step of every command: hands the
   * result to a {@link Presenter}, which writes it for the reader the run has
   * and returns the envelope oclif serialises under `--json`.
   *
   * @param result - What the command returned.
   * @returns The envelope.
   */
  protected emit(result: CommandResult): JsonEnvelope {
    const normalized = normalizeCommandResult(result, this.meta);
    return new Presenter({
      meta: this.meta,
      ui: this.ui,
      version: this.config.version,
      wizard: (this.constructor as typeof BaseCommand).wizard === true,
      skillsOffered: this.skillsOffered,
      dryRun: this.dryRun,
      suggest: this.suggest,
      log: (text) => {
        this.log(text);
      },
      logAside: (text) => {
        this.logAside(text);
      },
    }).present(normalized);
  }

  /** Which of the two shapes this command draws. See {@link BaseCommand.wizard}. */
  private presentation(): Presentation {
    return (this.constructor as typeof BaseCommand).wizard === true ? "wizard" : "plain";
  }

  /** Whether this command ends on a summary box, which only a wizard does. */
  private summarises(): boolean {
    return this.presentation() === "wizard";
  }

  /**
   * Write the envelope as JSON, with what a terminal would act on spelled out.
   *
   * `JSON.stringify` spells out the C0 controls because the grammar requires
   * it, but writes `DEL`, the C1 controls and the bidi and separator characters
   * as themselves, and a reader printing the output hands those to their
   * terminal. Spelling them out in the serialised text leaves what a reader
   * parses back identical and what they print safe.
   *
   * @param json - The envelope to write.
   */
  protected override logJson(json: unknown): void {
    ux.stdout(
      escapeJsonControlCharacters(
        ux.colorizeJson(json, {
          pretty: true,
          theme: this.config.theme?.json,
        }),
      ),
    );
  }

  /**
   * Writes to stderr. Color is decided by stdout's terminal, so with only stderr
   * redirected, as in `2> error.log`, the codes are taken back out.
   */
  private logAside(text: string): void {
    this.logToStderr(
      process.stderr.isTTY || forcedColour(process.env) === true
        ? text
        : stripVTControlCharacters(text),
    );
  }

  /**
   * A failure of the local server with the advice for it: the server package
   * names what failed, and this says what to do about it. Where the failing
   * record or file sits in another folder than this run's, the commands it
   * suggests carry that folder's `--cwd`, so they fix the right one.
   *
   * @param error - What the command threw.
   * @param cwd - The folder this run acts on, from the settled meta.
   * @returns The error with its hint and next commands, or the error as it was.
   */
  private advise(error: unknown, cwd: string): unknown {
    if (!(error instanceof LocalServerError)) {
      return error;
    }
    const advice: LocalServerAdvice = LOCAL_SERVER_ADVICE[error.kind];
    const details: Record<string, unknown> = {};
    if (isObject(error.details)) {
      Object.assign(details, error.details);
    }
    const { directory } = details;
    const elsewhere = typeof directory === "string" && resolve(directory) !== resolve(cwd);
    const removal: Suggested[] = [];
    if (error.kind === "admin-malformed" && typeof details.path === "string") {
      removal.push(shellCommand("rm", Cmd.quote(details.path)));
    }
    const retargeted: string[][] = [];
    const next = (advice.next ?? []).map((step) => {
      if (elsewhere && typeof step === "object" && (step.id === "reset" || step.id === "start")) {
        const flags = { ...("flags" in step ? step.flags : undefined), cwd: directory };
        retargeted.push([
          step.id,
          ...Object.entries(flags).flatMap(([name, value]) => {
            if (value === true) {
              return [`--${name}`];
            } else {
              return [`--${name}`, String(value)];
            }
          }),
        ]);
        return { ...step, flags } as Suggested;
      } else {
        return step;
      }
    });
    const quoted = { ...details };
    for (const key of ["directory", "path"]) {
      const value = details[key];
      if (typeof value === "string") {
        quoted[key] = Cmd.quote(value);
      }
    }
    const hint = [elsewhere && advice.elsewhere, advice.hint].find((text) => {
      return typeof text === "string";
    });
    const visible = Object.fromEntries(
      Object.entries(details).filter(([key]) => {
        return key !== "directory";
      }),
    );
    if (retargeted.length > 0) {
      visible.suggested_args = retargeted;
    }
    return new ZitadelError(error.code, error.message, {
      hint: interpolate(hint ?? advice.hint, quoted),
      nextCommands: [...removal, ...next],
      details: error.details && visible,
    });
  }

  /**
   * Renders any thrown error as the failure envelope and exits with its code.
   * A flag-parse error fires before {@link toMeta} runs, so the local `meta`
   * here refreshes `command` from the now-resolved command id to keep the
   * envelope's `command` field accurate. The failure the run ends with is kept in
   * {@link failed}.
   */
  protected override async catch(error: unknown): Promise<never> {
    const known = this.settled ? this.meta : await this.metaFromArgv(this.meta);
    const meta: GlobalOptions = { ...known, command: this.id ?? known.command };
    const reason: unknown = this.signal.reason;
    const cancelled =
      this.signal.aborted && reason instanceof ZitadelError && reason.code === "E_CANCELLED";
    // A command line oclif refused may name no command, and then the CLI's
    // own help is the one to read.
    const help =
      this.config.findCommand(meta.command) === undefined
        ? commandOf(["--help"], meta.cliVersion)
        : this.suggest(helpOf(meta.command));
    const zitadelError = presentedFailure(
      this.suggestions.renderedFailure(
        cancelled ? reason : toZitadelError(this.advise(error, meta.cwd)),
      ),
      help,
    );
    this.meta = meta;
    this.failed = zitadelError;
    if (this.jsonEnabled()) {
      this.logJson(withWarnings(toErrorEnvelope(zitadelError, meta), warnings.take()));
    } else if (zitadelError.code === "E_CANCELLED") {
      this.ui.stop(zitadelError);
    } else {
      // A step left running must not keep drawing under the failure.
      DrawnSpinner.clearAll();
      // An open chain is closed on its own line, but the failure goes to stderr
      // like every other failure, so `2>errors.log` keeps a wizard's too.
      if (this.ui.interactive && this.ui.opened) {
        this.ui.finish({
          title: "Failed",
          sections: [],
          failed: true,
        });
      }
      this.logAside(this.ui.written(failureSummary(zitadelError, meta)).replace(/\n+$/, ""));
    }
    return this.exit(zitadelError.exitCode);
  }

  /**
   * oclif runs this after `run`/`catch` on every path, so whatever a run left
   * open is closed here.
   */
  protected override async finally(error: Error | undefined): Promise<void> {
    this.stopListeningForInterrupt();
    this.ui.releaseNarration();
    await super.finally(error);
  }

  /**
   * Context used before {@link toMeta} runs, so an error thrown during flag
   * parsing still renders a complete envelope. Version comes from oclif's
   * resolved {@link Command.config}.
   */
  private fallbackMeta(): GlobalOptions {
    return {
      cwd: resolveCwd(undefined),
      nonInteractive: false,
      dryRun: false,
      force: false,
      command: "(default)",
      cliVersion: this.config.version,
      source: "",
      verbose: false,
      debug: false,
      env: process.env,
      isTTY: isTerminal(),
    };
  }
}

/**
 * The value an option has on the command line, as `--name value` or
 * `--name=value`, for a failure that came before oclif had parsed any.
 */
function argvValue(argv: readonly string[], ...names: string[]): string | undefined {
  for (const [index, word] of argv.entries()) {
    for (const name of names) {
      if (word === name) {
        return argv[index + 1];
      }
      if (word.startsWith(`${name}=`)) {
        return word.slice(name.length + 1);
      }
    }
  }

  return undefined;
}

/** Whether a person is at the terminal on both ends: stdout and stdin. */
function isTerminal(): boolean {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

/**
 * oclif rewrites the message of an error a flag's `parse` threw, prefixing the
 * flag and appending its own help line. A refusal reads the same wherever it
 * was raised, so the message it was given is put back — read from the error
 * itself rather than matched out of oclif's wording, which is not ours.
 */
function asRaised(error: unknown): unknown {
  if (!(error instanceof ZitadelError) || error.message === error.raised) {
    return error;
  }

  return new ZitadelError(error.code, error.raised, {
    hint: error.hint,
    nextCommands: error.nextCommands,
    details: error.details,
  });
}

/**
 * A failure's follow-ups, each rendered by `renderedFailure` before the failure
 * is reported.
 *
 * @param error - The failure, as the command's failure handler left it.
 * @returns Its follow-ups.
 * @throws {Error} When one was left for a run to render, which is a defect in the handler.
 */
function renderedCommands(error: ZitadelError): SuggestedCommand[] {
  return (error.nextCommands ?? []).map((next) => {
    if (isSuggestion(next)) {
      throw new Error(`${next.id} was reported without being rendered`);
    }
    return next;
  });
}

/** Builds the failure envelope from a {@link ZitadelError} and the invocation metadata. */
function toErrorEnvelope(error: ZitadelError, meta: GlobalOptions): ErrorEnvelope {
  return {
    status: "error",
    cli_version: meta.cliVersion,
    command: meta.command,
    source: meta.source,
    code: error.code,
    message: error.message,
    hint: error.hint === undefined ? undefined : Spelling.at(meta.cliVersion).spellOut(error.hint),
    next_commands: error.nextCommands === undefined ? undefined : renderedCommands(error),
    details: error.details,
  };
}

/**
 * A failure as the one ending every failure is shown as: the coded sentence, an
 * optional hint, and any commands to run next. It is the only place a failure
 * becomes words for a person, so there is one grammar however the failure
 * arose — the CLI's own refusal, the platform's, a socket that never answered,
 * or oclif refusing the command line.
 */
function failureSummary(error: ZitadelError, meta: GlobalOptions): Summary {
  // A failure names what it failed on — an origin, an id, a value — so the
  // message and the hint carry what the server answered as readily as a
  // success's rendering does, and are spelled out here for the same reason.
  // The envelope keeps them as they came, so a reader parses the real text.
  // Only the label is coloured, so there is nothing for the spelling to undo.
  const commands = renderedCommands(error);
  return {
    title: `Error: ${escapeControlCharacters(Spelling.at(meta.cliVersion).spellOut(error.message))} (${error.code})`,
    sections: [],
    lines: error.hint
      ? [escapeControlCharacters(Spelling.at(meta.cliVersion).spellOut(error.hint))]
      : [],
    ...(commands.length === 0
      ? {}
      : {
          next: [
            {
              text: NEXT_LABEL,
              command: commands.join("\n"),
            },
          ],
          boxed: true,
        }),
    failed: true,
  };
}

/**
 * What `FORCE_COLOR` says about colour: on for any value but `0` and `false`
 * (in any case), off for those two, and nothing when it is unset or empty.
 *
 * @param env - The environment the run reads.
 * @returns True when colour is forced on, false when forced off, and
 * `undefined` when the variable says nothing.
 */
function forcedColour(env: NodeJS.ProcessEnv): boolean | undefined {
  const value = (env[FORCE_COLOR.name] ?? "").toLowerCase();
  if (value === "") {
    return undefined;
  }

  return !["0", "false"].includes(value);
}

/**
 * A failure as every rendering of it states it. oclif refuses a command line
 * in its own words, so the sentence is its first line and the step is the
 * command's help, in the envelope and on the terminal alike.
 *
 * @param error - The failure.
 * @param help - The help of the command the run named.
 * @returns The failure as it is reported.
 */
function presentedFailure(error: ZitadelError, help: SuggestedCommand): ZitadelError {
  const { sentence, misuse } = failureText(error.message);
  if (!misuse) {
    return error;
  }

  return new ZitadelError(error.code, sentence, {
    hint: error.hint,
    nextCommands: error.nextCommands?.length ? error.nextCommands : [help],
  });
}

/** The last step of every box: where to find every command. */
