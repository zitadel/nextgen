import { ZitadelLibError } from "@/lib/errors";
import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Anything orca fails with on purpose.
 *
 * @remarks
 * A command that calls orca catches this, or one of its subclasses, and words
 * the failure itself. A failure nothing here anticipated is not one of these:
 * it bubbles as it was thrown.
 */
export abstract class OrcaError extends ZitadelLibError {}

/**
 * A directory with no app of a framework orca knows, or a framework orca has
 * no detector for: there is nothing to integrate with, so a new app could be
 * scaffolded into the directory.
 */
export class OrcaFrameworkMissingError extends OrcaError {
  override readonly category: ErrorCategory = "missing";
  override readonly code: ZitadelErrorCode = "E_FRAMEWORK_NOT_DETECTED";
  override readonly retryable: boolean = false;
}

/**
 * An app of a framework orca knows, in a shape or of a version it does not
 * integrate.
 */
export class OrcaFrameworkUnsupportedError extends OrcaError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_UNSUPPORTED_PROJECT_SHAPE";
  override readonly retryable: boolean = false;
}

/**
 * A request orca cannot act on as given: a scaffold that cannot start until
 * something in the way is dealt with (a Node the framework's tool refuses), a
 * file of the project a patch cannot edit because its content is not in a
 * shape the patch handles, or a renderer id that names none.
 */
export class OrcaInvalidError extends OrcaError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly retryable: boolean = false;
}

/**
 * A file a patch needs, and the project does not have.
 */
export class OrcaPatchFileMissingError extends OrcaError {
  override readonly category: ErrorCategory = "missing";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly retryable: boolean = false;
}

/**
 * A renderer that is declared and not published yet.
 */
export class OrcaRendererPendingError extends OrcaError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_NOT_IMPLEMENTED";
  override readonly retryable: boolean = false;
}

/**
 * A failure in this package: a bug, something that cannot happen unless the
 * code is wrong, or an external command a scaffold runs that could not be
 * spawned or exited non-zero.
 */
export class OrcaInternalError extends OrcaError {
  override readonly category: ErrorCategory = "fault";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly retryable: boolean = false;
}

/**
 * A request that conflicts with what the directory or the project already
 * holds: an app of another framework than the one asked for, a directory a
 * scaffold cannot start in, a file a patch would overwrite, or a file of the app
 * that would leave the integration broken.
 */
export class OrcaConflictError extends OrcaError {
  override readonly category: ErrorCategory = "conflict";
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly retryable: boolean = false;
}

/**
 * A directory holding an app of another framework than the one asked for.
 */
export class OrcaFrameworkMismatchError extends OrcaConflictError {
  override readonly category: ErrorCategory = "conflict";
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly retryable: boolean = false;

  /**
   * The framework id that was asked for.
   */
  readonly requested: string;

  /**
   * The framework id of the app the directory holds.
   */
  readonly detected: string;

  /**
   * The display name of the framework that was asked for.
   */
  readonly requestedName: string;

  /**
   * Make the failure for an app that is not the framework asked for.
   *
   * @param message - What was detected instead of what was asked for.
   * @param requested - The framework id that was asked for.
   * @param detected - The framework id of the app the directory holds.
   * @param requestedName - The display name of the framework that was asked for.
   */
  constructor(message: string, requested: string, detected: string, requestedName: string) {
    super(message);
    this.requested = requested;
    this.detected = detected;
    this.requestedName = requestedName;
  }
}

/**
 * A directory a scaffold cannot start in, because it already holds files.
 */
export class OrcaDirectoryNotEmptyError extends OrcaConflictError {
  override readonly category: ErrorCategory = "conflict";
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly retryable: boolean = false;

  /**
   * What makes the directory unfit, when it is more than holding files.
   */
  readonly reason: string | undefined;

  /**
   * The entries the directory holds.
   */
  readonly entries: readonly string[];

  /**
   * Make the failure for a directory that is not empty.
   *
   * @param message - Which directory is not empty.
   * @param reason - What makes the directory unfit, when it is more than holding files.
   * @param entries - The entries the directory holds.
   */
  constructor(message: string, reason: string | undefined, entries: readonly string[]) {
    super(message);
    this.reason = reason;
    this.entries = entries;
  }
}

/**
 * An app whose framework version is below the floor the CLI integrates.
 */
