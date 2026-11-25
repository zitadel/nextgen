import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Anything publishing a configuration refuses with on purpose.
 *
 * @remarks
 * A caller catches this, or one of its subclasses; the CLI turns it into its
 * own error in one place. A failure nothing here anticipated is not one of
 * these: it bubbles as it was thrown.
 */
export abstract class PublishError extends Error {
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
   * Make a publish failure.
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
 * The configuration has errors, so nothing was sent.
 */
export class PublishConfigInvalidError extends PublishError {
  override readonly category = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * Every finding that stopped the publish.
   */
  readonly findings: readonly {
    readonly rule: string;
    readonly path: string;
    readonly steps?: readonly unknown[] | undefined;
    readonly message: string;
  }[];

  /**
   * Whether one of them is a secret written into a file.
   */
  readonly literalSecret: boolean;

  /**
   * Whether one of them is a key this CLI does not know.
   */
  readonly refusedKey: boolean;

  /**
   * Make the failure.
   *
   * @param message - What went wrong, one line per finding.
   * @param options - The findings and what they say about the fix.
   */
  constructor(
    message: string,
    options: {
      readonly findings: readonly {
        readonly rule: string;
        readonly path: string;
        readonly steps?: readonly unknown[] | undefined;
        readonly message: string;
      }[];
      readonly literalSecret: boolean;
      readonly refusedKey: boolean;
      readonly details?: Readonly<Record<string, unknown>> | undefined;
    },
  ) {
    super(message, {
      ...options,
      hint: "No changes were made.",
      details: options.details ?? {
        issues: options.findings,
      },
    });
    this.findings = options.findings;
    this.literalSecret = options.literalSecret;
    this.refusedKey = options.refusedKey;
  }
}

/**
 * One variable named for both the client id and the client secret of a connection.
 */
export class PublishConnectionVariableSharedError extends PublishError {
  override readonly category = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * The connection file.
   */
  readonly file: string;

  /**
   * The variable it names.
   */
  readonly variable: string;

  /**
   * Which kind of publish was refused.
   */
  readonly mode: "deploy" | "preview" | undefined;

  /**
   * Make the failure.
   *
   * @param message - What went wrong.
   * @param options - The connection, the variable and the facts behind them.
   */
  constructor(
    message: string,
    options: {
      readonly file: string;
      readonly variable: string;
      readonly mode?: "deploy" | "preview" | undefined;
      readonly details?: Readonly<Record<string, unknown>> | undefined;
    },
  ) {
    super(message, {
      ...options,
      hint: "The client id and the client secret each need a variable of their own.",
    });
    this.file = options.file;
    this.variable = options.variable;
    this.mode = options.mode;
  }
}

/**
 * A connection names a variable of the wrong kind: a secret where a plain one is needed, or the reverse.
 */
export class PublishConnectionVariableKindError extends PublishError {
  override readonly category = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * The connection file.
   */
  readonly file: string;

  /**
   * The variable it names.
   */
  readonly variable: string;

  /**
   * The credential field that names it; absent when two fields share it.
   */
  readonly field: "client_id" | "client_secret" | undefined;

  /**
   * Whether the variable the project holds is a secret, when it holds one.
   */
  readonly isSecret: boolean | undefined;

  /**
   * Which kind of publish was refused.
   */
  readonly mode: "deploy" | "preview" | undefined;

  /**
   * Make the failure.
   *
   * @param message - What went wrong.
   * @param options - The connection, the variable and the facts behind them.
   */
  constructor(
    message: string,
    options: {
      readonly file: string;
      readonly variable: string;
      readonly field?: "client_id" | "client_secret" | undefined;
      readonly isSecret?: boolean | undefined;
      readonly mode?: "deploy" | "preview" | undefined;
      readonly details?: Readonly<Record<string, unknown>> | undefined;
    },
  ) {
    super(message, {
      ...options,
      hint: "The variable the project holds is not the kind the field needs.",
    });
    this.file = options.file;
    this.variable = options.variable;
    this.field = options.field;
    this.isSecret = options.isSecret;
    this.mode = options.mode;
  }
}

/**
 * A connection names a variable the project does not have.
 */
export class PublishConnectionVariableMissingError extends PublishError {
  override readonly category = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CREDENTIAL_MISSING";

  /**
   * The connection file.
   */
  readonly file: string;

  /**
   * The variable it names.
   */
  readonly variable: string;

  /**
   * The credential field that names it; absent when two fields share it.
   */
  readonly field: "client_id" | "client_secret" | undefined;

  /**
   * Which kind of publish was refused.
   */
  readonly mode: "deploy" | "preview" | undefined;

  /**
   * Make the failure.
   *
   * @param message - What went wrong.
   * @param options - The connection, the variable and the facts behind them.
   */
  constructor(
    message: string,
    options: {
      readonly file: string;
      readonly variable: string;
      readonly field?: "client_id" | "client_secret" | undefined;
      readonly mode?: "deploy" | "preview" | undefined;
      readonly details?: Readonly<Record<string, unknown>> | undefined;
    },
  ) {
    super(message, {
      ...options,
      hint: "The project does not hold the variable the connection names.",
    });
    this.file = options.file;
    this.variable = options.variable;
    this.field = options.field;
    this.mode = options.mode;
  }
}

/**
 * The release the files make is not one the API takes, so nothing was sent.
 */
export class PublishReleaseRejectedError extends PublishError {
  override readonly category = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}
