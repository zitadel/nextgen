import { SERVER } from "@/constants";
import { Cmd } from "@/lib/cmd";
import { errorMessage, originalOf, ZitadelLibError } from "@/lib/errors";
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

  /** The address the record names, at which nothing healthy answered. */
  readonly serverUrl: string;

  /**
   * Creates the error.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param serverUrl - The address the record names.
   */
  constructor(message: string, serverUrl: string) {
    super(message);
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

  /** The folder that holds the record, which the commands point `--cwd` at. */
  readonly directory: string;

  /** The address the record names, at which nothing healthy answered. */
  readonly serverUrl: string;

  /**
   * Creates the error.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param directory - The folder that holds the record.
   * @param serverUrl - The address the record names.
   */
  constructor(message: string, directory: string, serverUrl: string) {
    super(message);
    this.directory = directory;
    this.serverUrl = serverUrl;
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
  override readonly hint: string =
    "Reinstall @zitadel/cli so npm can install @zitadel/server and its platform package.";

  /** The npm package that cannot be found. */
  readonly package: string;

  /** What looking for it failed with. */
  readonly failure: string;

  /**
   * Creates the error.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param pkg - The npm package that cannot be found.
   * @param cause - The failure that looking for it raised.
   */
  constructor(message: string, pkg: string, cause: unknown) {
    super(message, cause);
    this.package = pkg;
    this.failure = errorMessage(cause);
  }
}

/** The server binary was found but could not be launched. */
export class LocalServerLaunchFailedError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string =
    "Check that the server binary exists and can be run, or reinstall @zitadel/cli.";

  /** The server binary that was run. */
  readonly command: string;

  /** What running it failed with. */
  readonly failure: string;

  /**
   * Creates the error.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param command - The server binary that was run.
   * @param cause - The failure that running it raised.
   */
  constructor(message: string, command: string, cause: unknown) {
    super(message, cause);
    this.command = command;
    this.failure = errorMessage(cause);
  }
}

/** Docker answered, but a command the CLI ran with it failed. The message says what Docker said. */
export class LocalServerDockerFailedError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string =
    "Check that Docker is installed, running, and reachable from this shell.";

  /** The Docker command that was run. */
  readonly command: readonly string[];

  /** What Docker printed on stderr, when it ran and said something. */
  readonly stderr: string | undefined;

  /**
   * Creates the error.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param command - The Docker command that was run.
   * @param stderr - What Docker printed on stderr, when it ran.
   * @param cause - The failure running it raised, when it raised one.
   */
  constructor(
    message: string,
    command: readonly string[],
    stderr: string | undefined,
    cause?: unknown,
  ) {
    super(message, cause);
    this.command = command;
    this.stderr = stderr;
  }
}

/** The folder's env file exists but cannot be read. */
export class LocalServerEnvUnreadableError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /** The env file, which the refusal names. */
  readonly path: string;

  /** What reading it failed with. */
  readonly failure: string;

  /**
   * Creates the error.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param path - The env file, which the refusal names.
   * @param cause - The failure that reading it raised.
   */
  override readonly hint: string;

  constructor(message: string, path: string, cause: unknown) {
    super(message, cause);
    this.path = path;
    this.failure = errorMessage(cause);
    this.hint = `The file ${Cmd.quote(path)} exists but could not be read; fix its permissions or remove it.`;
  }

  /**
   * The file, and what reading it failed with.
   *
   * @returns The path, and the failure as `message`.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      path: this.path,
      message: this.failure,
    };
  }
}

/** The local admin file exists but cannot be read. */
export class LocalServerAdminUnreadableError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /** The admin file, which the refusal names. */
  readonly path: string;

  /** What reading it failed with. */
  readonly failure: string;

  /**
   * Creates the error.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param path - The admin file, which the refusal names.
   * @param cause - The failure that reading it raised.
   */
  constructor(message: string, path: string, cause: unknown) {
    super(message, cause);
    this.path = path;
    this.failure = errorMessage(cause);
  }
}

