import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Anything resolving an environment fails with on purpose.
 *
 * @remarks
 * A caller catches this, or one of its subclasses; the CLI turns it into its
 * own error in one place. A failure nothing here anticipated is not one of
 * these: it bubbles as it was thrown.
 */
export abstract class EnvironmentError extends Error {
  /** The kind of failure; a subclass states its own. */
  abstract readonly category: ErrorCategory;

  /** Whether the same request may succeed on a later attempt, with nothing changed. */
  abstract readonly retryable: boolean;

  /** The stable product code the failure is reported with. */
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
   * Make an environment failure.
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
 * An environment named by its name and by a file as well.
 */
export class EnvironmentSourcesConflictError extends EnvironmentError {
  override readonly category = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * Make the failure.
   *
   * @param message - What went wrong.
   */
  constructor(message: string) {
    super(message, {
      hint: "An environment is named by its name or by a file, not both.",
    });
  }
}

/**
 * An environment name that cannot be used in a path.
 */
export class EnvironmentNameInvalidError extends EnvironmentError {
  override readonly category = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * Make the failure.
   *
   * @param message - What went wrong.
   * @param source - The flag, variable or default that named it.
   */
  constructor(message: string, source: string) {
    super(message, {
      hint:
        `The ${source} environment name may use only letters, digits, dot, dash ` +
        'and underscore, may not contain "..", and may not be `local` or end in `.local`.',
    });
  }
}

/**
 * A server address a source supplied that is not a URL.
 */
export class EnvironmentServerInvalidError extends EnvironmentError {
  override readonly category = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * The file or flag that supplied it.
   */
  readonly source: string;

  /**
   * A well-formed address, to show.
   */
  readonly example: string;

  /**
   * Make the failure.
   *
   * @param message - What went wrong.
   * @param source - The file or flag that supplied it.
   * @param example - A well-formed address, to show.
   * @param options - The facts behind it, and the cause.
   */
  constructor(
    message: string,
    source: string,
    example: string,
    options: {
      readonly details?: Readonly<Record<string, unknown>> | undefined;
      readonly cause?: unknown;
    } = {},
  ) {
    super(message, {
      ...options,
      hint: `ZITADEL_URL from ${source} must be a URL such as ${example}.`,
    });
    this.source = source;
    this.example = example;
  }
}

/**
 * The file an environment was told to read does not exist.
 */
export class EnvironmentFileMissingError extends EnvironmentError {
  override readonly category = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

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
    super(message, {
      details: {
        path,
      },
    });
    this.path = path;
  }
}

/**
 * A value the command cannot run without is set in no source.
 */
export class EnvironmentValueMissingError extends EnvironmentError {
  override readonly category = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

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

  /**
   * Make the failure.
   *
   * @param message - What went wrong.
   * @param facts - The variable, the environment and where it was looked for.
   * @param facts.key - The variable that is not set.
   * @param facts.environment - The environment it is not set for.
   * @param facts.consulted - Every source the chain looked in, in order.
   * @param facts.file - The file the value belongs in, when the run reads one.
   * @param facts.boundFile - The file an environment of this name binds its project in.
   * @param facts.unbound - Whether the environment has no project at all.
   * @param facts.cwd - The directory the run addressed.
   */
  constructor(
    message: string,
    facts: {
      readonly key: string;
      readonly environment: string;
      readonly consulted: readonly string[];
      readonly file: string | undefined;
      readonly boundFile: string;
      readonly unbound: boolean;
      readonly cwd: string;
    },
  ) {
    super(message, {
      hint: `Consulted, in order: ${facts.consulted.join(", ")}.`,
      details: {
        environment: facts.environment,
        variable: facts.key,
        consulted: facts.consulted,
      },
    });
    this.key = facts.key;
    this.environment = facts.environment;
    this.consulted = facts.consulted;
    this.file = facts.file;
    this.boundFile = facts.boundFile;
    this.unbound = facts.unbound;
    this.cwd = facts.cwd;
  }
}
