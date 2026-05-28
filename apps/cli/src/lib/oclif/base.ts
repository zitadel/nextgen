import { Command, Flags } from "@oclif/core";
import consola from "consola";

import { resolveServer } from "../api/resolve-server";
import { toZitadelError, type ZitadelError } from "../errors";
import { isObject } from "../json";
import { resolveCwd } from "../paths";

/**
 * Fields present on every JSON envelope regardless of status. Agents key off
 * these to correlate output with the CLI version, the command that ran, and the
 * resolved platform `source` (a server URL or the literal `mock`).
 */
export type EnvelopeMeta = {
  cli_version: string;
  command: string;
  source: string;
};

/**
 * Successful result envelope. `data` is the command-specific payload; optional
 * `warnings` surface non-fatal advisories without changing the success status.
 */
export type OkEnvelope = EnvelopeMeta & {
  status: "ok";
  data: unknown;
  warnings: string[];
};

/**
 * Envelope for a deliberate no-op (e.g. already initialized). Distinct from
 * `error` so agents do not treat an idempotent skip as a failure; `reason` is a
 * stable token they can match on.
 */
export type SkippedEnvelope = EnvelopeMeta & {
  status: "skipped";
  reason: string;
  data?: unknown;
  next_commands?: string[];
};

/**
 * Failure envelope mirroring {@link ZitadelError}. The machine-readable `code`
 * (not the exit code) lets agents branch on the failure class, while `hint` and
 * `next_commands` guide remediation.
 */
export type ErrorEnvelope = EnvelopeMeta & {
  status: "error";
  code: string;
  message: string;
  hint?: string;
  next_commands?: string[];
  details?: unknown;
};

/**
 * The discriminated union of every envelope the CLI emits. `status` is the
 * discriminant agents switch on. oclif serialises whichever envelope a command
 * returns when `--json` is passed.
 */
export type JsonEnvelope = OkEnvelope | SkippedEnvelope | ErrorEnvelope;

/**
 * Resolved invocation-wide context threaded through every domain `run*`
 * function: the parsed global flags (interactivity, dry-run/force), the
 * envelope metadata (`command`, `cliVersion`, `source`), and the process
 * inputs (`env`, `isTTY`) passed as data rather than read from globals so the
 * functions stay pure and unit-testable.
 */
export type GlobalOptions = {
  cwd: string;
  nonInteractive: boolean;
  dryRun: boolean;
  force: boolean;
  command: string;
  cliVersion: string;
  source: string;
  serverFlag?: string;
  verbose: boolean;
  debug: boolean;
  env: NodeJS.ProcessEnv;
  isTTY: boolean;
};

/**
 * What a domain `run*` function returns: a success or a deliberate skip. The
 * optional `pretty` string lets a command supply a bespoke human rendering
 * (e.g. the `apply` plan diff); otherwise the generic renderer formats `data`.
 * Failures are thrown as {@link ZitadelError}, never returned.
 */
export type CommandResult =
  | {
      readonly status: "ok";
      readonly data: unknown;
      readonly warnings?: ReadonlyArray<string>;
      readonly pretty?: string;
    }
  | {
      readonly status: "skipped";
      readonly reason: string;
      readonly data?: unknown;
      readonly nextCommands?: ReadonlyArray<string>;
      readonly pretty?: string;
    };

/**
 * Base class for every oclif command. Owns the global flags, builds the
 * {@link GlobalOptions} context (including server `source` resolution) that the
 * domain `run*` functions in `lib/commands` consume, and turns the
 * {@link CommandResult} they return into the JSON envelope (oclif serialises it
 * natively in `--json` mode) or human-facing text. Errors are translated into
 * the failure envelope and the mapped process exit code. Commands stay thin:
 * parse flags, build meta via {@link toMeta}, and `return this.emit(await runX(...))`.
 * The agent contract (ADR 004) is preserved — oclif only replaces parsing,
 * dispatch, help, and JSON emission.
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
  };

  /** Resolved context for the current invocation; set by {@link toMeta}. */
  protected meta: GlobalOptions = this.fallbackMeta();

  /**
   * Builds {@link GlobalOptions} from parsed flags, resolving the server
   * `source` by the documented precedence and storing the result on
   * `this.meta` so the error handler can render a complete envelope.
   */
  protected async toMeta(flags: Record<string, unknown>): Promise<GlobalOptions> {
    const cwd = resolveCwd(typeof flags.cwd === "string" ? flags.cwd : undefined);
    const serverFlag = typeof flags.server === "string" ? flags.server : undefined;
    const environment = typeof flags.environment === "string" ? flags.environment : "development";
    const source = await resolveServer({ cwd, env: process.env, serverFlag, environment });
    const json = this.jsonEnabled();
    const isTTY = Boolean(process.stdout.isTTY && process.stdin.isTTY);
    const verbose = Boolean(flags.verbose);
    const debug = Boolean(flags.debug);
    consola.level = debug ? 4 : verbose ? 3 : 2;
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
    return this.meta;
  }

  /**
   * Final step of every command: in human mode it prints the rendered result
   * (oclif suppresses {@link Command.log} under `--json`); it returns the
   * envelope so oclif's `--json` path serialises it.
   */
  protected emit(result: CommandResult): JsonEnvelope {
    this.log(renderPretty(result, this.meta));
    return toEnvelope(result, this.meta);
  }

  /** Renders any thrown error as the failure envelope and exits with its code. */
  protected override async catch(error: unknown): Promise<never> {
    const zitadelError = toZitadelError(error);
    if (this.jsonEnabled()) {
      this.logJson(toErrorEnvelope(zitadelError, this.meta));
    } else {
      this.logToStderr(renderError(zitadelError));
    }
    return this.exit(zitadelError.exitCode);
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
    next_commands: error.nextCommands,
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
function renderError(error: ZitadelError): string {
  const lines = [`Error ${error.code}: ${error.message}`];
  if (error.hint) {
    lines.push(error.hint);
  }
  if (error.nextCommands && error.nextCommands.length > 0) {
    lines.push("Next:");
    for (const cmd of error.nextCommands) {
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

  for (const warning of warnings) {
    lines.push(`Warning: ${warning}`);
  }
  return lines.join("\n");
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
      const status = check.status === "pass" ? "ok" : "fail";
      lines.push(`  [${status}] ${String(check.name ?? "check")}: ${String(check.message ?? "")}`);
    }
  }
}

function sourceSuffix(opts: GlobalOptions): string {
  if (opts.source === "mock") {
    return "(using mock platform)";
  }
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
