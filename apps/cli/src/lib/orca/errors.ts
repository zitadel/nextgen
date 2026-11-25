import type { Categorized, ErrorCategory } from "@/lib/errors";

/**
 * What an orca failure carries beyond its message.
 */
export type OrcaErrorOptions = {
  /**
   * What to do about it, in words that name no command or flag.
   */
  readonly hint?: string | undefined;

  /**
   * Structured facts about the failure, for a `--json` reader.
   */
  readonly details?: Readonly<Record<string, unknown>> | undefined;

  /**
   * The error that caused this one.
   */
  readonly cause?: unknown;
};

/**
 * Anything orca fails with on purpose.
 *
 * @remarks
 * A caller catches this, or one of its subclasses; the CLI turns it into its
 * own error in one place. A failure nothing here anticipated is not one of
 * these: it bubbles as it was thrown.
 */
export class OrcaError extends Error implements Categorized {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "OrcaError";

  /** The kind of failure; a subclass states its own. */
  readonly category: ErrorCategory = "invalid";

  /** Whether the same request may succeed on a later attempt, with nothing changed. */
  readonly retryable: boolean = false;

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
  constructor(message: string, options: OrcaErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.hint = options.hint;
    this.details = options.details;
  }
}

/**
 * Nothing in the directory is an app of a framework orca knows.
 */
export class OrcaFrameworkMissingError extends OrcaError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "OrcaFrameworkMissingError";
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
}

/**
 * Why a framework cannot be used: `unknown` is a framework orca has no
 * detector for, `layout` and `outdated` are an app of a shape or version it
 * does not integrate, and `mismatch` is an app of another framework than the
 * one asked for.
 */
export type OrcaFrameworkUnsupportedReason = "unknown" | "layout" | "outdated" | "mismatch";

/**
 * A framework, or an app of one, that orca cannot work with.
 */
export class OrcaFrameworkUnsupportedError extends OrcaError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "OrcaFrameworkUnsupportedError";
  override readonly category: ErrorCategory;
  override readonly retryable: boolean = false;

  /**
   * Why the framework cannot be used.
   */
  readonly reason: OrcaFrameworkUnsupportedReason;

  /**
   * Make the failure.
   *
   * @param reason - Why the framework cannot be used.
   * @param message - What went wrong.
   * @param options - What to do about it, the facts behind it, and its cause.
   */
  constructor(
    reason: OrcaFrameworkUnsupportedReason,
    message: string,
    options: OrcaErrorOptions = {},
  ) {
    super(message, options);
    this.reason = reason;
    this.category = reason === "mismatch" ? "conflict" : "invalid";
  }
}

/**
 * Why a scaffold cannot start: `occupied` is a directory that already holds
 * something, `node` a Node the framework's tool refuses, and `command` a tool
 * that is not installed.
 */
export type OrcaScaffoldBlockedReason = "occupied" | "node" | "command";

/**
 * A scaffold that cannot start until something in the way is dealt with.
 */
export class OrcaScaffoldBlockedError extends OrcaError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "OrcaScaffoldBlockedError";
  override readonly category: ErrorCategory;
  override readonly retryable: boolean = false;

  /**
   * What stands in the way.
   */
  readonly reason: OrcaScaffoldBlockedReason;

  /**
   * Make the failure.
   *
   * @param reason - What stands in the way.
   * @param message - What went wrong.
   * @param options - What to do about it, the facts behind it, and its cause.
   */
  constructor(reason: OrcaScaffoldBlockedReason, message: string, options: OrcaErrorOptions = {}) {
    super(message, options);
    this.reason = reason;
    this.category = reason === "occupied" ? "conflict" : "invalid";
  }
}

/**
 * A file a patch needs, and the project does not have.
 */
export class OrcaPatchFileMissingError extends OrcaError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "OrcaPatchFileMissingError";
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
}

/**
 * What would resolve a patch's conflict with a file: `replaces` is a rewrite
 * of the file, `useless` is that a rewrite would change nothing, and `none` is
 * that the conflict has no bearing on it.
 */
export type OrcaPatchForce = "replaces" | "useless" | "none";

/**
 * What an {@link OrcaPatchFileConflictError} carries beyond an
 * {@link OrcaError}'s.
 */
export type OrcaPatchFileConflictOptions = OrcaErrorOptions & {
  /**
   * Whether replacing files would resolve it; `none` when not stated.
   */
  readonly force?: OrcaPatchForce | undefined;
};

/**
 * A file of the project that a patch cannot be written over.
 */
export class OrcaPatchFileConflictError extends OrcaError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "OrcaPatchFileConflictError";
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;

  /**
   * Whether replacing files would resolve it.
   */
  readonly force: OrcaPatchForce;

  /**
   * Make the failure.
   *
   * @param message - What went wrong.
   * @param options - What to do about it, the facts behind it, and its cause.
   */
  constructor(message: string, options: OrcaPatchFileConflictOptions = {}) {
    super(message, options);
    this.force = options.force ?? "none";
  }
}

/**
 * A file of the project that a patch cannot edit: its content is not in a
 * shape the patch handles, or is broken.
 */
export class OrcaPatchFileUnsupportedError extends OrcaError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "OrcaPatchFileUnsupportedError";
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
}

/**
 * Why a renderer cannot be used: `unknown` is an id that names none, and
 * `pending` is one that is declared and not published yet.
 */
export type OrcaRendererReason = "unknown" | "pending";

/**
 * A renderer that cannot be used.
 */
export class OrcaRendererError extends OrcaError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "OrcaRendererError";
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;

  /**
   * Why the renderer cannot be used.
   */
  readonly reason: OrcaRendererReason;

  /**
   * Make the failure.
   *
   * @param reason - Why the renderer cannot be used.
   * @param message - What went wrong.
   * @param options - What to do about it, the facts behind it, and its cause.
   */
  constructor(reason: OrcaRendererReason, message: string, options: OrcaErrorOptions = {}) {
    super(message, options);
    this.reason = reason;
  }
}

/**
 * A bug in this package: something that cannot happen unless the code is wrong.
 */
export class OrcaInternalError extends OrcaError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "OrcaInternalError";
  override readonly category: ErrorCategory = "fault";
  override readonly retryable: boolean = false;
}
