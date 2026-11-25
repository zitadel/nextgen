import type { Categorized, ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * What a publish failure carries beyond its message.
 */
export type PublishErrorOptions = {
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
 * Anything publishing a configuration refuses with on purpose.
 *
 * @remarks
 * A caller catches this, or one of its subclasses; the CLI turns it into its
 * own error in one place. A failure nothing here anticipated is not one of
 * these: it bubbles as it was thrown.
 */
export class PublishError extends Error implements Categorized {
  /** The kind of failure; a subclass states its own. */
  readonly category: ErrorCategory = "unknown";

  /** Whether the same request may succeed on a later attempt, with nothing changed. */
  readonly retryable: boolean = false;

  /** The stable product code the failure is reported with. */
  readonly code: ZitadelErrorCode = "E_VALIDATION";

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
  constructor(message: string, options: PublishErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.hint = options.hint;
    this.details = options.details;
  }
}

/**
 * Where a publish fails the configuration before anything is sent, as
 * the findings that stopped it.
 */
export type PublishFinding = {
  /** The rule that found it. */
  readonly rule: string;

  /** The file it is in. */
  readonly path: string;

  /** The steps of the flow it concerns, when the rule named any. */
  readonly steps?: readonly unknown[] | undefined;

  /** What is wrong. */
  readonly message: string;
};

/**
 * What a refused configuration needs the command to word its advice.
 */
export type PublishConfigInvalidOptions = PublishErrorOptions & {
  /**
   * Every finding that stopped the publish.
   */
  readonly findings: readonly PublishFinding[];

  /**
   * Whether one of them is a secret written into a file.
   */
  readonly literalSecret: boolean;

  /**
   * Whether one of them is a key this CLI does not know, which a newer server
   * may declare.
   */
  readonly refusedKey: boolean;
};

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
  readonly findings: readonly PublishFinding[];

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
  constructor(message: string, options: PublishConfigInvalidOptions) {
    super(message, {
      ...options,
      hint: "No changes were made.",
      details: options.details ?? { issues: options.findings },
    });
    this.findings = options.findings;
    this.literalSecret = options.literalSecret;
    this.refusedKey = options.refusedKey;
  }
}

/**
 * What a refused connection needs the command to word its advice.
 */
export type PublishConnectionOptions = PublishErrorOptions & {
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
  readonly field?: "client_id" | "client_secret" | undefined;

  /**
   * Whether the variable the project holds is a secret, when it holds one.
   */
  readonly isSecret?: boolean | undefined;

  /**
   * Which kind of publish was refused.
   */
  readonly mode?: "deploy" | "preview" | undefined;
};

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
  constructor(message: string, options: PublishConnectionOptions) {
    super(message, {
      ...options,
      hint: "The client id and the client secret each need a variable of their own.",
    });
    this.file = options.file;
    this.variable = options.variable;
    this.field = options.field;
    this.isSecret = options.isSecret;
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
  constructor(message: string, options: PublishConnectionOptions) {
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
  constructor(message: string, options: PublishConnectionOptions) {
    super(message, {
      ...options,
      hint: "The project does not hold the variable the connection names.",
    });
    this.file = options.file;
    this.variable = options.variable;
    this.field = options.field;
    this.isSecret = options.isSecret;
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
