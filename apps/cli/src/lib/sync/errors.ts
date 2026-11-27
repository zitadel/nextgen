import { originalOf, ZitadelLibError } from "@/lib/errors";
import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Where the state file lives, relative to the project root.
 */
export const STATE_PATH = ".zitadel/state.json";

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
  override readonly hint: string | undefined =
    "The file records which platform resource each local file was synced as. Fix or remove it, then run this command again.";

  /**
   * The state file.
   *
   * @returns Its path, as `file`.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      file: STATE_PATH,
    };
  }
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
  override readonly hint: string | undefined = undefined;

  /**
   * The failure the state file could not be read with.
   *
   * @returns It, as `original`.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      original: originalOf(this),
    };
  }
}
