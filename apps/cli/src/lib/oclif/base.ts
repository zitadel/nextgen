import { randomUUID } from "node:crypto";
import { stripVTControlCharacters } from "node:util";

import { Command, Flags, type Interfaces, ux } from "@oclif/core";

import { byName, type ByName } from "./names";
import { nonBlankString, serverFlag } from "./flags";
import { Interruptible } from "./interruptible";
import { log } from "@/lib/log";

import { failureText, toZitadelError, ZitadelError } from "@/lib/errors";
import { isObject } from "@/lib/json";
import { type LocalServers, PsLocalServers } from "@/lib/local-server/processes";
import { resolveCwd } from "@/lib/paths";
import { normalizePublicCliCommands, publicCliCommand, spellOutCommands } from "@/lib/public-cli";
import { hostUnlessDefault, resolveServer, SERVER_VARIABLE } from "@/lib/server";
import { statusColor } from "@/lib/style";
import { type SuggestedCommand, unscopedCommand } from "@/lib/suggestion";
import { type Properties, Telemetry, type TelemetryDeps } from "@/lib/telemetry";
import { DO_NOT_TRACK, ZITADEL_TELEMETRY } from "@/lib/telemetry/consent";
import { processUserAgent, useUserAgent } from "@/lib/user-agent";
import { claimSkills, eligibleForSkills } from "@/lib/skills-hint";
import type { Presentation, Summary } from "@/lib/ui";
import { NEXT_LABEL, textOf } from "@/lib/ui/summary";
import { Ui } from "@/lib/ui";
import { stripColumnMarks } from "@/lib/ui/layout";
import { takeReportedWarnings } from "@/lib/warnings";
import {
  CLI_COMMAND_COMPLETED,
  CLI_COMMAND_FAILED,
  CLI_COMMAND_STARTED,
  commandEventProperties,
  deviceProfileProperties,
  FIRST_RUN_NOTICE,
  vercelEventKeys,
} from "./command-telemetry";
import type { CommandGroup } from "./groups";
import { escapeControlCharacters, escapeJsonControlCharacters } from "@/lib/terminal-text";
import { type NextSteps, nextStepsData, renderNextSteps, stepsOf } from "./next-steps";
import { painted } from "./rendering";
import type {
  CommandResult,
  ErrorEnvelope,
  EnvelopeMeta,
  FlagVariable,
  GlobalOptions,
  JsonEnvelope,
  SkippedEnvelope,
} from "./types";
import { Cmd } from "@/lib/cmd";

/**
 * The colour variables, which `bin/run.js` sets from `--color`/`--no-color`
 * and the colour libraries read. The libraries agree that off wins.
 */
/** The spellings of the option that names the project directory. */
const CWD_OPTIONS: readonly string[] = ["--cwd", "-c"];

const NO_COLOR: FlagVariable = {
  name: "NO_COLOR",
  flag: "color",
  description: "A non-empty value turns color off, as `--no-color` does (https://no-color.org).",
  precedence: "Turns color off even with `--color` or `FORCE_COLOR`.",
};
const FORCE_COLOR: FlagVariable = {
  name: "FORCE_COLOR",
  flag: "color",
  description: "Turns color on where it would be off, such as in a pipe, as `--color` does.",
  precedence: "`--no-color` and `NO_COLOR` win over it.",
};

/**
 * The environment variables that set what a global flag sets, each declared
 * beside the code that reads it. The CLI reference lists them beside the
 * flags (`./reference.ts`).
 */
export const FLAG_VARIABLES: readonly FlagVariable[] = [
  SERVER_VARIABLE,
  NO_COLOR,
  FORCE_COLOR,
  DO_NOT_TRACK,
  ZITADEL_TELEMETRY,
];

/** How a command resolves the context it runs in; see {@link BaseCommand.meta}. */
export type MetaOptions = {
  resolveServer?: boolean;
  source?: string;
  environment?: boolean;
};

/**
 * What {@link BaseCommand.execute} receives once a command has been admitted:
 * its parsed flags, arguments and positional words. A flag or argument is read
 * as code reads it (`flags.clientId` for `--client-id`); see `./names`.
 */
