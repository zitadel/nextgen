import { stripVTControlCharacters } from "node:util";

import { Command, Flags, type Interfaces, ux } from "@oclif/core";
import type { ReadonlyDeep } from "type-fest";

import { byName, type ByName } from "@/lib/names";
import { nonBlankString } from "./flags";
import { inputFlag } from "./input";
import { Documented } from "./documented";
import { Failure } from "./failure";
import { Interruptible } from "./interruptible";
import { Loggable } from "./loggable";
import { Output, warnings } from "@/lib/ui";

import { toZitadelError, ZitadelError } from "@/lib/errors";
import { resolveCwd } from "@/lib/paths";
import {
  commandOf,
  declaredOf,
  helpOf,
  type Again,
  type LooseNext,
  type Scope,
  type Suggest,
  type Suggested,
  type SuggestedCommand,
} from "@/lib/suggestion";
import { Runtime } from "@/lib/runtime";
import { Skills } from "@/lib/skills";
import type { Presentation } from "@/lib/ui";
import { Ui } from "@/lib/ui";
import { DrawnSpinner } from "@/lib/ui/spinner";
import { escapeJsonControlCharacters } from "@/lib/terminal-text";
import type { RELATIONS } from "@/lib/suggestion/relations";
import { type Rerun, type RerunOf, RunSuggestions } from "@/lib/suggestion/run";
import { normalizeCommandResult, Presenter, withWarnings } from "./presenter";
import { type CommandFacts, FORCE_COLOR, NO_COLOR, RunContext } from "./run-context";
import type { CommandResult, FlagVariable, GlobalOptions, JsonEnvelope } from "./types";