export class OrcaVersionBelowFloorError extends OrcaFrameworkUnsupportedError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_UNSUPPORTED_PROJECT_SHAPE";
  override readonly retryable: boolean = false;

  /**
   * The display name of the framework that is too old.
   */
  readonly displayName: string;

  /**
   * The oldest version the CLI integrates.
   */
  readonly versionFloor: string;

  /**
   * Why the floor is where it is, when the detector says so.
   */
  readonly note: string | undefined;

  /**
   * Make the failure for a framework version below the floor.
   *
   * @param message - Which version was found, and the floor it is below.
   * @param displayName - The display name of the framework that is too old.
   * @param versionFloor - The oldest version the CLI integrates.
   * @param note - Why the floor is where it is, when the detector says so.
   */
  constructor(
    message: string,
    displayName: string,
    versionFloor: string,
    note: string | undefined,
  ) {
    super(message);
    this.displayName = displayName;
    this.versionFloor = versionFloor;
    this.note = note;
  }
}

/**
 * A Next.js app on the Pages Router, which the CLI does not integrate.
 */
export class OrcaPagesRouterError extends OrcaFrameworkUnsupportedError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_UNSUPPORTED_PROJECT_SHAPE";
  override readonly retryable: boolean = false;
}

/**
 * A Node the framework's scaffolding tool refuses to run on.
 */
export class OrcaNodeUnsupportedError extends OrcaInvalidError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly retryable: boolean = false;

  /**
   * The version of the Node this runs on.
   */
  readonly node: string;

  /**
   * The Node range the scaffolding tool declares.
   */
  readonly required: string;

  /**
   * The Node versions the range accepts, in words.
   */
  readonly accepted: string;

  /**
   * The display name of the framework that was to be scaffolded.
   */
  readonly displayName: string;

  /**
   * Make the failure for a Node the scaffolding tool refuses.
   *
   * @param message - Which tool needs which Node, and the one this is.
   * @param node - The version of the Node this runs on.
   * @param required - The Node range the scaffolding tool declares.
   * @param accepted - The Node versions the range accepts, in words.
   * @param displayName - The display name of the framework that was to be scaffolded.
   */
  constructor(
    message: string,
    node: string,
    required: string,
    accepted: string,
    displayName: string,
  ) {
    super(message);
    this.node = node;
    this.required = required;
    this.accepted = accepted;
    this.displayName = displayName;
  }
}

/**
 * An external command a scaffold runs that could not be spawned.
 */
export class OrcaCommandSpawnFailedError extends OrcaInternalError {
  override readonly category: ErrorCategory = "fault";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly retryable: boolean = false;

  /**
   * The command that was run.
   */
  readonly command: string;

  /**
   * The arguments it was run with.
   */
  readonly args: readonly string[];

  /**
   * The code the spawn failed with.
   */
  readonly spawnCode: string;

  /**
   * Make the failure for a command that could not be spawned.
   *
   * @param message - Which command could not be spawned, and why.
   * @param command - The command that was run.
   * @param args - The arguments it was run with.
   * @param spawnCode - The code the spawn failed with.
   */
  constructor(message: string, command: string, args: readonly string[], spawnCode: string) {
    super(message);
    this.command = command;
    this.args = args;
    this.spawnCode = spawnCode;
  }
}

/**
 * An external command a scaffold runs that is not on the `PATH`.
 */
export class OrcaCommandNotFoundError extends OrcaCommandSpawnFailedError {
  override readonly category: ErrorCategory = "fault";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly retryable: boolean = false;
}

/**
 * An external command a scaffold runs that exited non-zero.
 */
export class OrcaCommandFailedError extends OrcaInternalError {
  override readonly category: ErrorCategory = "fault";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly retryable: boolean = false;

  /**
   * The command that was run.
   */
  readonly command: string;

  /**
   * The arguments it was run with.
   */
  readonly args: readonly string[];

  /**
   * The directory it was run in.
   */
  readonly cwd: string;

  /**
   * What it wrote to stdout.
   */
  readonly stdout: string;

  /**
   * What it wrote to stderr.
   */
  readonly stderr: string;

  /**
   * Its stderr and stdout, joined and truncated; empty when it wrote nothing.
   */
  readonly output: string;

  /**
   * Make the failure for a command that exited non-zero.
   *
   * @param message - Which command exited with which status.
   * @param run - The command, its arguments and directory, and what it wrote.
   * @param run.command - The command that was run.
   * @param run.args - The arguments it was run with.
   * @param run.cwd - The directory it was run in.
   * @param run.stdout - What it wrote to stdout.
   * @param run.stderr - What it wrote to stderr.
   * @param run.output - Its stderr and stdout, joined and truncated.
   */
  constructor(
    message: string,
    run: {
      readonly command: string;
      readonly args: readonly string[];
      readonly cwd: string;
      readonly stdout: string;
      readonly stderr: string;
      readonly output: string;
    },
  ) {
    super(message);
    this.command = run.command;
    this.args = run.args;
    this.cwd = run.cwd;
    this.stdout = run.stdout;
    this.stderr = run.stderr;
    this.output = run.output;
  }
}
