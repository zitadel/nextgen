import { codeOf } from "@/lib/errors";
import type { Categorized, ErrorCategory, Suggested, ZitadelErrorCode } from "@/lib/errors";

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
   * What to run next, as suggestion objects the failure handler renders.
   */
  readonly nextCommands?: readonly Suggested[] | undefined;

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
   * Make an environment failure.
   *
   * @param message - What went wrong.
   * @param options - What to do about it, the facts behind it, and its cause.
   */
  constructor(message: string, options: EnvironmentErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.hint = options.hint;
    this.details = options.details;
    this.nextCommands = options.nextCommands;
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

/** What to do about an invalid input, by why, in words that name no flag. */
const INVALID_HINTS: Record<
  EnvironmentInvalidReason,
  (options: EnvironmentInvalidOptions) => string
> = {
  "both-sources": () => {
    return "An environment is named by its name or by a file, not both.";
  },
  name: (options) => {
    return (
      `The ${options.source} environment name may use only letters, digits, dot, dash ` +
      'and underscore, may not contain "..", and may not be `local` or end in `.local`.'
    );
  },
  "server-url": (options) => {
    return `Fix or remove ZITADEL_URL in ${options.source}; it must be a URL such as ${options.example}.`;
  },
};

/**
 * An input the environment cannot be resolved from.
 */
export class EnvironmentInvalidError extends EnvironmentError {
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
    super(message, { ...options, hint: INVALID_HINTS[reason](options) });
    this.reason = reason;
    this.source = options.source;
    this.example = options.example;
  }
}

/**
 * The file an environment was told to read does not exist.
 */
export class EnvironmentFileMissingError extends EnvironmentError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;

  /** The stable product code the failure is reported with. */
  override get code(): ZitadelErrorCode {
    return "E_VALIDATION";
  }

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
    const consulted = `Consulted, in order: ${options.consulted.join(", ")}.`;
    // Run in the directory this run addressed, which need not be the shell's:
    // `setup` and `env add` both write their files there.
    const elsewhere = options.cwd === process.cwd() ? {} : { cwd: options.cwd };
    super(`${options.key} is not set for the ${options.environment} environment`, {
      hint: options.unbound
        ? `${consulted} Set ${options.key} in ${options.boundFile} or the process environment.`
        : `${consulted} Set ${options.key} in ${options.file ?? `${options.boundFile} or the process environment`}${options.file === undefined ? "" : " or the process environment"}.`,
      details: {
        environment: options.environment,
        variable: options.key,
        consulted: options.consulted,
      },
      nextCommands: options.unbound
        ? [
            options.environment === "development"
              ? { id: "setup", flags: elsewhere }
              : { id: "env:add", args: { name: options.environment }, flags: elsewhere },
          ]
        : undefined,
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
