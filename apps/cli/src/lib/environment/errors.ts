import type { Categorized, ErrorCategory } from "@/lib/errors";

/**
 * What an environment failure carries beyond its message.
 */
export type EnvironmentErrorOptions = {
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
 * Anything resolving an environment fails with on purpose.
 *
 * @remarks
 * A caller catches this, or one of its subclasses; the CLI turns it into its
 * own error in one place. A failure nothing here anticipated is not one of
 * these: it bubbles as it was thrown.
 */
export class EnvironmentError extends Error implements Categorized {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "EnvironmentError";

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
   * Make an environment failure.
   *
   * @param message - What went wrong.
   * @param options - What to do about it, the facts behind it, and its cause.
   */
  constructor(message: string, options: EnvironmentErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.hint = options.hint;
    this.details = options.details;
  }
}

/**
 * What is wrong with what the person gave: `name` is an environment name that
 * cannot be used in a path, `server-url` a server that is not a URL, and
 * `both-sources` an environment named and a file given for it as well.
 */
export type EnvironmentInvalidReason = "name" | "server-url" | "both-sources";

/**
 * What an invalid input carries for the command to word its advice.
 */
export type EnvironmentInvalidOptions = EnvironmentErrorOptions & {
  /**
   * What named the value: for a name, the flag, variable or default that did;
   * for a server, the file or flag that supplied it.
   */
  readonly source?: string | undefined;

  /**
   * A well-formed value of the same kind, to show.
   */
  readonly example?: string | undefined;
};

/**
 * An input the environment cannot be resolved from.
 */
export class EnvironmentInvalidError extends EnvironmentError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "EnvironmentInvalidError";
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;

  /**
   * What is wrong with it.
   */
  readonly reason: EnvironmentInvalidReason;

  /**
   * What named the value, when that matters.
   */
  readonly source: string | undefined;

  /**
   * A well-formed value of the same kind.
   */
  readonly example: string | undefined;

  /**
   * Make the failure.
   *
   * @param reason - What is wrong with the input.
   * @param message - What went wrong.
   * @param options - Where it came from, an example, the facts and the cause.
   */
  constructor(
    reason: EnvironmentInvalidReason,
    message: string,
    options: EnvironmentInvalidOptions = {},
  ) {
    super(message, options);
    this.reason = reason;
    this.source = options.source;
    this.example = options.example;
  }
}

/**
 * The file an environment was told to read does not exist.
 */
export class EnvironmentFileMissingError extends EnvironmentError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "EnvironmentFileMissingError";
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;

  /**
   * The path that was given.
   */
  readonly path: string;

  /**
   * Make the failure.
   *
   * @param path - The path that was given.
   * @param message - What went wrong.
   */
  constructor(path: string, message: string) {
    super(message, { details: { path } });
    this.path = path;
  }
}

/**
 * What a missing value needs the command to word its advice.
 */
export type EnvironmentValueMissingOptions = {
  /**
   * The variable that is not set.
   */
  readonly key: string;

  /**
   * The environment it is not set for.
   */
  readonly environment: string;

  /**
   * Every source the chain looked in, in order.
   */
  readonly consulted: readonly string[];

  /**
   * The file the value belongs in, when the run reads one.
   */
  readonly file: string | undefined;

  /**
   * The file an environment of this name binds its project in.
   */
  readonly boundFile: string;

  /**
   * Whether the environment has no project at all, so there is nothing to
   * add the value to yet.
   */
  readonly unbound: boolean;

  /**
   * The directory the run addressed.
   */
  readonly cwd: string;
};

/**
 * A value the command cannot run without is set in no source.
 */
export class EnvironmentValueMissingError extends EnvironmentError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "EnvironmentValueMissingError";
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;

  /**
   * The variable that is not set.
   */
  readonly key: string;

  /**
   * The environment it is not set for.
   */
  readonly environment: string;

  /**
   * Every source the chain looked in, in order.
   */
  readonly consulted: readonly string[];

  /**
   * The file the value belongs in, when the run reads one.
   */
  readonly file: string | undefined;

  /**
   * The file an environment of this name binds its project in.
   */
  readonly boundFile: string;

  /**
   * Whether the environment has no project at all.
   */
  readonly unbound: boolean;

  /**
   * The directory the run addressed.
   */
  readonly cwd: string;

  /**
   * Make the failure.
   *
   * @param options - The variable, the environment and where it was looked for.
   */
  constructor(options: EnvironmentValueMissingOptions) {
    super(`${options.key} is not set for the ${options.environment} environment`, {
      details: {
        environment: options.environment,
        variable: options.key,
        consulted: options.consulted,
      },
    });
    this.key = options.key;
    this.environment = options.environment;
    this.consulted = options.consulted;
    this.file = options.file;
    this.boundFile = options.boundFile;
    this.unbound = options.unbound;
    this.cwd = options.cwd;
  }
}
