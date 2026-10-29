import { randomUUID } from "node:crypto";

import { Command, Flags } from "@oclif/core";

import { nonBlankString } from "./flags";
import consola from "consola";

import { failureText, toZitadelError, type ZitadelError } from "../errors";
import { listenForInterrupt, stopListeningForInterrupt } from "../interrupt";
import { isObject } from "../json";
import { type LocalServers, PsLocalServers } from "../local-server/processes";
import { resolveCwd } from "../paths";
import {
  normalizePublicCliCommand,
  normalizePublicCliCommands,
  publicCliCommand,
} from "../public-cli";
import { DEFAULT_SERVER, resolveServer, SERVER_VARIABLE } from "../server";
import { type SuggestedCommand, unscopedCommand } from "../suggestion";
import { type Properties, Telemetry, type TelemetryDeps } from "../telemetry";
import { DO_NOT_TRACK, ZITADEL_TELEMETRY } from "../telemetry/consent";
import { buildUserAgent, installUserAgent, processUserAgentFacts } from "../user-agent";
import { claimSkills, eligibleForSkills } from "../skills-hint";
import { takeReportedWarnings } from "../warnings";
import type { Presentation, Summary } from "../ui";
import { Ui } from "../ui";
import { stripColumnMarks } from "../ui/layout";
import { summaryOfText } from "./result-summary";
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
import type {
  CommandResult,
  ErrorEnvelope,
  EnvelopeMeta,
  FlagVariable,
  GlobalOptions,
  JsonEnvelope,
  SkippedEnvelope,
} from "./types";
import { shellOption } from "../shell";

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
export abstract class BaseCommand extends Command {
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
   * {@link Presentation} names the ten that set it. A command that merely
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
    server: nonBlankString({ char: "s", description: "Override the resolved server URL." }),
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
    // picocolors reads `--no-color` from argv on its own; consola reads the env.
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

  /** Resolved context for the current invocation; set by {@link toMeta}. */
  protected meta: GlobalOptions = this.fallbackMeta();

  /** Everything a command shows a person. Silent until {@link toMeta} finds a terminal. */
  protected ui: Ui = new Ui({ interactive: false, force: false }, this.presentation());

