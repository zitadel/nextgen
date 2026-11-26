import { ZitadelLibError } from "@/lib/errors";
import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";
import type { StopBinaryRuntimeResult } from "@/lib/server/local/internal/binary-launcher";
import type { ManagedRuntimeProcess } from "@/lib/server/local/processes";

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
}

/**
 * The local server a folder started is not running: it does not answer at the
 * address it recorded.
 */
export class LocalServerNotRespondingError extends LocalServerError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_LOCAL_SERVER_NOT_RUNNING";
}

/**
 * The local server a parent folder started is not running: it does not answer
 * at the address it recorded there.
 */
export class LocalServerNotRespondingElsewhereError extends LocalServerError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_LOCAL_SERVER_NOT_RUNNING";

  /** The folder that holds the record, which the commands point `--cwd` at. */
  readonly directory: string;

  /**
   * Creates the error.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param directory - The folder that holds the record.
   */
  constructor(message: string, directory: string) {
    super(message);
    this.directory = directory;
  }
}

/** The folder has no record of a start, so there is no server whose log to read. */
export class LocalServerNotStartedError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** The `@zitadel/server` npm package, or its platform package, cannot be found. */
export class LocalServerPackageMissingError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** The server binary was found but could not be launched. */
export class LocalServerLaunchFailedError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** Docker answered, but a command the CLI ran with it failed. The message says what Docker said. */
export class LocalServerDockerFailedError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** The folder's env file exists but cannot be read. */
export class LocalServerEnvUnreadableError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /** The env file, which the refusal names. */
  readonly path: string;

  /**
   * Creates the error.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param path - The env file.
   * @param cause - The failure that reading it raised.
   */
  constructor(message: string, path: string, cause?: unknown) {
    super(message, cause);
    this.path = path;
  }
}

/** The local admin file exists but cannot be read. */
export class LocalServerAdminUnreadableError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /** The admin file, which the refusal names. */
  readonly path: string;

  /**
   * Creates the error.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param path - The admin file.
   * @param cause - The failure that reading it raised.
   */
  constructor(message: string, path: string, cause?: unknown) {
    super(message, cause);
    this.path = path;
  }
}

/** The local admin file is not in the shape it is written in. */
export class LocalServerAdminMalformedError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /** The admin file, which the refusal says to delete. */
  readonly path: string;

  /**
   * Creates the error.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param path - The admin file.
   * @param cause - The parse failure, when there is one.
   */
  constructor(message: string, path: string, cause?: unknown) {
    super(message, cause);
    this.path = path;
  }
}

/** A reset was handed a permit for another folder than the one it acts on. */
export class LocalServerPermitMismatchError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * The runtime record cannot be read and the machine's processes cannot be
 * listed, so nothing says whether a server still runs on the data.
 */
export class LocalServerProcessesUnlistableError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** Stopping every managed server left at least one process running. */
export class LocalServerStopAllFailedError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /** What stopping each process came to, which the refusal reports. */
  readonly results: ReadonlyArray<
    Readonly<{
      process: ManagedRuntimeProcess;
      stop_result: StopBinaryRuntimeResult;
    }>
  >;

  /**
   * Creates the error.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param results - What stopping each process came to.
   */
  constructor(
    message: string,
    results: ReadonlyArray<
      Readonly<{
        process: ManagedRuntimeProcess;
        stop_result: StopBinaryRuntimeResult;
      }>
    >,
  ) {
    super(message);
    this.results = results;
  }
}

/** A server address that is not an http(s) URL. */
export class LocalServerUrlInvalidError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** The local server does not host the platform project, so the local admin cannot sign in. */
export class LocalServerPlatformMissingError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** Another start is running in the folder, and still holds its lock. */
export class LocalServerBusyError extends LocalServerError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = true;
  override readonly code: ZitadelErrorCode = "E_CONFLICT";

  /** The lock file, which the refusal says to delete when no start runs. */
  readonly lockFile: string;

  /**
   * Creates the error.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param lockFile - The lock file the other start holds.
   */
  constructor(message: string, lockFile: string) {
    super(message);
    this.lockFile = lockFile;
  }
}

/**
 * Docker cannot be run, so a Docker start cannot begin. The message says what
 * Docker said.
 */
export class LocalServerDockerMissingError extends LocalServerError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NETWORK";
}

/**
 * A program the CLI asked the machine about (`lsof`, `ps`) could not answer:
 * it is not installed, exited non-zero, or ran past its timeout. The message
 * says what running it said.
 */
export class LocalServerProgramFailedError extends LocalServerError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NETWORK";
}

/** A process the CLI signalled does not exist, so there is nothing to signal. */
export class LocalServerProcessGoneError extends LocalServerError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NETWORK";
}

/** A process the CLI signalled exists but belongs to someone the CLI may not signal. */
export class LocalServerProcessDeniedError extends LocalServerError {
  override readonly category: ErrorCategory = "denied";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_AUTH";
}

/** The server does not know the local admin, or refused its session. */
export class LocalServerDeniedError extends LocalServerError {
  override readonly category: ErrorCategory = "denied";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_AUTH";
}

/** Every port in the search range was taken. */
export class LocalServerPortFullError extends LocalServerError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_PORT_IN_USE";
}

/** The runtime record is not in the shape it is written in. */
export class LocalServerRecordMalformedError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** A server that had to be stopped was still running afterwards. */
export class LocalServerStopError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** The runtime record exists but cannot be read. */
export class LocalServerRecordUnreadableError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /** The record, which the refusal names. */
  readonly path: string;

  /**
   * Creates the error.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param path - The record that cannot be read.
   * @param cause - The failure that reading it raised.
   */
  constructor(message: string, path: string, cause?: unknown) {
    super(message, cause);
    this.path = path;
  }
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