export type Admitted<C extends typeof BaseCommand> = Readonly<{
  flags: ByName<Interfaces.InferredFlags<C["flags"] & C["baseFlags"]>>;
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
export abstract class BaseCommand extends Interruptible(Command) {
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
   * *does* something — `variable rm`, `users delete` — is not one of them,
   * however much it asks on the way.
   */
  static wizard?: boolean;

  /**
   * The group the root help lists this command under (see `lib/oclif/groups`).
   * Every product command must set it; the root-help test fails otherwise.
   */
  static group?: CommandGroup;

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
    server: serverFlag({
      char: "s",
      description: "Override the resolved server URL.",
    }),
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
    telemetry: Flags.boolean({
      default: true,
      allowNo: true,
      description: "Send anonymous usage analytics. Disable with --no-telemetry.",
    }),
  };

  /** How the run's context is resolved; see {@link toMeta}. */
  static meta: MetaOptions = {};

  /** Resolved context for the current invocation; set by {@link toMeta}. */
  protected meta: GlobalOptions = this.fallbackMeta();

  /** Everything a command shows a person. Silent until {@link toMeta} finds a terminal. */
  protected ui: Ui = new Ui({ interactive: false, force: false }, this.presentation());

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
   * Whether this run's output is read on a screen rather than by something
   * else. It asks stdout alone, so it answers what to draw — a table, a line
   * naming the server — where {@link isTTY} answers whether anyone can be
   * asked a question.
   */
  protected get isOnScreen(): boolean {
    return Boolean(process.stdout.isTTY);
  }

  /** Whether this run answers in the JSON envelope (`--json`). */
  protected get isJson(): boolean {
    return this.meta.json;
  }

  /**
   * Whether this run's human output is coloured: the one decision every
   * command shares, honouring `--color`/`--no-color`, `NO_COLOR`,
   * `FORCE_COLOR` and a dumb terminal. A JSON run is never coloured.
   */
  protected get isColored(): boolean {
    return this.meta.colored;
  }

  /** The release of the CLI that is running. */
  protected get cliVersion(): string {
    return this.meta.cliVersion;
  }

  /**
   * Anonymous usage analytics for this invocation, created once in
   * {@link toMeta}. Subclasses add command-specific dimensions (framework,
   * counts, `step`, …) via {@link recordTelemetry}; the base class
   * fires the lifecycle events and flushes in {@link finally}.
   */
  protected telemetry?: Telemetry;

  /**
   * Per-command dimensions merged onto each lifecycle event emitted *after* they
   * are recorded — typically `completed`/`failed`, since `started` fires from
   * {@link openTelemetry} before a command body runs. Updated immutably via
   * {@link recordTelemetry} — never mutated in place.
   */
  protected telemetryProps: Readonly<Properties> = Object.freeze({});

  private reading: ReturnType<BaseCommand["parse"]> | undefined;

  /** `--cwd` as typed, carried into the unscoped follow-ups this run suggests. */
  private typedCwd: string | undefined;

  /** Correlates the started/completed pair; minted at instance construction. */
  private readonly telemetryInvocationId = randomUUID();

  /**
   * Wall-clock start used to derive `duration_ms`. Captured at instance
   * construction (before flag parsing and server resolution) so the duration
   * covers the full invocation, even when telemetry is opened late from
   * {@link catch} after an early failure.
   */
  private readonly telemetryStartedAt = Date.now();

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
   * agent is installed by `init` and telemetry opens with the context, so a
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
    takeReportedWarnings();
    await super.init();
    this.listenForInterrupt();
    useUserAgent(processUserAgent(this.config.version));
  }

  /**
   * This run again with `words`, as a destructive command's `--force` retry
   * suggests it: `words` are its arguments as typed, and the directory goes on as
   * {@link suggestUnscoped} puts it. A project command keeps its environment
   * selector instead (`EnvironmentCommand`).
   */
  protected retryCommand(words: readonly string[]): SuggestedCommand {
    const line = Cmd.of(words).without(CWD_OPTIONS);
    return this.suggestUnscoped(line.toString());
  }

  /**
   * The suggestion for a follow-up the framework builds on a command's behalf,
   * such as a list's next page. A command that talks to a project overrides it
   * to keep the run's environment selector, so the framework never has to
   * choose between the scoped and the unscoped form. A command that leaves it
   * alone has no follow-up to suggest, and being asked to is a bug.
   */
  protected suggestFollowUp(_args: string): SuggestedCommand {
    throw new Error(`${this.id ?? "this command"} suggests no follow-up: override suggestFollowUp`);
  }

  /**
   * A `zitadel` command that does not target a project, in the public `npx`
   * form: `setup`, `start`, `doctor`, the local runtime. A command that talks
   * to a project suggests through `EnvironmentCommand.suggest` instead, which
   * keeps the run's environment selector; reaching for this one is the
   * deliberate opt-out.
   */
  protected suggestUnscoped(args: string): SuggestedCommand {
    // A follow-up run from the shell's directory would act on whatever project
    // is there, so the directory this run addressed goes with it.
    return unscopedCommand(
      this.typedCwd === undefined ? args : `${args} ${Cmd.option("--cwd", this.typedCwd)}`,
      this.meta.cliVersion,
    );
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
   * Merge command-specific dimensions into {@link telemetryProps} immutably: a
   * new frozen bag replaces the previous one, so no shared object is ever
   * mutated. `step` advances by re-recording it at each milestone.
   */
  protected recordTelemetry(patch: Properties): void {
    this.telemetryProps = Object.freeze({ ...this.telemetryProps, ...patch });
  }

  /**
   * Builds {@link GlobalOptions} from parsed flags and stores the result on
   * `this.meta` so the error handler can render a complete envelope. The server
   * `source` is `--server` or the cloud default, which is `setup`'s rule; a
   * command that takes its server from the environment extends
   * `EnvironmentCommand`, and one that never talks to a server passes
   * `resolveServer: false`. The flags are read as code reads them, whether
   * they arrive from {@link admit} or straight from `parse`.
   */
  protected async toMeta(
    given: Record<string, unknown>,
    options: MetaOptions = {},
  ): Promise<GlobalOptions> {
    const flags = byName(given);
    const cwd = resolveCwd(typeof flags.cwd === "string" ? flags.cwd : undefined);
    this.typedCwd = typeof flags.cwd === "string" ? flags.cwd : undefined;
    const serverFlag = typeof flags.server === "string" ? flags.server : undefined;
    const source =
      options.resolveServer === false
        ? { value: options.source ?? "", origin: "default" as const }
        : await resolveServer({ cwd, serverFlag });
    const json = this.jsonEnabled();
    const isTTY = Boolean(process.stdout.isTTY && process.stdin.isTTY);
    const verbose = Boolean(flags.verbose);
    const debug = Boolean(flags.debug);
    // `--no-color` (or the `NO_COLOR` env) turns colour off; both reach this
    // process as `NO_COLOR` via `bin/run.js`, and `--no-color` also unsets the
    // parsed `color` flag. The flag's value is the source of truth here so that
    // a programmatic `run()` (tests) honours it without the entry-point shim.
    const useColor = flags.color !== false && !process.env[NO_COLOR.name];
    // Colour is about where the output goes, so it asks stdout alone. `isTTY`
    // is about whether a person can be asked something and needs stdin too: a
    // run with its stdin redirected still writes to a terminal that reads
    // colour.
    const colored =
      useColor &&
      (Boolean(process.env[FORCE_COLOR.name]) ||
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
      verbose,
      debug,
      env: process.env,
      isTTY,
      colored: !json && colored,
      json,
    };
    this.ui = new Ui(
      { interactive: !this.meta.nonInteractive, force: this.meta.force },
      this.presentation(),
    );
    const named = this.constructor as typeof BaseCommand;
    this.ui.describe(named.heading ?? `zitadel ${(this.id ?? "").replaceAll(":", " ")}`.trim());
    this.ui.bridgeNarration({ debug, silent: json });
    this.skillsOffered =
      this.summarises() && !this.meta.dryRun
        ? await eligibleForSkills({
            env: process.env,
            interactive: !this.meta.nonInteractive,
            cliVersion: this.config.version,
          })
        : false;
    this.openTelemetry(typeof flags.telemetry === "boolean" ? flags.telemetry : undefined);
    return this.meta;
  }

  /**
   * Create telemetry once per invocation and open the lifecycle (started event +
   * anonymous profile + first-run notice), reading every dimension from the
   * current {@link meta}. Guarded so a command that resolves meta more than once
   * does not double-count. Also called from {@link catch} so a failure thrown
   * before {@link toMeta} finished (e.g. server resolution, flag parsing) still
   * records the run. Returns early for an inert (opted-out / test-runner /
   * nowhere to send) instance so a disabled run never builds the property bags —
   * no timezone→country resolution or URL parsing for users who opted out. The
   * anonymous device profile is install-level and stable, so it is written only
   * on first run rather than paying a `people.set` request on every command.
   */
  /**
   * Telemetry factory seam. Production returns the real {@link Telemetry.create};
   * tests override it to inject a recording client and assert the lifecycle
   * ordering and opt-out behaviour that the central Vitest consent guard would
   * otherwise make untestable.
   */
  protected createTelemetry(deps: TelemetryDeps): Telemetry {
    return Telemetry.create(deps);
  }

  /**
   * Which local servers are running on the machine. Production asks `ps`; a
   * test overrides this, like {@link createTelemetry}, to answer for the machine.
   */
  protected localServers(): LocalServers {
    return new PsLocalServers();
  }

  private openTelemetry(flag: boolean | undefined): void {
    if (this.telemetry) {
      return;
    }
    this.telemetry = this.createTelemetry({
      env: process.env,
      flag,
      debug: this.meta.debug,
      vercelKeys: vercelEventKeys(this.meta.command),
    });
    if (!this.telemetry.enabled) {
      return;
    }
    this.telemetry.track(
      CLI_COMMAND_STARTED,
      commandEventProperties(this.meta, this.telemetryInvocationId, this.telemetryProps),
    );
    if (this.telemetry.isFirstRun) {
      this.telemetry.profile(deviceProfileProperties(this.meta, this.telemetry.distinctId), {
        $ip: 0,
      });
      if (this.isInteractive()) {
        process.stderr.write(`${FIRST_RUN_NOTICE}\n`);
      }
    }
  }

  /**
   * Whether this invocation is an interactive human session, used to gate the
   * one-time first-run notice. Derived from argv + `jsonEnabled()` + TTY rather
   * than `meta.nonInteractive`, so it is correct even on the early-failure path
   * where {@link catch} opens telemetry against a fallback meta that has not yet
   * computed `nonInteractive` from the flags.
   */
  private isInteractive(): boolean {
    if (this.meta.nonInteractive || this.jsonEnabled()) {
      return false;
    }
    const argv = process.argv;
    if (argv.includes("--json") || argv.includes("--non-interactive") || argv.includes("-n")) {
      return false;
    }
    return Boolean(process.stdout.isTTY && process.stdin.isTTY);
  }

  /**
   * Final step of every command: in human mode it prints the rendered result,
   * then the result's next steps, then its footer (oclif suppresses
   * {@link Command.log} under `--json`); it returns the envelope so oclif's
   * `--json` path serialises it.
   */
  protected emit(result: CommandResult): JsonEnvelope {
    const normalized = normalizeCommandResult(result, this.meta);
    if (this.telemetry?.enabled) {
      this.telemetry.track(
        CLI_COMMAND_COMPLETED,
        commandEventProperties(this.meta, this.telemetryInvocationId, {
          ...this.telemetryProps,
          status: result.status,
          duration_ms: Date.now() - this.telemetryStartedAt,
        }),
      );
    }
    const next =
      normalized.status === "ok" && normalized.nextShown !== undefined
        ? ""
        : renderNextSteps(normalized.next ?? {});
    // Output a script reads keeps stdout to itself, so the next steps go
    // beside it on stderr rather than into what the script is reading.
    const beside = normalized.status === "ok" && normalized.pretty?.kind === "piped";
    // The rendering is the CLI's own, painted by it: what the server wrote was
    // spelled out as it entered, so escaping the whole of it here would spell
    // out the colour too.
    // An empty rendering is written as nothing, not as a blank line: a piped
    // list of no records must leave stdout empty, so `wc -l` reports 0.
    const rendered = renderPretty(normalized, beside ? "" : next);
    const footer = normalized.status === "ok" ? normalized.footer : undefined;
    const ending = this.endingOf(normalized, footer);
    if (beside) {
      if (rendered !== "") {
        this.log(stripColumnMarks(rendered));
      }
      if (next !== "") {
        this.logAside(rendered !== "" ? `\n${next}` : next);
      }
      if (footer !== undefined) {
        this.log(`\n${stripColumnMarks(footer)}`);
      }
    } else if (this.ui.interactive) {
      this.ui.finish(ending);
    } else if (this.rendersForAMachine()) {
      if (rendered !== "") {
        this.log(stripColumnMarks(rendered));
      }
      if (footer !== undefined) {
        this.log(`\n${stripColumnMarks(footer)}`);
      }
    } else {
      const text = this.ui.written(ending).replace(/\n+$/, "");
      if (text !== "") {
        this.log(text);
      }
    }
    // Reported warnings were printed when they happened, so they join the
    // envelope only: printing them again here would show them twice.
    const reported = takeReportedWarnings();
    const envelope = toEnvelope(withReportedWarnings(normalized, reported), this.meta);
    return envelope.status === "skipped" ? withWarnings(envelope, reported) : envelope;
  }

  /**
   * How this command ends, as the one {@link Summary} both renderings are
   * built from: the one the command stated. It is settled here rather than per
   * rendering, so a run that is drawn and a run that is written cannot end on
   * different words.
   *
   * The next steps are the result's own, stated once; the ending draws the same
   * ones unless the summary names steps of its own, or the command already
   * showed them in output of its own.
   */
  private endingOf(result: CommandResult, footer: string | undefined): Summary {
    const own = result.summary;
    const shown = result.status === "ok" && result.nextShown !== undefined;
    const steps = own.next ?? (shown ? [] : stepsOf(result.next));
    const ran = own.ran ?? this.serverRanOn();
    const warnings =
      result.status === "ok" && !result.warningsShown
        ? (result.warnings ?? []).map(warningLine)
        : [];
    const extras = [
      ...(own.extras ?? []),
      ...(footer === undefined ? [] : footer.split("\n")),
      ...warnings,
    ];
    return this.withOverview(
      {
        ...own,
        ...(ran === undefined ? {} : { ran }),
        ...(steps.length === 0 ? {} : { next: steps }),
        ...(extras.length === 0 ? {} : { extras }),
      },
      result.status === "ok",
    );
  }

  /**
   * The server this run spoke to, when it is not the default one, so an ending
   * that knows no project can still say where it ran.
   */
  private serverRanOn(): string | undefined {
    if (this.meta.dryRun) {
      return undefined;
    }
    return hostUnlessDefault(this.meta.source);
  }

  /**
   * Whether what this command rendered is for a machine rather than a person,
   * in which case it is written as it is and the ending never decorates it.
   *
   * Two things make it so. A command that took its own ending away as text
   * (`setup`, through `Ui.ending`) has already said everything an ending
   * says. And off a terminal a normal command's answer is the machine form it
   * chose for itself — `--plain` is implied there, so a list is tab-separated
   * rows and a record is the record — which `cut`, `awk` and `wc -l` read and
   * which a count or a footer under it would break. A wizard has no such
   * form: what it writes is prose for a person however it is read, so it ends
   * the way it always ends.
   */
  private rendersForAMachine(): boolean {
    return this.ui.reported || (!this.summarises() && !process.stdout.isTTY);
  }

  /**
   * The command overview as the last step of a summary that has steps, so every
   * box ends the same way and the overview can be found from anywhere without
   * already knowing it exists. A summary that names it already keeps its own.
   *
   * @param summary - The ending as the command stated it.
   * @param changed - Whether the run did its work. Only one that did spends the
   * skills offer, which a machine gets once: a skip or a no leaves it for the
   * next run that changes something.
   */
  private withOverview(summary: Summary, changed: boolean): Summary {
    const steps = summary.next ?? [];
    if (!this.summarises()) {
      return { ...summary, boxed: false };
    }
    const overview = steps.some((step) => step.text === OVERVIEW)
      ? []
      : [{ text: OVERVIEW, command: publicCliCommand("", this.config.version) }];
    const skills =
      this.skillsOffered && changed ? [claimSkills(process.env, this.config.version)] : [];
    return {
      ...summary,
      next: [...steps, ...overview, ...skills.filter((step) => step !== undefined)],
    };
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
      process.stderr.isTTY || process.env[FORCE_COLOR.name] ? text : stripVTControlCharacters(text),
    );
  }

  /**
   * Renders any thrown error as the failure envelope and exits with its code.
   * A flag-parse error fires before {@link toMeta} runs, so the local `meta`
   * here refreshes `command` from the now-resolved command id to keep the
   * envelope's `command` field accurate. If that early failure left telemetry
   * unopened, {@link openTelemetry} runs here so the failure is still recorded;
   * the flag isn't parsed yet on that path, so `--no-telemetry` is honoured from
   * argv.
   */
  protected override async catch(error: unknown): Promise<never> {
    const meta: GlobalOptions = { ...this.meta, command: this.id ?? this.meta.command };
    const zitadelError = toZitadelError(error);
    this.meta = meta;
    this.openTelemetry(process.argv.includes("--no-telemetry") ? false : undefined);
    if (this.telemetry?.enabled) {
      this.telemetry.track(
        CLI_COMMAND_FAILED,
        commandEventProperties(meta, this.telemetryInvocationId, {
          ...this.telemetryProps,
          status: "error",
          reason: zitadelError.code,
          exit_code: zitadelError.exitCode,
          duration_ms: Date.now() - this.telemetryStartedAt,
        }),
      );
    }
    if (this.jsonEnabled()) {
      this.logJson(withWarnings(toErrorEnvelope(zitadelError, meta), takeReportedWarnings()));
    } else if (zitadelError.code === "E_CANCELLED") {
      this.ui.stop(zitadelError);
    } else {
      const ending = failureSummary(zitadelError, meta);
      if (this.ui.interactive && this.ui.opened) {
        this.ui.finish(ending);
      } else {
        this.logAside(this.ui.written(ending).replace(/\n+$/, ""));
      }
    }
    return this.exit(zitadelError.exitCode);
  }

  /**
   * oclif runs this after `run`/`catch` on every path. We flush pending
   * telemetry so a short-lived CLI process does not exit before the lifecycle
   * event is sent. The await is bounded by the flush budget, so a hung or
   * firewalled network adds at most ~1s.
   *
   * `mixpanel@0.18` always uses keep-alive agents (hardcoded; not configurable)
   * and exposes no request timeout or handle, so a completed *or* hung request
   * leaves a socket that keeps Node's event loop open past the await. The
   * failure path force-exits via oclif's `exit()`, but the success path would
   * otherwise hang, so we arm an unref'd watchdog: it cannot keep the loop alive
   * on a clean exit, but if a telemetry socket is still holding it open after
   * the grace, it force-exits with the resolved code.
   */
  protected override async finally(error: Error | undefined): Promise<void> {
    this.stopListeningForInterrupt();
    this.ui.releaseNarration();
    await this.telemetry?.shutdown(1000);
    if (this.telemetry?.enabled) {
      setTimeout(() => process.exit(process.exitCode ?? 0), 250).unref();
    }
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
      isTTY: Boolean(process.stdout.isTTY && process.stdin.isTTY),
      colored: false,
      json: false,
    };
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