/** The local admin file is not in the shape it is written in. */
export class LocalServerAdminMalformedError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /** The admin file, which the refusal says to delete. */
  readonly path: string;

  /** The folder that holds the admin file, which a reset and a start must run in to replace it. */
  readonly directory: string;

  /** What parsing it failed with, when it did not parse. */
  readonly failure: string | undefined;

  /**
   * Creates the error.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param path - The admin file.
   * @param directory - The folder that holds it.
   * @param cause - The parse failure, when there is one.
   */
  constructor(message: string, path: string, directory: string, cause?: unknown) {
    super(message, cause);
    this.path = path;
    this.directory = directory;
    this.failure = cause === undefined ? undefined : errorMessage(cause);
  }
}

/** A reset was handed a permit for another folder than the one it acts on. */
export class LocalServerPermitMismatchError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string =
    "A reset acts on one folder only. Run it from the folder whose server you mean to reset.";
}

/**
 * The runtime record cannot be read and the machine's processes cannot be
 * listed, so nothing says whether a server still runs on the data.
 */
export class LocalServerProcessesUnlistableError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /** What listing the processes failed with, when it said. */
  readonly failure: string | undefined;

  /**
   * Creates the error.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param failure - What listing the processes failed with, when it said.
   */
  constructor(message: string, failure: string | undefined) {
    super(message);
    this.failure = failure;
  }
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
  override readonly hint: string = `Use a URL like ${SERVER}.`;
}

/** The local server does not host the platform project, so the local admin cannot sign in. */
export class LocalServerPlatformMissingError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string =
    "Stop it, then start it again so it boots with the platform project and the local admin.";

  /** The server that does not host it. */
  readonly serverUrl: string;

  /**
   * Make the failure.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param serverUrl - The server that does not host it.
   */
  constructor(message: string, serverUrl: string) {
    super(message);
    this.serverUrl = serverUrl;
  }
}

/** Another start is running in the folder, and still holds its lock. */
export class LocalServerBusyError extends LocalServerError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = true;
  override readonly code: ZitadelErrorCode = "E_CONFLICT";

  /** The lock file, which the refusal says to delete when no start runs. */
  readonly lockFile: string;

  /** The process the lock names as its owner, when it names one. */
  readonly ownerPid: number | undefined;

  /**
   * Creates the error.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param lockFile - The lock file the other start holds.
   * @param ownerPid - The process the lock names as its owner, when it names one.
   */
  override readonly hint: string;

  constructor(message: string, lockFile: string, ownerPid: number | undefined) {
    super(message);
    this.lockFile = lockFile;
    this.ownerPid = ownerPid;
    this.hint = `Wait for it to finish, or delete ${Cmd.quote(lockFile)} if no start is running.`;
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

  /** What Docker said, or that it said nothing. */
  readonly detail: string;

  /**
   * Creates the error.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param detail - What Docker said, or that it said nothing.
   * @param cause - The failure asking Docker raised, when it raised one.
   */
  constructor(message: string, detail: string, cause?: unknown) {
    super(message, cause);
    this.detail = detail;
  }
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
  override readonly hint: string = "Check file permissions or run with the right user.";

  /**
   * The error the operating system refused the signal with.
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
 * The server rejected the local admin's identifier: it never imported the
 * admin, or its lookup failed, which it reports the same way.
 */
export class LocalServerAdminNotFoundError extends LocalServerError {
  override readonly category: ErrorCategory = "denied";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_AUTH";
}

/** The server refused to exchange the local admin's handoff token for a session. */
export class LocalServerSessionRefusedError extends LocalServerError {
  override readonly category: ErrorCategory = "denied";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_AUTH";

  /** The HTTP status the exchange answered with, which the refusal reports. */
  readonly status: number;

  /**
   * Creates the error.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param status - The HTTP status the exchange answered with.
   */
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Every port in the search range was taken. */
export class LocalServerPortFullError extends LocalServerError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_PORT_IN_USE";

  /** The first port of the range searched. */
  readonly firstPort: number;

  /**
   * Make the failure.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param firstPort - The first port of the range searched.
   */
  constructor(message: string, firstPort: number) {
    super(message);
    this.firstPort = firstPort;
  }
}

/** The runtime record is not in the shape it is written in. */
export class LocalServerRecordMalformedError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /** The folder that holds the record, which a reset and a start must run in to replace it. */
  readonly directory: string;

  /**
   * Make the failure.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param directory - The folder that holds the record.
   */
  constructor(message: string, directory: string) {
    super(message);
    this.directory = directory;
  }
}

