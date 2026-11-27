import { originalOf, ZitadelLibError } from "@/lib/errors";
import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Anything the telemetry package fails with on purpose: the Mixpanel client
 * could not be made, or refused a send. It throws plain `Error`s and
 * `TypeError`s for its own reasons, which this wraps, saying what it said.
 *
 * @remarks
 * Telemetry never fails a command: every one of these is caught inside the
 * package, where it turns into "send nothing" or "remember nothing".
 */
export class TelemetryError extends ZitadelLibError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * The error the failure stands for.
   *
   * @returns It, as `original`.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      original: originalOf(this),
    };
  }
}

/**
 * The machine's home directory cannot be found, as `os.homedir()` refuses in
 * some restricted or containerised environments.
 */
export class TelemetryHomeUnknownError extends TelemetryError {}