/** Rewrites each suggested `zitadel …` command to the public form the reader can run. */
function normalizeCommandResult(result: CommandResult, meta: GlobalOptions): CommandResult {
  const stated =
    result.pretty === undefined && result.summary !== undefined
      ? { ...result, pretty: painted(textOf(result.summary)) }
      : result;
  if (stated.next?.commands === undefined) {
    return stated as CommandResult;
  }
  const commands = normalizePublicCliCommands(stated.next.commands, meta.cliVersion);
  return { ...stated, next: { ...stated.next, commands } } as CommandResult;
}

/**
 * The data with its next steps written in. Data that is not an object (a
 * write the server answered without a body) has nowhere to hold them.
 */
function withNextSteps(data: unknown, next: NextSteps | undefined): unknown {
  return next === undefined || !isObject(data) ? data : { ...data, ...nextStepsData(next) };
}

/** Add the warnings reported while the command ran to an ok result. */
function withReportedWarnings(result: CommandResult, reported: readonly string[]): CommandResult {
  if (result.status !== "ok" || reported.length === 0) {
    return result;
  }
  return { ...result, warnings: [...reported, ...(result.warnings ?? [])] };
}

/**
 * Add reported warnings to a skipped or error envelope. Those envelopes carry
 * `warnings` only when there are some, so their shape is otherwise unchanged.
 */
