import { ZitadelLibError } from "@/lib/errors";
import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Anything choosing or describing an identity provider fails with on purpose.
 *
 * @remarks
 * Each subclass states its own category, retryable and code, and the message
 * carries the facts. A caller catches this to handle any of them, or a
 * subclass to handle one condition.
 */
export abstract class IdpError extends ZitadelLibError {}

/**
 * A custom connection's setting the platform refuses.
 */
export class IdpSettingsInvalidError extends IdpError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * The flag that carried the setting, as the command spells it.
   */
  readonly flag: string;

  /**
   * Make the failure for this setting.
   *
   * @param flag - The flag that carried the setting, as the command spells it.
   * @param problem - Why the platform refuses it.
   */
  constructor(flag: string, problem: string) {
    super(`${flag}: ${problem}`);
    this.flag = flag;
  }
}

/**
 * Custom connection settings given beside a catalog provider, which knows its
 * own.
 */
export class IdpSettingsUnusedError extends IdpError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * The flags given, as the command spells them.
   */
  readonly flags: readonly string[];

  /**
   * The flag that names the provider, as the command spells it.
   */
  readonly providerFlag: string;

  /**
   * Make the failure for these flags.
   *
   * @param flags - The flags given, as the command spells them.
   * @param providerFlag - The flag that names the provider.
   */
  constructor(flags: readonly string[], providerFlag: string) {
    super(`${flags.join(", ")} only applies to a custom connection`);
    this.flags = flags;
    this.providerFlag = providerFlag;
  }
}

/**
 * A custom connection described without every setting it needs.
 */
export class IdpSettingsMissingError extends IdpError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * The flags left out, as the command spells them.
   */
  readonly missing: readonly string[];

  /**
   * A complete command line that describes a connection.
   */
  readonly example: string;

  /**
   * Make the failure for these flags.
   *
   * @param missing - The flags left out, as the command spells them.
   * @param example - A complete command line that describes a connection.
   */
  constructor(missing: readonly string[], example: string) {
    super(`A custom connection needs ${missing.join(", ")}`);
    this.missing = missing;
    this.example = example;
  }
}

/**
 * The provider named is neither one in the catalog nor a custom connection.
 */
export class IdpProviderUnknownError extends IdpError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string;

  /**
   * Make the failure for this name.
   *
   * @param provider - The name given.
   * @param known - Every provider the command takes.
   */
  constructor(provider: string, known: readonly string[]) {
    super(`Unknown provider ${provider}`);
    this.hint = `Use one of ${known.join(", ")}.`;
  }
}
