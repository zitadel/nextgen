import { ZitadelLibError } from "@/lib/errors";
import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Anything reading the record of what was synced fails with on purpose.
 *
 * @remarks
 * A caller catches this, or one of its subclasses; the CLI turns it into its
 * own error in one place. A failure nothing here anticipated, such as the
 * operating system refusing to read the file, is not one of these: it bubbles
 * as it was thrown.
 */
export abstract class SyncError extends ZitadelLibError {}

/**
 * The state file is there but does not read as what it should be: it is not
 * JSON, or a section of it has the wrong shape.
 */
export class SyncStateMalformedError extends SyncError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * The state file as a whole does not read: it is not JSON, or it does not hold
 * an object. A {@link SyncStateMalformedError}, so a caller that catches that
 * kind catches this one too; its `cause` is the parser's error, when there is one.
 */
export class SyncStateUnreadableError extends SyncStateMalformedError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}