  /**
   * Whether this run may offer the Zitadel skills, resolved while the command
   * works so the summary can be built without waiting on a filesystem scan.
   */
  private skillsOffered = false;

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
   * oclif runs this before `run`. The user agent goes in here, ahead of flag
   * parsing and server resolution, so every request the command makes carries
   * it — including the local-server health probes {@link toMeta} can trigger.
   * Flags are not parsed yet, so `--no-telemetry` is looked for in this
   * command's argv — a plain match that errs towards opting out. (oclif's own
   * `config.userAgent` only feeds its `http-call` client, which the CLI does
   * not use.)
   */
  protected override async init(): Promise<void> {
    // A fresh invocation starts with no warnings, even when an earlier one in
    // the same process (a test run, say) failed before emitting its own.
    takeReportedWarnings();
    await super.init();
    listenForInterrupt();
    const telemetryFlag = this.argv.includes("--no-telemetry") ? false : undefined;
    installUserAgent(buildUserAgent(processUserAgentFacts(this.config.version, telemetryFlag)));
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
      this.typedCwd === undefined ? args : `${args} ${shellOption("--cwd", this.typedCwd)}`,
      this.meta.cliVersion,
    );
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
   * `resolveServer: false`.
   */
  protected async toMeta(
    flags: Record<string, unknown>,
    options: { resolveServer?: boolean; source?: string } = {},
  ): Promise<GlobalOptions> {
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
    // Default to `info` (3) so users see step-by-step narration (start/info/
    // success/box). `--json` silences consola entirely so the structured
    // envelope is the only thing on stdout. `--debug` raises to 4 (debug);
    // `--verbose` is reserved for richer per-step detail and currently maps
    // to the same level as default.
    consola.level = json ? -999 : debug ? 4 : 3;
    // `--no-color` (or the `NO_COLOR` env) turns colour off; both reach this
    // process as `NO_COLOR` via `bin/run.js`, and `--no-color` also unsets the
    // parsed `color` flag. The flag's value is the source of truth here so that
    // a programmatic `run()` (tests) honours it without the entry-point shim.
    const useColor = flags.color !== false && !process.env[NO_COLOR.name];
    // Drop the right-aligned timestamp the FancyReporter adds by default.
    // Timestamps add no value in a one-off CLI run, wrap awkwardly on long
    // lines (e.g. created-schema URL), and clutter the visual rhythm of the
    // ◐/✔/ℹ glyphs that anchor each step.
    consola.options.formatOptions = {
      ...consola.options.formatOptions,
      date: false,
      colors: useColor,
      compact: true,
    };
    this.meta = {
      cwd,
      nonInteractive: Boolean(flags["non-interactive"]) || !isTTY || json,
      dryRun: Boolean(flags["dry-run"]),
      force: Boolean(flags.force),
      command: this.id ?? "(default)",
      cliVersion: this.config.version,
      source: source.value,
      serverFlag,
      verbose,
      debug,
      env: process.env,
      isTTY,
    };
    this.ui = new Ui(
      { interactive: !this.meta.nonInteractive, force: this.meta.force },
      this.presentation(),
    );
    const named = this.constructor as typeof BaseCommand;
    this.ui.describe(named.heading ?? `zitadel ${(this.id ?? "").replaceAll(":", " ")}`.trim());
    this.ui.bridgeNarration();
    this.skillsOffered = await eligibleForSkills({
      env: process.env,
      interactive: !this.meta.nonInteractive,
    });
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
   * Final step of every command: in human mode it prints the rendered result
   * (oclif suppresses {@link Command.log} under `--json`); it returns the
   * envelope so oclif's `--json` path serialises it.
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
    // An empty rendering is written as nothing, not as a blank line: a piped
    // list of no records must leave stdout empty, so `wc -l` reports 0.
    const rendered = renderPretty(normalized, this.meta);
    const footer = normalized.status === "ok" ? normalized.footer : undefined;
    // A skip ends on its own summary too, so a deliberate no-op reads like
    // every other ending instead of as the reason token the envelope carries.
    const ending = this.endingOf(normalized, rendered, footer);
    if (this.ui.interactive) {
      // A person at a terminal: the result closes the chain the questions began.
      // A command that said everything itself returns nothing, and draws nothing.
      if (ending !== undefined) {
        this.ui.finish(ending);
      }
    } else if (this.rendersForAMachine()) {
      // Nothing folds this text, so nothing takes the mark a builder puts at
      // the head of a row it aligned (`COLUMN_MARK`): it is invisible on
      // screen but it is in the bytes, and it would travel with anything
      // copied or parsed out of them.
      if (rendered !== "") {
        this.log(stripColumnMarks(rendered));
      }
      if (footer !== undefined) {
        this.log(`\n${stripColumnMarks(footer)}`);
      }
    } else if (ending !== undefined) {
      // Nothing can be drawn, so the same ending is written out instead. It
      // goes through `log`, which `--json` silences, so the envelope still
      // travels alone on stdout.
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
   * built from: the command's own, or the one split out of what it printed.
   * It is settled here rather than per rendering, so a run that is drawn and
   * a run that is written cannot end on different words.
   *
   * Nothing at all is an ending only when the command said nothing: no
   * rendering, no footer, and nothing drawn into the chain on the way.
   */
  private endingOf(
    result: CommandResult,
    rendered: string,
    footer: string | undefined,
  ): Summary | undefined {
    const own = result.summary;
    if (own !== undefined) {
      return this.withOverview(own);
    }
    if (rendered === "" && footer === undefined && !this.ui.opened) {
      return undefined;
    }
    return this.withOverview(
      summaryOfText(
        this.summarises() && footer !== undefined ? `${rendered}\n\n${footer}` : rendered,
        false,
        this.summarises(),
        this.id,
        // A command that answers keeps its own trailing line for the footer,
        // rather than letting it become another body line.
        this.summarises() || footer === undefined ? [] : footer.split("\n"),
      ),
    );
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
   */
  private withOverview(summary: Summary): Summary {
    const steps = summary.next ?? [];
    if (!this.summarises()) {
      // A normal command has no box, and no overview step either: that is a
      // wizard's last word. Its own steps are kept, and the ending writes them
      // out as lines rather than losing the command to run next.
      return { ...summary, boxed: false };
    }
    const overview = steps.some((step) => step.text === OVERVIEW)
      ? []
      : [{ text: OVERVIEW, command: publicCliCommand("", this.config.version) }];
    // The skills offer is the last step of the first summary a machine sees,
    // rather than a block of its own after the box.
    const skills = this.skillsOffered ? [claimSkills(process.env)] : [];
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
      // Ctrl-C is the person's own decision, and the terminal already shows it
      // (`^C`, or a cancelled prompt's "Cancelled."), so it gets no error
      // block. The exit code still says the command did not finish. The chain
      // it interrupted still has to be closed, or the shell prompt is drawn
      // inside the gutter.
      this.ui.stop(zitadelError);
    } else {
      // A failure has no machine form — `--json` is where a machine reads one
      // — so it is said in the command's own shape either way, drawn when
      // there is a terminal and written when there is not. It stays on
      // stderr off a terminal, where a script expects to find it.
      const ending = summaryOfText(renderError(zitadelError, meta), true, false, this.id);
      if (this.ui.interactive) {
        this.ui.finish(ending);
      } else {
        this.logToStderr(this.ui.written(ending).replace(/\n+$/, ""));
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
    stopListeningForInterrupt();
    // `consola` is process-wide: the chain borrows its reporters while this
    // command runs and must give them back however the command ended.
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
    };
  }
}

function normalizeCommandResult(result: CommandResult, meta: GlobalOptions): CommandResult {
  if (result.status === "ok") {
    return {
      ...result,
      data: normalizeDataNextCommands(result.data, meta),
    };
  }
  return {
    ...result,
    data: normalizeDataNextCommands(result.data, meta),
    nextCommands: normalizePublicCliCommands(result.nextCommands, meta.cliVersion),
  };
}

function normalizeDataNextCommands(data: unknown, meta: GlobalOptions): unknown {
  if (!isObject(data) || !Array.isArray(data.next_commands)) {
    return data;
  }
  return {
    ...data,
    next_commands: data.next_commands.map((command) =>
      typeof command === "string" ? normalizePublicCliCommand(command, meta.cliVersion) : command,
    ),
  };
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
      data: result.data,
      warnings: result.warnings ? [...result.warnings] : [],
    };
  }
  return {
    ...base,
    status: "skipped",
    reason: result.reason,
    data: result.data,
    next_commands: result.nextCommands ? [...result.nextCommands] : undefined,
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
    hint: error.hint,
    next_commands: normalizePublicCliCommands(error.nextCommands, meta.cliVersion),
    details: error.details,
  };
}

