import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Anything orca fails with on purpose.
 *
 * @remarks
 * A caller catches this, or one of its subclasses; the CLI turns it into its
 * own error in one place. A failure nothing here anticipated is not one of
 * these: it bubbles as it was thrown.
 */
export abstract class OrcaError extends Error {
  /** The kind of failure; a subclass states its own. */
  abstract readonly category: ErrorCategory;

  /** Whether the same request may succeed on a later attempt, with nothing changed. */
  abstract readonly retryable: boolean;

  /** The stable product code the failure is reported with; a subclass states its own. */
  abstract readonly code: ZitadelErrorCode;

  /**
   * What to do about it.
   */
  readonly hint: string | undefined;

  /**
   * Structured facts about the failure, for a `--json` reader.
   */
  readonly details: Readonly<Record<string, unknown>> | undefined;

  /**
   * Make an orca failure.
   *
   * @param message - What went wrong.
   * @param options - What to do about it, the facts behind it, and its cause.
   */
  constructor(
    message: string,
    options: {
      readonly hint?: string | undefined;
      readonly details?: Readonly<Record<string, unknown>> | undefined;
      readonly cause?: unknown;
    } = {},
  ) {
    super(
      message,
      options.cause === undefined
        ? undefined
        : {
            cause: options.cause,
          },
    );
    this.name = new.target.name;
    this.hint = options.hint;
    this.details = options.details;
  }
}

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
 * An app of another framework than the one asked for.
 */
export class OrcaFrameworkMismatchError extends OrcaError {
  override readonly category: ErrorCategory = "conflict";
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly retryable: boolean = false;
}

/**
 * A directory that already holds something, so a scaffold cannot start in it.
 */
export class OrcaScaffoldOccupiedError extends OrcaError {
  override readonly category: ErrorCategory = "conflict";
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly retryable: boolean = false;
}

/**
 * A scaffold that cannot start until something in the way is dealt with: a
 * Node the framework's tool refuses, or a tool that is not installed.
 */
export class OrcaScaffoldBlockedError extends OrcaError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly retryable: boolean = false;
}

/**
 * A file a patch needs, and the project does not have.
 */
export class OrcaPatchFileMissingError extends OrcaError {
  override readonly category: ErrorCategory = "missing";
  override readonly code: ZitadelErrorCode = "E_NOT_FOUND";
  override readonly retryable: boolean = false;
}

/**
 * A file of the project that a patch cannot be written over.
 */
export class OrcaPatchFileConflictError extends OrcaError {
  override readonly category: ErrorCategory = "conflict";
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly retryable: boolean = false;
}

/**
 * A file the patch would write that already holds something else, and that
 * replacing it would resolve.
 */
export class OrcaPatchFileOverwriteError extends OrcaError {
  override readonly category: ErrorCategory = "conflict";
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly retryable: boolean = false;
}

/**
 * A file of the app, at a path the patch does not write, that would leave the
 * integration broken; replacing files resolves nothing.
 */
export class OrcaPatchLayoutConflictError extends OrcaError {
  override readonly category: ErrorCategory = "conflict";
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly retryable: boolean = false;
}

/**
 * A file of the project that a patch cannot edit: its content is not in a
 * shape the patch handles, or is broken.
 */
export class OrcaPatchFileUnsupportedError extends OrcaError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly retryable: boolean = false;
}

/**
 * A renderer id that names none.
 */
export class OrcaRendererUnknownError extends OrcaError {
  override readonly category: ErrorCategory = "invalid";
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
 * A bug in this package: something that cannot happen unless the code is wrong.
 */
export class OrcaInternalError extends OrcaError {
  override readonly category: ErrorCategory = "fault";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly retryable: boolean = false;
}