function withWarnings<T extends SkippedEnvelope | ErrorEnvelope>(
  envelope: T,
  warnings: readonly string[],
): T {
  return warnings.length === 0 ? envelope : { ...envelope, warnings: [...warnings] };
}

/** Wraps a {@link CommandResult} with the invocation metadata into the final envelope. */
function toEnvelope(result: CommandResult, meta: GlobalOptions): JsonEnvelope {
  const base: EnvelopeMeta = {
    cli_version: meta.cliVersion,
    command: meta.command,
    source: meta.source,
  };
  if (result.status === "ok") {
    return {
      ...base,
      status: "ok",
      data: withNextSteps(result.data, result.next),
      warnings: result.warnings ? [...result.warnings] : [],
    };
  }
  return {
    ...base,
    status: "skipped",
    reason: result.reason,
    data: result.data,
    next_commands: result.next?.commands ? [...result.next.commands] : undefined,
  };
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
    hint: error.hint === undefined ? undefined : spellOutCommands(error.hint, meta.cliVersion),
    next_commands: normalizePublicCliCommands(error.nextCommands, meta.cliVersion),
    details: error.details,
  };
}

/**
 * Renders a {@link CommandResult} as human-facing text for non-JSON mode: the
 * command's own rendering, or the one its summary gives (`normalizeCommandResult`
 * settles which). `next` is the rendered next-step block, which follows the
 * rendering, and comes before the warnings.
 */
