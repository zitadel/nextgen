import { ZitadelLibError } from "@/lib/errors";
import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Anything opening a browser fails with on purpose.
 */
export abstract class BrowserError extends ZitadelLibError {}

/**
 * The desktop's opener could not be started. The `open` package throws plain
 * `Error`s for this (a missing opener, an unsupported platform), which this wraps.
 */
export class BrowserLaunchError extends BrowserError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}
