import { originalOf, ZitadelLibError } from "@/lib/errors";
import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Anything reading or writing a project's files fails with on purpose.
 *
 * @remarks
 * A caller catches this, or one of its subclasses, and words the failure for
 * its own person. A failure nothing here anticipated, such as the operating
 * system refusing to read a file, is not one of these: it bubbles as it was
 * thrown.
 */
export abstract class ProjectError extends ZitadelLibError {}

/**
 * A file the project needs is not there: `zitadel.json` or `.zitadel/secret`.
 */
export abstract class ProjectFileMissingError extends ProjectError {}

/** The project has no `zitadel.json`: it was never set up. */
export class ProjectConfigMissingError extends ProjectFileMissingError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string = "Set the project up first.";
}

/** The project has no `.zitadel/secret`. */
export class ProjectSecretMissingError extends ProjectFileMissingError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * A project file or value cannot be used as it is: `.zitadel/secret` lacks a
 * field it must hold, or a value a `.env` file cannot hold has a line break or
 * no quoting that reads it back unchanged.
 */
export class ProjectInvalidError extends ProjectError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * The failure the file could not be used with.
   *
   * @returns It, as `original`.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      original: originalOf(this),
    };
  }
}

/** A value a `.env` file cannot hold, because it has a line break. */
export class ProjectEnvValueMultilineError extends ProjectInvalidError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string =
    "A .env value is a single line; remove the newline or store the value another way.";

  /**
   * Nothing beyond the message, which names the variable.
   *
   * @returns No facts.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {};
  }
}

/** A value a `.env` file cannot hold, because no quoting reads it back unchanged. */
export class ProjectEnvValueUnquotableError extends ProjectInvalidError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string = "Set it in the process environment instead of a .env file.";

  /**
   * Nothing beyond the message, which names the variable.
   *
   * @returns No facts.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {};
  }
}
