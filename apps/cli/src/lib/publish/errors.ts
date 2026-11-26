import { originalOf, ZitadelLibError } from "@/lib/errors";
import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Anything publishing a configuration refuses with on purpose.
 *
 * @remarks
 * Each subclass states its own category, retryable and code, and the message
 * carries the facts. A caller catches this to handle any of them, or a
 * subclass to handle one condition. A failure nothing here anticipated is not
 * one of these: it bubbles as it was thrown.
 */
export abstract class PublishError extends ZitadelLibError {}

/**
 * The configuration has errors, or a connection names variables that cannot serve it, so nothing was sent.
 */
export class PublishConfigInvalidError extends PublishError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string;

  /** Each finding the refusal is about, as `--json` lists it: its rule, file and message. */
  readonly issues: readonly unknown[];

  /** Whether a finding refuses a key a user schema does not allow, which a newer server may have added. */
  readonly refusedKey: boolean;

  /**
   * Make the failure.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param issues - Each finding it is about.
   * @param refusedKey - Whether a finding refuses a key a user schema does not allow.
   */
  constructor(message: string, issues: readonly unknown[], refusedKey: boolean) {
    super(message);
    this.issues = issues;
    this.refusedKey = refusedKey;
    this.hint = `Fix the files named above and rerun; no changes were made.${refusedKey ? " A key a newer Zitadel server added needs a CLI as new as the server." : ""}`;
  }

  /**
   * The findings, as `--json` lists them.
   *
   * @returns The issues.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      issues: this.issues,
    };
  }
}

/**
 * The release body read from disk does not match what the API takes, so nothing was sent.
 */
export class PublishReleaseBodyInvalidError extends PublishError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /** Each field the API does not take, as its schema reports it. */
  readonly issues: readonly unknown[];

  /**
   * Make the failure.
   *
   * @param message - What went wrong, with each field it is about.
   * @param issues - Each field the API does not take.
   */
  constructor(message: string, issues: readonly unknown[]) {
    super(message);
    this.issues = issues;
  }
}

/**
 * A connection's secret is written into its file instead of naming a variable.
 */
export class PublishConnectionSecretLiteralError extends PublishError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /** Each finding the refusal is about, as `--json` lists it: its rule, file and message. */
  readonly issues: readonly unknown[];

  /** Whether a finding refuses a key a user schema does not allow, which a newer server may have added. */
  readonly refusedKey: boolean;

  /**
   * Make the failure.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param issues - Each finding it is about.
   * @param refusedKey - Whether a finding refuses a key a user schema does not allow.
   */
  constructor(message: string, issues: readonly unknown[], refusedKey: boolean) {
    super(message);
    this.issues = issues;
    this.refusedKey = refusedKey;
  }
}

/**
 * A connection's client id and client secret name one variable.
 */
export class PublishConnectionVariableSharedError extends PublishError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string =
    "Give each its own variable: a plain one for the client id, a secret one for the client secret.";

  /** The variable both name. */
  readonly variable: string;

  /** The connection file that names it twice. */
  readonly file: string;

  /**
   * Make the failure.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param variable - The variable both name.
   * @param file - The connection file that names it twice.
   */
  constructor(message: string, variable: string, file: string) {
    super(message);
    this.variable = variable;
    this.file = file;
  }
}

/** How a connection names one of its credentials' variables, and what the run needs of it. */
export type ConnectionVariableUse = Readonly<{
  /** The variable the connection names. */
  variable: string;
  /** The credential that names it (`client_id`, `client_secret`). */
  field: string;
  /** The connection file. */
  file: string;
  /** Whether the connection needs it to be a secret. */
  secret: boolean;
  /** Whether the run looked it up among the preview values, for a preview. */
  preview: boolean;
}>;

/**
 * A connection names a variable the project does not have.
 */
export class PublishConnectionVariableMissingError extends PublishError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CREDENTIAL_MISSING";

  /** The variable the connection names. */
  readonly variable: string;

  /** The credential that names it. */
  readonly field: string;

  /** The connection file. */
  readonly file: string;

  /** Whether the connection needs it to be a secret. */
  readonly secret: boolean;

  /** Whether the run looked it up among the preview values. */
  readonly preview: boolean;

  /**
   * Make the failure.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param use - How the connection names the variable.
   */
  constructor(message: string, use: ConnectionVariableUse) {
    super(message);
    this.variable = use.variable;
    this.field = use.field;
    this.file = use.file;
    this.secret = use.secret;
    this.preview = use.preview;
  }
}

/**
 * A connection names a variable that is a secret where it needs a plain one, or the reverse.
 */
export class PublishConnectionVariableKindError extends PublishError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /** The variable the connection names. */
  readonly variable: string;

  /** The credential that names it. */
  readonly field: string;

  /** The connection file. */
  readonly file: string;

  /** Whether the connection needs it to be a secret. */
  readonly secret: boolean;

  /** Whether the run looked it up among the preview values. */
  readonly preview: boolean;

  /**
   * Make the failure.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param use - How the connection names the variable.
   */
  constructor(message: string, use: ConnectionVariableUse) {
    super(message);
    this.variable = use.variable;
    this.field = use.field;
    this.file = use.file;
    this.secret = use.secret;
    this.preview = use.preview;
  }
}

/**
 * A probed asset URL resolves to an address that is not public, so the probe does not send it a request.
 */
export class PublishAssetTargetUnsafeError extends PublishError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * The failure the probe refused the target with.
   *
   * @returns It, as `original`.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      original: originalOf(this),
    };
  }
}

/**
 * A probed asset's host name could not be resolved, so the probe cannot reach it.
 */
export class PublishAssetLookupFailedError extends PublishError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = true;
  override readonly code: ZitadelErrorCode = "E_NETWORK";

  /**
   * The failure the host name could not be resolved with.
   *
   * @returns It, as `original`.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      original: originalOf(this),
    };
  }
}