/**
 * Renders a {@link CommandResult} as human-facing text for non-JSON mode. A
 * command may supply a bespoke `pretty` string (e.g. `deploy`'s summary);
 * otherwise success payloads are summarised by {@link formatData} and skips are
 * shown with their reason and follow-up commands.
 */
function renderPretty(result: CommandResult, meta: GlobalOptions): string {
  if (result.pretty !== undefined) {
    // A command's own rendering replaces the generic one, but not its
    // warnings: those are printed after it, so setting `pretty` cannot hide them.
    const warnings = result.status === "ok" ? (result.warnings ?? []) : [];
    return [result.pretty, ...warnings.map((warning) => `Warning: ${warning}`)]
      .filter((line) => line !== "")
      .join("\n");
  }
  if (result.status === "ok") {
    return formatData(result.data, result.warnings ? [...result.warnings] : [], meta);
  }
  const lines = [`Skipped: ${result.reason}${suffixBlock(meta)}`];
  if (result.nextCommands && result.nextCommands.length > 0) {
    lines.push("Next:");
    for (const cmd of result.nextCommands) {
      lines.push(`  $ ${cmd}`);
    }
  }
  return lines.join("\n");
}

/**
 * Renders a {@link ZitadelError} as the one block every failure is shown as:
 * the coded sentence, an optional hint, and any commands to run next. It is
 * the only place a failure becomes words for a person, so there is one grammar
 * however the failure arose — the CLI's own refusal, the platform's, a socket
 * that never answered, or oclif refusing the command line.
 */
function renderError(error: ZitadelError, meta: GlobalOptions): string {
  const { sentence, misuse } = failureText(error.message);
  const lines = [`Error ${error.code}: ${sentence}`];
  if (error.hint) {
    lines.push(error.hint);
  }
  const suggested = normalizePublicCliCommands(error.nextCommands, meta.cliVersion) ?? [];
  // A refused command line is told where its own help is, under the same label
  // as every other suggestion, rather than under oclif's "See more help with".
  const nextCommands = suggested.length > 0 ? suggested : misuse ? [helpFor(meta)] : [];
  if (nextCommands.length > 0) {
    lines.push("Next:");
    for (const cmd of nextCommands) {
      lines.push(`  $ ${cmd}`);
    }
  }
  return lines.join("\n");
}

