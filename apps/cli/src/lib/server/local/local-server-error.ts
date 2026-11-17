import { ZitadelError, type ZitadelErrorCode } from "@/lib/errors";

/**
 * What went wrong with a local server, as a closed set a command can switch
 * on. The package names the failure; the command that catches it decides what
 * to tell the reader to do about it.
 */
export type LocalServerErrorKind =
  | "not-running"
  | "not-responding"
  | "not-started"
  | "record-unreadable"
  | "record-malformed"
  | "admin-unreadable"
  | "admin-malformed"
  | "admin-not-found"
  | "env-unreadable"
  | "package-missing"
  | "cannot-launch"
  | "docker-failed"
  | "start-in-progress"
  | "session-exchange-failed"
  | "platform-missing"
  | "processes-did-not-stop"
  | "server-did-not-stop"
  | "permit-mismatch"
  | "docker-unavailable"
  | "no-free-port"
  | "port-in-use"
  | "server-did-not-start";

/**
 * A failure of the local server's own files, processes or sign-in.
 *
 * It carries a message and the facts behind it, and no advice: which command
 * to run next is the caller's to say, from the {@link kind}.
 */
export class LocalServerError extends ZitadelError {
  /** Which failure this is. */
  readonly kind: LocalServerErrorKind;

  /**
   * @param kind - Which failure this is.
   * @param code - The error code the CLI reports it under.
   * @param message - What went wrong, in one sentence.
   * @param details - The facts behind it, for a person debugging.
   */
  constructor(
    kind: LocalServerErrorKind,
    code: ZitadelErrorCode,
    message: string,
    details?: unknown,
  ) {
    super(code, message, { details });
    this.name = "LocalServerError";
    this.kind = kind;
  }
}
