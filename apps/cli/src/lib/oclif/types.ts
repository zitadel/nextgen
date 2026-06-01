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
  next_commands?: string[];
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
};

/**
 * What a command body returns to {@link import("./base").BaseCommand.emit}: a
 * success or a deliberate skip. The optional `pretty` string lets a command
 * supply a bespoke human rendering (e.g. the `apply` plan diff); otherwise the
 * generic renderer formats `data`. Failures are thrown as `ZitadelError`,
 * never returned.
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
