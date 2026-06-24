import { randomUUID } from "node:crypto";

import { Command, Flags } from "@oclif/core";
import consola from "consola";

import { toZitadelError, type ZitadelError } from "../errors";
import { isObject } from "../json";
import { resolveCwd } from "../paths";
import { normalizePublicCliCommand, normalizePublicCliCommands } from "../public-cli";
import { resolveServer } from "../server";
import { type Properties, Telemetry } from "../telemetry";
import {
  CLI_COMMAND_COMPLETED,
  CLI_COMMAND_FAILED,
  CLI_COMMAND_STARTED,
  commandEventProperties,
  deviceProfileProperties,
  FIRST_RUN_NOTICE,
} from "./command-telemetry";
import type {
  CommandResult,
  ErrorEnvelope,
  EnvelopeMeta,
  GlobalOptions,
  JsonEnvelope,
} from "./types";

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

  /** Flags shared by every command, inherited via oclif `baseFlags`. */
  static override baseFlags = {
    cwd: Flags.string({ char: "c", description: "Project directory to operate on." }),
    server: Flags.string({ char: "s", description: "Override the resolved server URL." }),
    "non-interactive": Flags.boolean({
      char: "n",
      description: "Disable prompts. Required when scripting or running as an agent.",
    }),
    force: Flags.boolean({ char: "f", description: "Overwrite protected files on conflict." }),
    "dry-run": Flags.boolean({ description: "Preview without mutating files or the platform." }),
    verbose: Flags.boolean({ description: "Verbose logging." }),
    debug: Flags.boolean({ description: "Debug logging." }),
    telemetry: Flags.boolean({
      default: true,
      allowNo: true,
      description: "Send anonymous usage analytics. Disable with --no-telemetry.",
    }),
  };

  /** Resolved context for the current invocation; set by {@link toMeta}. */
  protected meta: GlobalOptions = this.fallbackMeta();

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
   * Merge command-specific dimensions into {@link telemetryProps} immutably: a
   * new frozen bag replaces the previous one, so no shared object is ever
   * mutated. `step` advances by re-recording it at each milestone.
   */
  protected recordTelemetry(patch: Properties): void {
    this.telemetryProps = Object.freeze({ ...this.telemetryProps, ...patch });
  }

  /**
   * Builds {@link GlobalOptions} from parsed flags, resolving the server
   * `source` by the documented precedence and storing the result on
   * `this.meta` so the error handler can render a complete envelope.
   */
  protected async toMeta(
    flags: Record<string, unknown>,
    options: { resolveServer?: boolean; source?: string } = {},
  ): Promise<GlobalOptions> {
    const cwd = resolveCwd(typeof flags.cwd === "string" ? flags.cwd : undefined);
    const serverFlag = typeof flags.server === "string" ? flags.server : undefined;
    const environment = typeof flags.environment === "string" ? flags.environment : "development";
    const source =
      options.resolveServer === false
        ? { value: options.source ?? "", origin: "default" as const }
        : await resolveServer({ cwd, env: process.env, serverFlag, environment });
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
    // Drop the right-aligned timestamp the FancyReporter adds by default.
    // Timestamps add no value in a one-off CLI run, wrap awkwardly on long
    // lines (e.g. created-schema URL), and clutter the visual rhythm of the
    // ◐/✔/ℹ glyphs that anchor each step.
    consola.options.formatOptions = {
      ...consola.options.formatOptions,
      date: false,
      colors: true,
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
    this.openTelemetry(typeof flags.telemetry === "boolean" ? flags.telemetry : undefined);
    return this.meta;
  }

  /**
   * Create telemetry once per invocation and open the lifecycle (started event +
   * anonymous profile + first-run notice), reading every dimension from the
   * current {@link meta}. Guarded so a command that resolves meta more than once
   * does not double-count. Also called from {@link catch} so a failure thrown
   * before {@link toMeta} finished (e.g. server resolution, flag parsing) still
   * records the run. Returns early for an inert (opted-out / no-token /
   * test-runner) instance so a disabled run never builds the property bags —
   * no timezone→country resolution or URL parsing for users who opted out. The
   * anonymous device profile is install-level and stable, so it is written only
   * on first run rather than paying a `people.set` request on every command.
   */
  private openTelemetry(flag: boolean | undefined): void {
    if (this.telemetry) {
      return;
    }
    this.telemetry = Telemetry.create({ env: process.env, flag, debug: this.meta.debug });
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
    if (
      argv.includes("--json") ||
      argv.includes("--non-interactive") ||
      argv.includes("-n")
    ) {
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
    this.log(renderPretty(normalized, this.meta));
    return toEnvelope(normalized, this.meta);
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
      this.logJson(toErrorEnvelope(zitadelError, meta));
    } else {
      this.logToStderr(renderError(zitadelError, meta));
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
 * command may supply a bespoke `pretty` string (e.g. the `apply` plan diff);
 * otherwise success payloads are summarised by {@link formatData} and skips are
 * shown with their reason and follow-up commands.
 */
function renderPretty(result: CommandResult, meta: GlobalOptions): string {
  if (result.pretty !== undefined) {
    return result.pretty;
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
 * Renders a {@link ZitadelError} as a human-readable block for stderr: the
 * coded message, an optional hint, and any suggested next commands.
 */
function renderError(error: ZitadelError, meta: GlobalOptions): string {
  const lines = [`Error ${error.code}: ${error.message}`];
  if (error.hint) {
    lines.push(error.hint);
  }
  const nextCommands = normalizePublicCliCommands(error.nextCommands, meta.cliVersion);
  if (nextCommands && nextCommands.length > 0) {
    lines.push("Next:");
    for (const cmd of nextCommands) {
      lines.push(`  $ ${cmd}`);
    }
  }
  return lines.join("\n");
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
    const segments: string[] = [];
    if (typeof project.project_id === "string") {
      segments.push(`project=${project.project_id}`);
    }
    if (typeof project.lifecycle === "string") {
      segments.push(`lifecycle=${project.lifecycle}`);
    }
    if (typeof project.issuer === "string") {
      segments.push(`issuer=${project.issuer}`);
    }
    if (segments.length > 0) {
      lines.push(`Project: ${segments.join("  ")}`);
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

  if (isObject(data.apply)) {
    const apply = data.apply;
    const bits: string[] = [];
    if (typeof apply.config_version === "number") {
      bits.push(`v${apply.config_version}`);
    }
    if (typeof apply.hash === "string") {
      bits.push(`hash=${String(apply.hash).slice(0, 12)}`);
    }
    if (typeof apply.environment === "string") {
      bits.push(`env=${apply.environment}`);
    }
    if (bits.length > 0) {
      lines.push(`Apply: ${bits.join("  ")}`);
    }
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
    if (url.host === "api.zitadel.cloud") {
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
