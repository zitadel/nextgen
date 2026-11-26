import { ZitadelLibError } from "@/lib/errors";
import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Anything orca fails with on purpose.
 *
 * @remarks
 * A command that calls orca catches this, or one of its subclasses, and words
 * the failure itself. A failure nothing here anticipated is not one of these:
 * it bubbles as it was thrown.
 */
export abstract class OrcaError extends ZitadelLibError {}

/**
 * A directory with no app of a framework orca knows, or a framework orca has
 * no detector for: there is nothing to integrate with, so a new app could be
 * scaffolded into the directory.
 */
export class OrcaFrameworkMissingError extends OrcaError {
  override readonly category: ErrorCategory = "missing";
  override readonly code: ZitadelErrorCode = "E_FRAMEWORK_NOT_DETECTED";
  override readonly retryable: boolean = false;
}

/**
 * An app of a framework orca knows, in a shape or of a version it does not
 * integrate.
 */
export class OrcaFrameworkUnsupportedError extends OrcaError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_UNSUPPORTED_PROJECT_SHAPE";
  override readonly retryable: boolean = false;
}

/**
 * A request orca cannot act on as given: a scaffold that cannot start until
 * something in the way is dealt with (a Node the framework's tool refuses), a
 * file of the project a patch cannot edit because its content is not in a
 * shape the patch handles, or a renderer id that names none.
 */
export class OrcaInvalidError extends OrcaError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly retryable: boolean = false;
}

/**
 * A file a patch needs, and the project does not have.
 */
export class OrcaPatchFileMissingError extends OrcaError {
  override readonly category: ErrorCategory = "missing";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly retryable: boolean = false;
}

/**
 * A renderer that is declared and not published yet.
 */
export class OrcaRendererPendingError extends OrcaError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_NOT_IMPLEMENTED";
  override readonly retryable: boolean = false;
}

/**
 * A failure in this package: a bug, something that cannot happen unless the
 * code is wrong, or an external command a scaffold runs that could not be
 * spawned or exited non-zero.
 */
export class OrcaInternalError extends OrcaError {
  override readonly category: ErrorCategory = "fault";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly retryable: boolean = false;
}

/**
 * A request that conflicts with what the directory or the project already
 * holds: an app of another framework than the one asked for, a directory a
 * scaffold cannot start in, a file a patch would overwrite, or a file of the app
 * that would leave the integration broken.
 */
export class OrcaConflictError extends OrcaError {
  override readonly category: ErrorCategory = "conflict";
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly retryable: boolean = false;
}
