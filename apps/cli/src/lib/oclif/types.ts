import type { ZitadelClient } from "@/lib/backend";
import type { Environment } from "@/lib/environment";
import type { SuggestedCommand } from "@/lib/suggestion";
import type { BaseCommand } from "./base";
import type { NextSteps, StepsShown } from "./next-steps";
import type { Rendering } from "./rendering";

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
  /** Warnings reported before the command stopped; present only when there are any. */
  warnings?: string[];
};

/**
 * Failure envelope mirroring a `ZitadelError`. The machine-readable `code` (not
 * the exit code) lets agents branch on the failure class, while `hint` and
 * `next_commands` guide remediation.
 */
export type ErrorEnvelope = EnvelopeMeta & {
  status: "error";
  code: string;
  message: string;
  hint?: string;
  next_commands?: string[];
  details?: unknown;
  /** Warnings reported before the command failed; present only when there are any. */
  warnings?: string[];
};

/**
 * The discriminated union of every envelope the CLI emits. `status` is the
 * discriminant agents switch on. oclif serialises whichever envelope a command
 * returns when `--json` is passed.
 */
export type JsonEnvelope = OkEnvelope | SkippedEnvelope | ErrorEnvelope;

/**
 * Resolved invocation-wide context every command reads via `this.meta`: the
 * parsed global flags (interactivity, dry-run/force), the envelope metadata
 * (`command`, `cliVersion`, `source`), and the process inputs (`env`, `isTTY`)
 * surfaced as data so command bodies stay testable.
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
  /** Whether human output is coloured; the one decision, see `./base`. */
  colored: boolean;
  /** Whether the run answers in the JSON envelope. */
  json: boolean;
};

/**
 * An environment variable that sets what a global flag sets. The code that
 * reads it declares it and reads it by `name`, and the CLI reference lists it
 * beside the flag (`FLAG_VARIABLES` in `./base`).
 */
export type FlagVariable = {
  readonly name: string;
  /** The global flag it stands in for, without `--`. */
  readonly flag: keyof (typeof BaseCommand)["baseFlags"];
  readonly description: string;
  /** How it ranks against the flag and the other sources of the setting. */
  readonly precedence: string;
};

/**
 * What a command body returns to {@link import("./base").BaseCommand.emit}: a
 * success or a deliberate skip. The optional `pretty` string lets a command
 * supply a bespoke human rendering (e.g. `deploy`'s summary); otherwise the
 * generic renderer formats `data`. Failures are thrown as `ZitadelError`,
 * never returned.
 *
 * `next` is the only way a result suggests what to do next: the base command
 * writes it into the envelope (`data.next_actions`/`data.next_commands` on
 * success, `next_commands` on a skip) and prints it after the rendering, on
 * stderr instead when the rendering is output a script reads, and not again
 * when `nextShown` says the command's own output showed it.
 *
 * A rendering is made by one of the four factories in `./rendering` —
 * {@link import("./rendering").prose}, {@link import("./rendering").json},
 * {@link import("./rendering").rows} or {@link import("./rendering").painted}
 * — because each shape takes a different spelling and is ruined by the
 * others'. The factory spells out what it is given, so a command
 * interpolating what the server answered needs no escaping of its own, and
 * the `kind` a rendering carries says only who the output is for.
 */
export type CommandResult =
  | {
      readonly status: "ok";
      readonly data: unknown;
      readonly warnings?: ReadonlyArray<string>;
      /**
       * A bespoke rendering, which says which kind it is so the base command
       * can spell it out the way that kind takes.
       */
      readonly pretty?: Rendering;
      readonly next?: NextSteps<SuggestedCommand>;
      /**
       * Set when the command already printed {@link next} in output of its
       * own (`setup`'s summary box), so the trailing block would repeat it.
       */
      readonly nextShown?: StepsShown;
      /** Set when {@link pretty} already says every warning, so none is printed again below it. */
      readonly warningsShown?: boolean;
      /** Printed in human mode after everything else, and never part of the envelope. */
      readonly footer?: string;
    }
  | {
      readonly status: "skipped";
      readonly reason: string;
      readonly data?: unknown;
      /** Only commands: a skipped envelope carries `next_commands` and no prose. */
      readonly next?: Pick<NextSteps<SuggestedCommand>, "commands">;
      /** As on a success: a rendering that says which kind it is. */
      readonly pretty?: Rendering;
    };

/** The platform connection a project command opens. */
export type Connection = Readonly<{
  client: ZitadelClient;
  projectId: string;
  server: string;
  environment: Environment;
}>;

/** How a project command opens its {@link Connection}. */
export type ConnectOptions = Readonly<{
  quiet?: boolean;
  prompt?: boolean;
  /**
   * How long one request on this connection may take, for a caller that must
   * not wait as long as the rest of the run: a best-effort probe answers
   * "unknown" rather than holding the command, and the request has to be given
   * up on as well, or it keeps the process alive after the answer was settled.
   */
  timeoutMs?: number;
}>;
