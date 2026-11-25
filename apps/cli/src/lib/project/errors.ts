import { ZitadelLibError } from "@/lib/errors";
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
 * `zitadel.json` is not there: the directory is not a project that was set up.
 */
export class ProjectConfigMissingError extends ProjectError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * `.zitadel/secret` is not there.
 */
export class ProjectSecretMissingError extends ProjectError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * `.zitadel/secret` cannot be read as what it should be: it is not JSON, not an
 * object, or lacks what it must hold.
 */
export class ProjectMalformedError extends ProjectError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * A value that a `.env` file cannot hold as it is, so it is not written: it has
 * a line break, or no quoting reads it back unchanged.
 */
export class ProjectEnvValueError extends ProjectError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}
