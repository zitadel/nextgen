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
 * A file the project needs is not there: `zitadel.json` or `.zitadel/secret`.
 */
export class ProjectFileMissingError extends ProjectError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * A project file or value cannot be used as it is: `.zitadel/secret` is not
 * JSON, not an object or lacks what it must hold, or a value a `.env` file
 * cannot hold has a line break or no quoting that reads it back unchanged.
 */
export class ProjectInvalidError extends ProjectError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}
