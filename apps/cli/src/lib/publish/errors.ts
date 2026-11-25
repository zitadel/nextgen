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
   * Make the failure.
   *
   * @param message - What went wrong, one line per finding.
   * @param options - The findings.
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
    },
  ) {
    super(message, {
      hint: "No changes were made.",
      details: {
        issues: options.findings,
      },
    });
    this.findings = options.findings;
  }
}

/**
 * The configuration has errors, one of them a key this CLI does not know, so nothing was sent.
 */
export class PublishConfigRefusedKeyError extends PublishError {
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
   * Make the failure.
   *
   * @param message - What went wrong, one line per finding.
   * @param options - The findings.
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
    },
  ) {
    super(message, {
      hint: "No changes were made.",
      details: {
        issues: options.findings,
      },
    });
    this.findings = options.findings;
  }
}

/**
 * The configuration has errors, one of them a secret written into a file, so nothing was sent.
 */
export class PublishConfigLiteralSecretError extends PublishError {
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
   * Make the failure.
   *
   * @param message - What went wrong, one line per finding.
   * @param options - The findings.
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
    },
  ) {
    super(message, {
      hint: "No changes were made.",
      details: {
        issues: options.findings,
      },
    });
    this.findings = options.findings;
  }
}

/**
 * The configuration has errors, one a secret written into a file and one a key this CLI does not know, so nothing was sent.
 */
export class PublishConfigLiteralSecretRefusedKeyError extends PublishError {
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
   * Make the failure.
   *
   * @param message - What went wrong, one line per finding.
   * @param options - The findings.
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
    },
  ) {
    super(message, {
      hint: "No changes were made.",
      details: {
        issues: options.findings,
      },
    });
    this.findings = options.findings;
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
 * A connection names a plain variable where its client secret needs a secret one.
 */
export class PublishConnectionVariableNotSecretError extends PublishError {
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
      hint: "The client secret needs a secret variable, and the project holds a plain one.",
    });
    this.file = options.file;
    this.variable = options.variable;
    this.mode = options.mode;
  }
}

/**
 * A connection names a secret variable where its client id needs a plain one.
 */
export class PublishConnectionVariableNotPlainError extends PublishError {
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
      hint: "The client id needs a plain variable, and the project holds a secret one.",
    });
    this.file = options.file;
    this.variable = options.variable;
    this.mode = options.mode;
  }
}

/**
 * A connection names a variable for its client id that the project does not have.
 */
export class PublishConnectionVariableClientIdMissingError extends PublishError {
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
      hint: "The project does not hold the variable the client id names.",
    });
    this.file = options.file;
    this.variable = options.variable;
    this.mode = options.mode;
  }
}

/**
 * A connection names a variable for its client secret that the project does not have.
 */
export class PublishConnectionVariableClientSecretMissingError extends PublishError {
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
      hint: "The project does not hold the variable the client secret names.",
    });
    this.file = options.file;
    this.variable = options.variable;
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
