import { ZitadelLibError } from "@/lib/errors";
import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Anything the telemetry package fails with on purpose.
 *
 * @remarks
 * Telemetry never fails a command: every one of these is caught inside the
 * package, where it turns into "send nothing" or "remember nothing".
 */
export abstract class TelemetryError extends ZitadelLibError {}

/**
 * The machine's home directory cannot be found, as `os.homedir()` refuses in
 * some restricted or containerised environments.
 */
export class TelemetryHomeUnknownError extends TelemetryError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * The Mixpanel client could not be made, or refused a send: it throws plain
 * `Error`s and `TypeError`s for its own reasons, which this wraps.
 */
export class TelemetryClientError extends TelemetryError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NETWORK";
}