/** A server that had to be stopped was still running afterwards. */
export class LocalServerStopError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string =
    "Inspect the local runtime process and stop it manually, then rerun the command.";

  /** The record of the server that did not stop, when one server was stopped. */
  readonly runtime: object | undefined;

  /** What stopping that server did. */
  readonly stopResult: object | undefined;

  /** What stopping each process did, when several were stopped. */
  readonly stopResults: object | undefined;

  /**
   * Make the failure.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param stopped - The server's record and what stopping it did, or what stopping each process did.
   */
  constructor(
    message: string,
    stopped: Readonly<{
      runtime?: object;
      stopResult?: object;
      stopResults?: object;
    }>,
  ) {
    super(message);
    this.runtime = stopped.runtime;
    this.stopResult = stopped.stopResult;
    this.stopResults = stopped.stopResults;
  }
}

/** The runtime record exists but cannot be read. */
export class LocalServerRecordUnreadableError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /** The record, which the refusal names. */
  readonly path: string;

  /** What reading it failed with. */
  readonly failure: string;

  /**
   * Creates the error.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param path - The record, which the refusal names.
   * @param cause - The failure that reading it raised.
   */
  override readonly hint: string;

  constructor(message: string, path: string, cause: unknown) {
    super(message, cause);
    this.path = path;
    this.failure = errorMessage(cause);
    this.hint = `Check that ${Cmd.quote(path)} and its directory are readable by you.`;
  }

  /**
   * The record, and what reading it failed with.
   *
   * @returns The path, and the failure as `cause`.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      path: this.path,
      cause: this.failure,
    };
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

/** What is known of a server that was launched: where it was to answer, how it ran, and what it last logged. */
export type FailedStart = Readonly<{
  serverUrl: string;
  logTail?: string | undefined;
  runtime: string;
  pid?: number | undefined;
  logPath?: string | undefined;
  containerName?: string | undefined;
}>;

/** A server was launched and did not become ready. */
export abstract class LocalServerStartFailedError extends LocalServerError {
  /** The address the server was to answer on. */
  readonly serverUrl: string;

  /** The last lines the server logged, when there were any to read. */
  readonly logTail: string | undefined;

  /** Which runtime ran it: `binary` or `docker`. */
  readonly runtime: string;

  /** The process it ran as, for a binary server. */
  readonly pid: number | undefined;

  /** The file it logged to, for a binary server. */
  readonly logPath: string | undefined;

  /** The container it ran in, for a Docker server. */
  readonly containerName: string | undefined;

  /**
   * Make the failure.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param started - Where it was to answer, how it ran and what it last logged.
   */
  constructor(message: string, started: FailedStart) {
    super(message);
    this.serverUrl = started.serverUrl;
    this.logTail = started.logTail;
    this.runtime = started.runtime;
    this.pid = started.pid;
    this.logPath = started.logPath;
    this.containerName = started.containerName;
  }
}

/** A server was launched and exited before it became ready. */
export class LocalServerStartExitedError extends LocalServerStartFailedError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NETWORK";
}

/** A server was launched and did not become ready in time. */
export class LocalServerStartTimeoutError extends LocalServerStartFailedError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NETWORK";
}

/** A server was launched and did not become ready, and stopping it failed, so it may still be running. */
export class LocalServerStartCleanupFailedError extends LocalServerStartFailedError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NETWORK";

  /** Why it did not become ready: it exited, or it ran out of time. */
  readonly reason: "exited" | "timeout";

  /** What stopping it came to. */
  readonly stopResult: object;

  /**
   * Make the failure.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param started - Where it was to answer, how it ran and what it last logged.
   * @param reason - Why it did not become ready.
   * @param stopResult - What stopping it came to.
   */
  constructor(
    message: string,
    started: FailedStart,
    reason: "exited" | "timeout",
    stopResult: object,
  ) {
    super(message, started);
    this.reason = reason;
    this.stopResult = stopResult;
  }
}