function renderPretty(result: CommandResult, next: string): string {
  // A command's own rendering arrives spelled out, because the factory that
  // made it knew which spelling its shape takes, so interpolating what the
  // server answered is safe wherever a command does it.
  const own = result.pretty?.text ?? "";
  const warnings = result.status === "ok" && !result.warningsShown ? (result.warnings ?? []) : [];
  const body = next === "" || own === "" ? own : `${own.replace(/\n+$/, "")}\n`;
  return [body, next, ...warnings.map(warningLine)].filter((line) => line !== "").join("\n");
}

/**
 * A failure as the one ending every failure is shown as: the coded sentence, an
 * optional hint, and any commands to run next. It is the only place a failure
 * becomes words for a person, so there is one grammar however the failure
 * arose — the CLI's own refusal, the platform's, a socket that never answered,
 * or oclif refusing the command line.
 */
function failureSummary(error: ZitadelError, meta: GlobalOptions): Summary {
  const { sentence, misuse } = failureText(error.message);
  // A failure names what it failed on — an origin, an id, a value — so the
  // message and the hint carry what the server answered as readily as a
  // success's rendering does, and are spelled out here for the same reason.
  // The envelope keeps them as they came, so a reader parses the real text.
  // Only the label is coloured, so there is nothing for the spelling to undo.
  const suggested = normalizePublicCliCommands(error.nextCommands, meta.cliVersion) ?? [];
  const commands = suggested.length > 0 ? suggested : misuse ? [helpFor(meta)] : [];
  return {
    title: `Error: ${escapeControlCharacters(spellOutCommands(sentence, meta.cliVersion))} (${error.code})`,
    sections: [],
    lines: error.hint
      ? [escapeControlCharacters(spellOutCommands(error.hint, meta.cliVersion))]
      : [],
    ...(commands.length === 0
      ? {}
      : { next: [{ text: NEXT_LABEL, command: commands.join("\n") }], boxed: true }),
    failed: true,
  };
}

/** `zitadel <command> --help`: the step a refused command line ends on. */
function helpFor(meta: GlobalOptions): string {
  const command = meta.command.replaceAll(":", " ").trim();
  return publicCliCommand(command === "" ? "--help" : `${command} --help`, meta.cliVersion);
}

/**
 * One warning, as a person reads it: a coloured label and the warning itself.
 *
 * A warning names what the server answered as readily as a rendering does, so
 * it is spelled out here — the one place a warning becomes a line — and only
 * the label is coloured, so there is nothing for the spelling to undo.
 */
function warningLine(warning: string): string {
  return `${statusColor.warn("Warning:")} ${escapeControlCharacters(warning)}`;
}

/** The last step of every box: where to find every command. */
const OVERVIEW = "Explore all commands:";