/** `zitadel <command> --help`: the step a refused command line ends on. */
function helpFor(meta: GlobalOptions): string {
  const command = meta.command.replaceAll(":", " ").trim();
  return publicCliCommand(command === "" ? "--help" : `${command} --help`, meta.cliVersion);
}

function formatData(data: unknown, warnings: string[], opts: GlobalOptions): string {
  if (typeof data === "string") {
    const suffix = sourceSuffix(opts);
    return suffix ? `${data}\n${suffix}` : data;
  }

  const lines: string[] = [];
  const titleLine =
    isObject(data) && typeof data.title === "string"
      ? String(data.title)
      : "Zitadel command completed.";
  lines.push(titleLine);
  const suffix = sourceSuffix(opts);
  if (suffix) {
    lines.push(suffix);
  }

  if (isObject(data)) {
    renderKnownSections(lines, data);

    if (Array.isArray(data.next_actions) && data.next_actions.length > 0) {
      lines.push("");
      lines.push("Next:");
      for (const action of data.next_actions) {
        lines.push(`  ${String(action)}`);
      }
    }
    if (Array.isArray(data.next_commands) && data.next_commands.length > 0) {
      if (!Array.isArray(data.next_actions) || data.next_actions.length === 0) {
        lines.push("");
        lines.push("Next:");
      }
      for (const cmd of data.next_commands) {
        lines.push(`  $ ${String(cmd)}`);
      }
    }
  }

  for (const warning of warnings.filter((warning) => !warningRenderedInChecks(data, warning))) {
    lines.push(`Warning: ${warning}`);
  }
  return lines.join("\n");
}

function warningRenderedInChecks(data: unknown, warning: string): boolean {
  if (!isObject(data) || !Array.isArray(data.checks)) {
    return false;
  }
  return data.checks.some((check) => {
    if (!isObject(check) || check.status !== "warn") {
      return false;
    }
    return warning === `${String(check.name ?? "check")}: ${String(check.message ?? "")}`;
  });
}

function renderKnownSections(lines: string[], data: Record<string, unknown>): void {
  if (isObject(data.project)) {
    const project = data.project;
    // One sentence, not `label=value  label=value`: a label and three values
    // aligned with nothing were a table in appearance only, and the two spaces
    // holding them apart were enough to carry the line off the right of the
    // screen. Said as prose it wraps like every other sentence the CLI writes.
    const said: string[] = [];
    if (typeof project.project_id === "string") {
      said.push(`Project ${project.project_id}`);
    }
    if (typeof project.lifecycle === "string") {
      said.push(`lifecycle ${project.lifecycle}`);
    }
    if (typeof project.issuer === "string") {
      said.push(`issuer ${project.issuer}`);
    }
    if (said.length > 0) {
      lines.push(`${said.join(", ")}.`);
    }
  }

  if (typeof data.framework === "string") {
    lines.push(`framework=${data.framework}`);
  }

  if (Array.isArray(data.files_written) || Array.isArray(data.files_skipped)) {
    const written = Array.isArray(data.files_written) ? data.files_written.length : 0;
    const skippedCount = Array.isArray(data.files_skipped) ? data.files_skipped.length : 0;
    lines.push(`Files: ${written} written, ${skippedCount} unchanged`);
  }

  if (Array.isArray(data.checks) && data.checks.length > 0) {
    lines.push("Checks:");
    for (const check of data.checks) {
      if (!isObject(check)) {
        continue;
      }
      const status = check.status === "pass" ? "ok" : check.status === "warn" ? "warn" : "fail";
      lines.push(`  [${status}] ${String(check.name ?? "check")}: ${String(check.message ?? "")}`);
    }
  }
}

function sourceSuffix(opts: GlobalOptions): string {
  try {
    const url = new URL(opts.source);
    if (url.host === new URL(DEFAULT_SERVER).host) {
      return "";
    }
    return `(server: ${url.host})`;
  } catch {
    return "";
  }
}

function suffixBlock(opts: GlobalOptions): string {
  const suffix = sourceSuffix(opts);
  return suffix ? ` ${suffix}` : "";
}

/** The last step of every box: where to find every command. */
const OVERVIEW = "Explore all commands:";
