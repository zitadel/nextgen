import type { Categorized, ErrorCategory } from "@/lib/errors";

/**
 * What an identity-provider failure carries beyond its message.
 */
export type IdpErrorOptions = {
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
 * Anything choosing or describing an identity provider fails with on purpose.
 *
 * @remarks
 * A caller catches this, or one of its subclasses; the CLI turns it into its
 * own error in one place, wording the advice with its flags.
 */
export class IdpError extends Error implements Categorized {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "IdpError";

  /** The kind of failure; a subclass states its own. */
  readonly category: ErrorCategory = "validation";

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
  constructor(message: string, options: IdpErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.hint = options.hint;
    this.details = options.details;
  }
}

/**
 * What is wrong with the settings of a custom connection: `invalid` is one the
 * platform refuses, `conflicting` is custom-only settings given with a catalog
 * provider, and `missing` is a custom connection without a setting it needs.
 */
export type IdpSettingReason = "invalid" | "conflicting" | "missing";

/**
 * What is wrong with the settings, as the names the caller gave them.
 */
export type IdpSettingFacts = {
  /**
   * The setting a value was refused for, as the caller names it.
   */
  readonly field?: string | undefined;

  /**
   * The settings that were given and do not belong.
   */
  readonly given?: readonly string[] | undefined;

  /**
   * The setting that chooses the provider, as the caller names it.
   */
  readonly providerField?: string | undefined;

  /**
   * The settings a custom connection needs and lacks.
   */
  readonly missing?: readonly string[] | undefined;

  /**
   * A complete description of a connection, to copy.
   */
  readonly example?: string | undefined;
};

/**
 * The settings given for a provider cannot be used.
 */
export class IdpSettingInvalidError extends IdpError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "IdpSettingInvalidError";
  override readonly category: ErrorCategory = "validation";

  /**
   * What is wrong with the settings.
   */
  readonly reason: IdpSettingReason;

  /**
   * What the settings were, as the caller names them.
   */
  readonly facts: IdpSettingFacts;

  /**
   * Make the failure.
   *
   * @param reason - What is wrong with the settings.
   * @param message - What went wrong.
   * @param facts - The names the caller gave the settings.
   * @param options - The structured facts and the cause.
   */
  constructor(
    reason: IdpSettingReason,
    message: string,
    facts: IdpSettingFacts,
    options: IdpErrorOptions = {},
  ) {
    super(message, options);
    this.reason = reason;
    this.facts = facts;
  }
}

/**
 * The provider named is neither one in the catalog nor a custom connection.
 */
export class IdpProviderUnknownError extends IdpError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "IdpProviderUnknownError";
  override readonly category: ErrorCategory = "not_found";

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
    super(`Unknown provider ${provider}`, { hint: `Use one of ${known.join(", ")}.` });
    this.provider = provider;
    this.known = known;
  }
}
