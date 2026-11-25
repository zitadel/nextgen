import { codeOf } from "@/lib/errors";
import type { Categorized, ErrorCategory, Suggested, ZitadelErrorCode } from "@/lib/errors";

/**
 * What a project failure carries beyond its message.
 */
export type ProjectErrorOptions = {
  /**
   * What to do about it, in words that name no command or flag.
   */
  readonly hint?: string | undefined;

  /**
   * Structured facts about the failure, for a `--json` reader.
   */
  readonly details?: Readonly<Record<string, unknown>> | undefined;

  /**
   * What to run next, as suggestion objects the failure handler renders.
   */
  readonly nextCommands?: readonly Suggested[] | undefined;

  /**
   * The error that caused this one.
   */
  readonly cause?: unknown;
};

/**
 * Anything reading or writing a project's files fails with on purpose.
 *
 * @remarks
 * A caller catches this, or one of its subclasses; the CLI turns it into its
 * own error in one place. A failure nothing here anticipated, such as the
 * operating system refusing to read a file, is not one of these: it bubbles as
 * it was thrown.
 */
export class ProjectError extends Error implements Categorized {
  /** The kind of failure; a subclass states its own. */
  readonly category: ErrorCategory = "invalid";

  /** Whether the same request may succeed on a later attempt, with nothing changed. */
  readonly retryable: boolean = false;

  /**
   * The stable product code the failure is reported with, which is the one
   * its category has unless a class's condition has a code of its own.
   */
  get code(): ZitadelErrorCode {
    return codeOf(this.category);
  }

  /**
   * What to do about it.
   */
  readonly hint: string | undefined;

  /**
   * Structured facts about the failure, for a `--json` reader.
   */
  readonly details: Readonly<Record<string, unknown>> | undefined;

  /**
   * What to run next, as suggestion objects the failure handler renders with the
   * run's scope.
   */
  readonly nextCommands: readonly Suggested[] | undefined;

  /**
   * Make a project failure.
   *
   * @param message - What went wrong.
   * @param options - What to do about it, the facts behind it, and its cause.
   */
  constructor(message: string, options: ProjectErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.hint = options.hint;
    this.details = options.details;
    this.nextCommands = options.nextCommands;
  }
}

/**
 * Which of a project's two files a failure is about: `config` is `zitadel.json`
 * and `secret` is `.zitadel/secret`.
 */
export type ProjectFile = "config" | "secret";

/** What to do about the secret file, which `doctor --fix` restores from the development env file. */
const RESTORE_SECRET = {
  hint: "Restore the project secret from .env.development.local.",
  nextCommands: [{ id: "doctor", flags: { fix: true } }],
} as const satisfies ProjectErrorOptions;

/** What to do about a project with no configuration file. */
const SET_UP_FIRST = {
  hint: "Set the project up first.",
  nextCommands: [{ id: "setup" }],
} as const satisfies ProjectErrorOptions;

/** What to do about a configuration file that cannot be read. */
const FIX_CONFIG = {
  hint: "Fix zitadel.json, which is the project's committed configuration.",
} as const satisfies ProjectErrorOptions;

/**
 * A file the project is meant to have is not there.
 */
export class ProjectFileMissingError extends ProjectError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;

  /** The stable product code the failure is reported with. */
  override get code(): ZitadelErrorCode {
    return "E_VALIDATION";
  }

  /**
   * Which file is missing.
   */
  readonly file: ProjectFile;

  /**
   * Make the failure.
   *
   * @param file - Which file is missing.
   * @param message - What went wrong.
   * @param options - What to do about it, the facts behind it, and its cause.
   */
  constructor(file: ProjectFile, message: string, options: ProjectErrorOptions = {}) {
    super(message, { ...options, ...(file === "secret" ? RESTORE_SECRET : SET_UP_FIRST) });
    this.file = file;
  }
}

/**
 * A file the project has cannot be read as what it should be: it is not JSON,
 * not an object, or lacks what it must hold.
 */
export class ProjectFileMalformedError extends ProjectError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;

  /**
   * Which file is malformed.
   */
  readonly file: ProjectFile;

  /**
   * Make the failure.
   *
   * @param file - Which file is malformed.
   * @param message - What went wrong.
   * @param options - What to do about it, the facts behind it, and its cause.
   */
  constructor(file: ProjectFile, message: string, options: ProjectErrorOptions = {}) {
    super(message, { ...options, ...(file === "secret" ? RESTORE_SECRET : FIX_CONFIG) });
    this.file = file;
  }
}

/**
 * Why a value cannot be kept in a `.env` file: `line-break` is a value that
 * spans lines, and `unquotable` one that no quoting reads back unchanged.
 */
export type ProjectEnvValueReason = "line-break" | "unquotable";

/**
 * A value that a `.env` file cannot hold faithfully, so it is not written.
 */
export class ProjectEnvValueError extends ProjectError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;

  /**
   * Why the value cannot be kept.
   */
  readonly reason: ProjectEnvValueReason;

  /**
   * The variable whose value it is.
   */
  readonly key: string;

  /**
   * Make the failure.
   *
   * @param reason - Why the value cannot be kept.
   * @param key - The variable whose value it is.
   */
  constructor(reason: ProjectEnvValueReason, key: string) {
    super(
      reason === "line-break"
        ? `Cannot persist ${key}: its value contains a line break.`
        : `Cannot persist ${key}: no .env quoting reads its value back unchanged.`,
      {
        hint:
          reason === "line-break"
            ? "A .env value is a single line; remove the newline or store the value another way."
            : "Set it in the process environment instead of a .env file.",
      },
    );
    this.reason = reason;
    this.key = key;
  }
}