/** The variable the server is named by when `--server` is not given. */
const SERVER: FlagVariable = {
  name: "ZITADEL_API_BASE",
  flag: "server",
  description: "The server URL, or `local`, as `--server` takes it.",
  precedence: "`--server` wins over it, and it wins over `server` in `zitadel.json`.",
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
export type Admitted<C extends typeof BaseCommand> = ReadonlyDeep<{
  flags: ByName<Interfaces.InferredFlags<Omit<C["flags"], typeof RELATIONS> & C["baseFlags"]>>;
  args: ByName<Interfaces.InferredArgs<C["args"]>>;
  argv: string[];
}>;

/**
 * Base class for every oclif command. Owns the global flags, builds the
 * {@link GlobalOptions} context (including server `source` resolution) the
 * subclass's `run` reads via `this.meta`, and turns the {@link CommandResult}
 * it returns into the JSON envelope (oclif serialises it natively in `--json`
 * mode) or human-facing text. Errors are translated into the failure envelope
 * and the mapped process exit code. Subclasses stay thin: parse flags, call
 * {@link toMeta}, do their work, and return the result, which the base emits. The agent
 * contract (ADR 004) is preserved — oclif only replaces parsing, dispatch,
 * help, and JSON emission.
 */
export abstract class BaseCommand extends Loggable(Documented(Interruptible(Command))) {
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
   *
   * `-v` is the short form curl, ssh and wget bind to verbosity, so an agent
   * reaches for it by reflex; the root `--version` carries no short form, so
   * there is nothing to collide with. `--color` and `--no-color` are declared
   * so oclif accepts them rather than refusing them as unknown; the colour
   * decision itself is applied in `bin/run.js`, which sets NO_COLOR and
   * FORCE_COLOR before the libraries load, and honoured here. picocolors reads
   * `--no-color` from argv on its own; the environment covers the rest.
   */
  static override baseFlags = {
    cwd: nonBlankString({ char: "c", description: "Project directory to operate on." }),
    input: inputFlag,
    "non-interactive": Flags.boolean({
      char: "n",
      description: "Disable prompts. Required when scripting or running as an agent.",
    }),
    verbose: Flags.boolean({ char: "v", description: "Verbose logging." }),
    debug: Flags.boolean({ description: "Debug logging." }),
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
  protected meta: GlobalOptions = RunContext.fallback(this.config.version);

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
   * The one lifecycle every command shares: let the command answer before the
   * run is admitted, if it does, parse the flags, resolve the
   * context, and only then hand the work to {@link execute}. A flag or
   * argument reaching `execute` has already been refused if it was not one the
   * command accepts; anything else a command needs settled, it settles on
   * `execute`'s first lines.
   */
  async run(): Promise<JsonEnvelope> {
    const early = await this.answeredEarly();

    return this.emit(early ?? (await this.execute(await this.admit())));
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

  /**
   * The result of a command that answers before its run is admitted, because
   * what it answers needs neither a resolved server nor its own arguments
   * (`api help`). Most commands answer nothing here and go on to {@link execute}.
   *
   * @returns The result, or `undefined` for a command that does its work in {@link execute}.
   */
  protected answeredEarly(): Promise<CommandResult | undefined> {
    return Promise.resolve(undefined);
  }

  /** The command's work, which receives the flags and arguments it accepts. */
  protected abstract execute(input: Admitted<typeof BaseCommand>): Promise<CommandResult>;

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

  /**
   * The parsed command line, handed on as the concrete command's own. oclif
   * types a parse against `BaseCommand` by its base flags alone, so the names
   * and types a command declared for itself are known only to {@link execute},
   * which {@link Admitted} states for the concrete command.
   *
   * @returns The flags, arguments and argv of the run.
   */
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
   * CLI does not use.) A fresh invocation starts with no warnings, even when an
   * earlier one in the same process (a test run, say) failed before emitting
   * its own.
   */
  protected override async init(): Promise<void> {
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
   * the command that is running, so what changes is checked against it. A
   * class run on its own, outside the command table, has no id oclif knows to
   * compare, so the one named stands in for it.
   *
   * @param id - The running command, as oclif names it.
   * @param change - The flags to drop and to add, by the names code reads them.
   * @returns The command.
   * @throws {Error} When `id` is not the running command.
   */
  protected readonly again: Again = async (id, change) => {
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
   * This run again with `change`, its flags only names by now: the one
   * implementation {@link again}, {@link rerun} and {@link realRun} share. The
   * flags are read off the running class itself rather than looked up by id:
   * this run is the command, whatever table it was loaded from.
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
   * Says the text a publish step produced for a person, such as the diff a
   * deploy is about to make. It goes through the narration, so a command that
   * draws a chain draws it inside the chain, and `--json` silences it.
   */
  protected narrate(notices: readonly string[]): void {
    for (const notice of notices) {
      this.info(notice.replace(/\n+$/, ""));
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
   * What this command says of itself for {@link RunContext}: its id, the
   * server it names or resolves, and whether it takes `--server` at all, which
   * only a command built on `ServerCommand` declares.
   *
   * @param source - The server the command fixes beforehand, if it does.
   * @returns What the context reads.
   */
  private contextOf(source: string | undefined): CommandFacts {
    return {
      id: this.id,
      version: this.config.version,
      source,
      takesServer: "server" in this.command.baseFlags,
      resolveServer: (cwd, serverFlag) => {
        return this.resolveServer(cwd, serverFlag);
      },
    };
  }

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
    const json = this.jsonEnabled();
    const context = await RunContext.from(flags, this.contextOf(options.source), json);
    this.typedScope = context.scope;
    this.meta = context.meta;
    Output.settle({
      json,
      color: !json && context.colored,
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
    this.ui.printLogs({
      debug: this.meta.debug,
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
      dryRun: this.meta.dryRun,
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
      process.stderr.isTTY || RunContext.forcedColour(process.env) === true
        ? text
        : stripVTControlCharacters(text),
    );
  }

  /**
   * Renders any thrown error as the failure envelope and exits with its code.
   * A flag-parse error fires before {@link toMeta} runs, so the local `meta`
   * here refreshes `command` from the now-resolved command id to keep the
   * envelope's `command` field accurate. The failure the run ends with is kept in
   * {@link failed}.
   *
   * A command line oclif refused may name no command, and then the CLI's own
   * help is the one to read. A step left running must not keep drawing under
   * the failure. An open chain is closed on its own line, but the failure goes
   * to stderr like every other failure, so `2>errors.log` keeps a wizard's too.
   */
  protected override async catch(error: unknown): Promise<never> {
    const early = this.settled
      ? undefined
      : await RunContext.fromArgv(this.meta, this.argv, this.contextOf(this.command.meta.source));
    if (early) {
      this.typedScope = early.scope;
    }
    const known = early?.meta ?? this.meta;
    const meta: GlobalOptions = { ...known, command: this.id ?? known.command };
    const reason: unknown = this.signal.reason;
    const cancelled =
      this.signal.aborted && reason instanceof ZitadelError && reason.code === "E_CANCELLED";
    const help =
      this.config.findCommand(meta.command) === undefined
        ? commandOf(["--help"], meta.cliVersion)
        : this.suggest(helpOf(meta.command));
    const failure = new Failure(
      this.suggestions.renderedFailure(
        cancelled ? reason : toZitadelError(Failure.advised(error, meta.cwd)),
      ),
      meta,
      help,
    );
    this.meta = meta;
    this.failed = failure.error;
    if (this.jsonEnabled()) {
      this.logJson(withWarnings(failure.envelope(), warnings.take()));
    } else if (failure.error.code === "E_CANCELLED") {
      this.ui.stop(failure.error);
    } else {
      DrawnSpinner.clearAll();
      if (this.ui.interactive && this.ui.opened) {
        this.ui.finish({
          title: "Failed",
          sections: [],
          failed: true,
        });
      }
      this.logAside(this.ui.written(failure.summary()).replace(/\n+$/, ""));
    }
    return this.exit(failure.error.exitCode);
  }

  /**
   * oclif runs this after `run`/`catch` on every path, so whatever a run left
   * open is closed here.
   */
  protected override async finally(error: Error | undefined): Promise<void> {
    this.stopListeningForInterrupt();
    this.ui.stopPrintingLogs();
    await super.finally(error);
  }
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

/** The last step of every box: where to find every command. */
