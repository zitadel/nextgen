import { errorMessage, ZitadelLibError } from "@/lib/errors";
import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Anything the local server package fails with on purpose.
 *
 * @remarks
 * Each subclass states its own category, retryable and code, and the message
 * carries the facts. A caller catches this to handle any of them, or a
 * subclass to handle one condition.
 */
export abstract class LocalServerError extends ZitadelLibError {}

/** No local server was started in this folder or a parent. */
export class LocalServerNotRunningError extends LocalServerError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_LOCAL_SERVER_NOT_RUNNING";

  /** Creates the error. */
  constructor() {
    super("Local Zitadel server is not running");
  }
}

/** The local runtime has not been started, so it has no record to read. */
export class LocalServerNotStartedError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /** Creates the error. */
  constructor() {
    super("Local Zitadel runtime has not been started");
  }
}

/**
 * The local server a folder started is not running: it does not answer at the
 * address it recorded.
 */
export class LocalServerNotRespondingError extends LocalServerError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_LOCAL_SERVER_NOT_RUNNING";

  /** The address the record names. */
  readonly serverUrl: string;

  /**
   * Creates the error.
   *
   * @param serverUrl - The address the record names.
   */
  constructor(serverUrl: string) {
    super("Local Zitadel server is not running");
    this.serverUrl = serverUrl;
  }
}

/**
 * The local server a parent folder started is not running: it does not answer
 * at the address it recorded there.
 */
export class LocalServerNotRespondingElsewhereError extends LocalServerError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_LOCAL_SERVER_NOT_RUNNING";

  /** The address the record names. */
  readonly serverUrl: string;

  /** The folder that holds the record. */
  readonly directory: string;

  /**
   * Creates the error.
   *
   * @param serverUrl - The address the record names.
   * @param directory - The folder that holds the record.
   */
  constructor(serverUrl: string, directory: string) {
    super("Local Zitadel server is not running");
    this.serverUrl = serverUrl;
    this.directory = directory;
  }
}

/** The runtime record is not in the shape it is written in. */
export class LocalServerRecordMalformedError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** The local admin file is not in the shape it is written in. */
export class LocalServerAdminFileMalformedError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** The address a server was named by is not an http(s) URL. */
export class LocalServerUrlInvalidError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** Another start is running in the folder, and still holds its lock. */
export class LocalServerBusyError extends LocalServerError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = true;
  override readonly code: ZitadelErrorCode = "E_CONFLICT";

  /**
   * Creates the error.
   *
   * @param lockFile - The lock file.
   * @param ownerPid - The pid that owns it, when it could be read.
   */
  constructor(lockFile: string, ownerPid: number | undefined) {
    super(
      `Another \`zitadel start\` is still running in this directory; lock file ${lockFile}, owner pid ${String(ownerPid)}`,
    );
  }
}

/** A server that had to be stopped was still running afterwards. */
export class LocalServerStopError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** Some managed local runtime processes were still running after they were stopped. */
export class LocalServerProcessesStopError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** The machine cannot list its processes, so it cannot say whether a server still runs. */
export class LocalServerProcessesUnlistableError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** A `docker` call ran and failed. */
export class LocalServerDockerFailedError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** A reset was asked for in a folder other than the one its permit is for. */
export class LocalServerPermitMismatchError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** A process on the folder's data was still running after a reset stopped it. */
export class LocalServerOrphansStopError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * Docker cannot be run, so a Docker start cannot begin. The message says what
 * Docker said.
 */
export class LocalServerDockerMissingError extends LocalServerError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NETWORK";

  /**
   * Creates the error.
   *
   * @param reason - What asking Docker failed with: its error, or the text it printed.
   */
  constructor(reason: unknown) {
    super(`Docker is not reachable: ${errorMessage(reason).trim() || "no reason given"}`, reason);
  }
}

/** The server program, `@zitadel/server`, is not installed. */
export class LocalServerBinaryMissingError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** The server program, `@zitadel/server`, is installed and cannot be run. */
export class LocalServerBinaryBlockedError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** The runtime record exists but cannot be read. */
export class LocalServerRecordUnreadableError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** The local admin file exists but cannot be read. */
export class LocalServerAdminUnreadableError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** An environment file the local server reads exists but cannot be read. */
export class LocalServerEnvUnreadableError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** The server does not know the local admin. */
export class LocalServerAdminRejectedError extends LocalServerError {
  override readonly category: ErrorCategory = "denied";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_AUTH";
}

/** The server refused the local admin's session. */
export class LocalServerAdminSessionError extends LocalServerError {
  override readonly category: ErrorCategory = "denied";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_AUTH";
}

/** The server does not host the platform project the local admin signs in to. */
export class LocalServerAdminPlatformMissingError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** A port that was explicitly asked for is held, so the start is refused rather than moved. */
export class LocalServerPortBusyError extends LocalServerError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_PORT_IN_USE";

  /** The port that is held, which the start command suggests moving off. */
  readonly port: number;

  /**
   * Creates the error.
   *
   * @param port - The port that was asked for.
   */
  constructor(port: number) {
    super(`Port ${String(port)} is already in use`);
    this.port = port;
  }
}

/** Every port in the search range was taken. */
export class LocalServerPortFullError extends LocalServerError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_PORT_IN_USE";

  /**
   * Creates the error.
   *
   * @param firstPort - The first port of the range.
   * @param lastPort - The last port of the range.
   */
  constructor(firstPort: number, lastPort: number) {
    super(`No free port from ${String(firstPort)} to ${String(lastPort)}`);
  }
}

/** A server was launched and exited before it became ready. The message carries what it logged. */
export class LocalServerStartExitedError extends LocalServerError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NETWORK";
}

/** A server was launched and did not become ready in time. The message carries what it logged. */
export class LocalServerStartTimeoutError extends LocalServerError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NETWORK";
}

/** A server was launched and did not become ready, and stopping it failed, so it may still be running. The message carries what it logged. */
export class LocalServerStartCleanupFailedError extends LocalServerError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NETWORK";
}
