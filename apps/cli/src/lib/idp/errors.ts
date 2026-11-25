import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Anything choosing or describing an identity provider fails with on purpose.
 *
 * @remarks
 * A caller catches this, or one of its subclasses; the CLI turns it into its
 * own error in one place, wording the advice with its flags.
 */
export abstract class IdpError extends Error {
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
   * Make an identity-provider failure.
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
 * A setting of a custom connection that the platform refuses.
 */
export class IdpSettingRefusedError extends IdpError {
  override readonly category = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * The setting a value was refused for, as the caller names it.
   */
  readonly flag: string;

  /**
   * Make the failure.
   *
   * @param message - What went wrong.
   * @param flag - The setting a value was refused for, as the caller names it.
   */
  constructor(message: string, flag: string) {
    super(message, {
      details: {
        flag,
      },
    });
    this.flag = flag;
  }
}

/**
 * Settings that describe a custom connection, given with a catalog provider.
 */
export class IdpSettingsConflictError extends IdpError {
  override readonly category = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * The settings that were given and do not belong, as the caller names them.
   */
  readonly given: readonly string[];

  /**
   * Make the failure.
   *
   * @param message - What went wrong.
   * @param given - The settings that were given and do not belong.
   */
  constructor(message: string, given: readonly string[]) {
    super(message, {
      hint: "A catalog provider knows its own name, issuer and scopes.",
      details: {
        flags: given,
      },
    });
    this.given = given;
  }
}

/**
 * A custom connection that lacks settings it needs.
 */
export class IdpSettingsMissingError extends IdpError {
  override readonly category = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * The settings a custom connection needs and lacks, as the caller names them.
   */
  readonly missing: readonly string[];

  /**
   * Make the failure.
   *
   * @param message - What went wrong.
   * @param missing - The settings a custom connection needs and lacks.
   */
  constructor(message: string, missing: readonly string[]) {
    super(message, {
      hint: "A custom connection is described by its slug, display name and issuer.",
      details: {
        missing,
      },
    });
    this.missing = missing;
  }
}

/**
 * The provider named is neither one in the catalog nor a custom connection.
 */
export class IdpProviderUnknownError extends IdpError {
  override readonly category = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * The name that was given.
   */
  readonly provider: string;

  /**
   * The names that would have been understood.
   */
  readonly known: readonly string[];

  /**
   * Make the failure.
   *
   * @param provider - The name that was given.
   * @param known - The names that would have been understood.
   */
  constructor(provider: string, known: readonly string[]) {
    super(`Unknown provider ${provider}`, {
      hint: `Known providers: ${known.join(", ")}.`,
    });
    this.provider = provider;
    this.known = known;
  }
}
