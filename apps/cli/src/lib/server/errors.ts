import { errorMessage } from "@/lib/errors";
import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";
import type { ServerRecord, StopOutcome } from "@/lib/server/local/internal/lifecycle";

/**
 * Anything the local server package fails with on purpose.
 *
 * @remarks
 * Each subclass states its own message, category, retryable, code, hint, facts
 * and cause. A caller catches this to handle any of them, or a subclass to
 * handle one condition.
 */
export abstract class LocalServerError extends Error {
  /** The kind of failure, which the boundary reports it as. */
  abstract readonly category: ErrorCategory;

  /** Whether the same request may succeed on a later attempt, with nothing changed. */
  abstract readonly retryable: boolean;

  /** The stable product code the failure is reported with. */
  abstract readonly code: ZitadelErrorCode;

  /** What the failure is about, in words that name no command or flag. */
  abstract readonly hint: string | undefined;

  /** Structured facts about the failure, for a `--json` reader. */
  readonly details: Readonly<Record<string, unknown>> | undefined;

  /**
   * Creates the error.
   *
   * @param message - What went wrong, in one sentence.
   * @param options - The facts behind it and the error that caused it.
   */
  constructor(
    message: string,
    options: {
      details?: Readonly<Record<string, unknown>> | undefined;
      cause?: unknown;
    } = {},
  ) {
    super(
      message,
      options.cause === undefined
        ? undefined
        : {
            cause: options.cause,
          },
    );
    this.name = new.target.name;
    this.details = options.details;
  }
}

/** No local server was started in this folder or a parent. */
export class LocalServerNotRunningError extends LocalServerError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_LOCAL_SERVER_NOT_RUNNING";
  override readonly hint: string | undefined =
    "No local server has been started in this directory or a parent.";

  /**
   * Creates the error.
   *
   * @param details - The address the record names.
   */
  constructor(details: Readonly<Record<string, unknown>>) {
    super("Local Zitadel server is not running", {
      details,
    });
  }
}

/** The local runtime has not been started, so it has no record to read. */
export class LocalServerNotStartedError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string | undefined = "The local runtime has not been started.";

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
  override readonly hint: string | undefined =
    "No healthy local server responded at the recorded address.";

  /** The address the record names. */
  readonly serverUrl: string;

  /**
   * Creates the error.
   *
   * @param details - The address the record names and the folder that holds it.
   */
  constructor(details: { readonly server_url: string; readonly directory: string | undefined }) {
    super("Local Zitadel server is not running", {
      details,
    });
    this.serverUrl = details.server_url;
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
  override readonly hint: string | undefined =
    "No healthy local server responded at the recorded address, which another folder holds.";

  /** The address the record names. */
  readonly serverUrl: string;

  /** The folder that holds the record. */
  readonly directory: string;

  /**
   * Creates the error.
   *
   * @param details - The address the record names and the folder that holds it.
   */
  constructor(details: { readonly server_url: string; readonly directory: string }) {
    super("Local Zitadel server is not running", {
      details,
    });
    this.serverUrl = details.server_url;
    this.directory = details.directory;
  }
}

/** The runtime record is not in the shape it is written in. */
export class LocalServerRecordMalformedError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string | undefined =
    "The runtime record is not in the shape it is written in.";

  /**
   * Creates the error.
   *
   * @param message - What is wrong with it.
   * @param options - The facts behind it and the error that caused it.
   */
  constructor(
    message: string,
    options: {
      details?: Readonly<Record<string, unknown>> | undefined;
      cause?: unknown;
    } = {},
  ) {
    super(message, options);
  }
}

/** The runtime record another folder holds is not in the shape it is written in. */
export class LocalServerRecordMalformedElsewhereError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string | undefined =
    "The runtime record another folder holds is not in the shape it is written in.";

  /** The folder that holds the record. */
  readonly directory: string;

  /**
   * Creates the error.
   *
   * @param message - What is wrong with it.
   * @param directory - The folder that holds the record.
   * @param options - The facts behind it and the error that caused it.
   */
  constructor(
    message: string,
    directory: string,
    options: {
      details?: Readonly<Record<string, unknown>> | undefined;
      cause?: unknown;
    } = {},
  ) {
    super(message, options);
    this.directory = directory;
  }
}

/** The local admin file is not in the shape it is written in. */
export class LocalServerAdminFileMalformedError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string | undefined =
    "The local admin file is not in the shape it is written in.";

  /** The file. */
  readonly path: string;

  /**
   * Creates the error.
   *
   * @param message - What is wrong with it.
   * @param path - The file.
   * @param options - The facts behind it and the error that caused it.
   */
  constructor(
    message: string,
    path: string,
    options: {
      details?: Readonly<Record<string, unknown>> | undefined;
      cause?: unknown;
    } = {},
  ) {
    super(message, options);
    this.path = path;
  }
}

/** The address a server was named by is not an http(s) URL. */
export class LocalServerUrlInvalidError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string | undefined;

  /**
   * Creates the error.
   *
   * @param message - What is wrong with the address.
   * @param options - What to use instead, the facts behind it and the error that caused it.
   */
  constructor(
    message: string,
    options: {
      hint?: string | undefined;
      details?: Readonly<Record<string, unknown>> | undefined;
      cause?: unknown;
    } = {},
  ) {
    super(message, options);
    this.hint = options.hint;
  }
}

/** Another start is running in the folder, and still holds its lock. */
export class LocalServerBusyError extends LocalServerError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = true;
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly hint: string | undefined = "A start in this directory holds the lock file.";

  /** The lock file. */
  readonly lockFile: string;

  /**
   * Creates the error.
   *
   * @param details - The lock file and the pid that owns it.
   */
  constructor(details: { readonly lock_file: string; readonly owner_pid: number | undefined }) {
    super("Another `zitadel start` is still running in this directory", {
      details,
    });
    this.lockFile = details.lock_file;
  }
}

/** A server that had to be stopped was still running afterwards. */
export class LocalServerStopError<R = unknown> extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string | undefined = "The server process is still running.";

  /** The record of the server that would not stop. */
  readonly record: R;

  /** What stopping it did. */
  readonly outcome: StopOutcome;

  /**
   * Creates the error.
   *
   * @param message - What went wrong.
   * @param record - The record of the server that would not stop.
   * @param outcome - What stopping it did.
   */
  constructor(message: string, record: R, outcome: StopOutcome) {
    super(message, {
      details: {
        runtime: record,
        stop_result: outcome,
      },
    });
    this.record = record;
    this.outcome = outcome;
  }
}

/** Some managed local runtime processes were still running after they were stopped. */
export class LocalServerProcessesStopError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string | undefined = "Some processes are still running.";

  /**
   * Creates the error.
   *
   * @param message - What went wrong.
   * @param options - The facts behind it, the processes and what stopping each did.
   */
  constructor(
    message: string,
    options: {
      details?: Readonly<Record<string, unknown>> | undefined;
    } = {},
  ) {
    super(message, options);
  }
}

/** The machine cannot list its processes, so it cannot say whether a server still runs. */
export class LocalServerProcessesUnlistableError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string | undefined =
    "The runtime record is damaged and this machine cannot list its processes.";

  /**
   * Creates the error.
   *
   * @param message - What went wrong.
   * @param options - The facts behind it.
   */
  constructor(
    message: string,
    options: {
      details?: Readonly<Record<string, unknown>> | undefined;
    } = {},
  ) {
    super(message, options);
  }
}

/** A `docker` call ran and failed. */
export class LocalServerDockerFailedError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string | undefined = "The docker command failed.";

  /**
   * Creates the error.
   *
   * @param message - What went wrong.
   * @param options - The facts behind it: the command and what it printed or failed with.
   */
  constructor(
    message: string,
    options: {
      details?: Readonly<Record<string, unknown>> | undefined;
    } = {},
  ) {
    super(message, options);
  }
}

/** A reset was asked for in a folder other than the one its permit is for. */
export class LocalServerPermitMismatchError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string | undefined = "A reset acts on one folder only.";

  /**
   * Creates the error.
   *
   * @param message - What went wrong.
   */
  constructor(message: string) {
    super(message);
  }
}

/** A process on the folder's data was still running after a reset stopped it. */
export class LocalServerOrphansStopError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string | undefined = "A process on this folder's data is still running.";

  /**
   * Creates the error.
   *
   * @param message - What went wrong.
   * @param options - The facts behind it, the processes and what stopping each did.
   */
  constructor(
    message: string,
    options: {
      details?: Readonly<Record<string, unknown>> | undefined;
    } = {},
  ) {
    super(message, options);
  }
}

/**
 * Docker cannot be run, so a Docker start cannot begin. The package reports
 * that it happened and what Docker said.
 */
export class LocalServerDockerMissingError extends LocalServerError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NETWORK";
  override readonly hint: string | undefined =
    "Docker is required only for the managed local runtime.";

  /** What Docker said, or that it said nothing. */
  readonly detail: string;

  /**
   * Creates the error.
   *
   * @param reason - What asking Docker failed with: its error, or the text it printed.
   */
  constructor(reason: unknown) {
    const detail = errorMessage(reason).trim() || "no reason given";
    super("Docker is not reachable", {
      details: {
        detail,
      },
      cause: reason,
    });
    this.detail = detail;
  }
}

/** The server program, `@zitadel/server`, is not installed. */
export class LocalServerBinaryMissingError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string | undefined = "The @zitadel/server package is not installed.";

  /**
   * Creates the error.
   *
   * @param message - What went wrong.
   * @param options - The facts behind it and the error that caused it.
   */
  constructor(
    message: string,
    options: {
      details?: Readonly<Record<string, unknown>> | undefined;
      cause?: unknown;
    } = {},
  ) {
    super(message, options);
  }
}

/** The server program, `@zitadel/server`, is installed and cannot be run. */
export class LocalServerBinaryBlockedError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string | undefined = "The server binary cannot be run.";

  /**
   * Creates the error.
   *
   * @param message - What went wrong.
   * @param options - The facts behind it and the error that caused it.
   */
  constructor(
    message: string,
    options: {
      details?: Readonly<Record<string, unknown>> | undefined;
      cause?: unknown;
    } = {},
  ) {
    super(message, options);
  }
}

/** The runtime record exists but cannot be read. */
export class LocalServerRecordUnreadableError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string | undefined =
    "The runtime record or its directory cannot be read.";

  /** The file. */
  readonly path: string;

  /**
   * Creates the error.
   *
   * @param message - What went wrong.
   * @param path - The file.
   * @param options - The facts behind it (its `path`) and the error that caused it.
   */
  constructor(
    message: string,
    path: string,
    options: {
      details?: Readonly<Record<string, unknown>> | undefined;
      cause?: unknown;
    } = {},
  ) {
    super(message, options);
    this.path = path;
  }
}

/** The local admin file exists but cannot be read. */
export class LocalServerAdminUnreadableError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string | undefined = "The local admin file cannot be read.";

  /** The file. */
  readonly path: string;

  /**
   * Creates the error.
   *
   * @param message - What went wrong.
   * @param path - The file.
   * @param options - The facts behind it (its `path`) and the error that caused it.
   */
  constructor(
    message: string,
    path: string,
    options: {
      details?: Readonly<Record<string, unknown>> | undefined;
      cause?: unknown;
    } = {},
  ) {
    super(message, options);
    this.path = path;
  }
}

/** An environment file the local server reads exists but cannot be read. */
export class LocalServerEnvUnreadableError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string | undefined = "The environment file cannot be read.";

  /** The file. */
  readonly path: string;

  /**
   * Creates the error.
   *
   * @param message - What went wrong.
   * @param path - The file.
   * @param options - The facts behind it (its `path`) and the error that caused it.
   */
  constructor(
    message: string,
    path: string,
    options: {
      details?: Readonly<Record<string, unknown>> | undefined;
      cause?: unknown;
    } = {},
  ) {
    super(message, options);
    this.path = path;
  }
}

/** Something that is not a directory is in the way of the local data directory. */
export class LocalServerFileBlockedError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string | undefined = undefined;

  /**
   * Creates the error.
   *
   * @param message - What went wrong.
   * @param options - The facts behind it (its `path`) and the error that caused it.
   */
  constructor(
    message: string,
    options: {
      details?: Readonly<Record<string, unknown>> | undefined;
      cause?: unknown;
    } = {},
  ) {
    super(message, options);
  }
}

/** The server does not know the local admin. */
export class LocalServerAdminRejectedError extends LocalServerError {
  override readonly category: ErrorCategory = "denied";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_AUTH";
  override readonly hint: string | undefined = "The server did not recognise the local admin.";

  /**
   * Creates the error.
   *
   * @param message - What went wrong.
   * @param options - The facts behind it.
   */
  constructor(
    message: string,
    options: {
      details?: Readonly<Record<string, unknown>> | undefined;
    } = {},
  ) {
    super(message, options);
  }
}

/** The server refused the local admin's session. */
export class LocalServerAdminSessionError extends LocalServerError {
  override readonly category: ErrorCategory = "denied";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_AUTH";
  override readonly hint: string | undefined = "The server refused the admin's session.";

  /**
   * Creates the error.
   *
   * @param message - What went wrong.
   * @param options - The facts behind it.
   */
  constructor(
    message: string,
    options: {
      details?: Readonly<Record<string, unknown>> | undefined;
    } = {},
  ) {
    super(message, options);
  }
}

/** The server does not host the platform project the local admin signs in to. */
export class LocalServerAdminPlatformMissingError extends LocalServerError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string | undefined = "The server does not host the platform project.";

  /**
   * Creates the error.
   *
   * @param message - What went wrong.
   * @param options - The facts behind it.
   */
  constructor(
    message: string,
    options: {
      details?: Readonly<Record<string, unknown>> | undefined;
    } = {},
  ) {
    super(message, options);
  }
}

/** A bug in the package: something that cannot happen did. */
export class LocalServerInternalError extends LocalServerError {
  override readonly category: ErrorCategory = "fault";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string | undefined = undefined;
}

/** A port that was explicitly asked for is held, so the start is refused rather than moved. */
export class LocalServerPortBusyError extends LocalServerError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_PORT_IN_USE";
  override readonly hint: string | undefined = "Another process holds the port.";

  /** The port that is held. */
  readonly port: number;

  /**
   * Creates the error.
   *
   * @param port - The port that was asked for.
   */
  constructor(port: number) {
    super(`Port ${String(port)} is already in use`, {
      details: {
        port,
      },
    });
    this.port = port;
  }
}

/** Every port in the search range was taken. */
export class LocalServerPortFullError extends LocalServerError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_PORT_IN_USE";
  override readonly hint: string | undefined = "Every port in the range is taken.";

  /** The first port that was tried. */
  readonly firstPort: number;

  /**
   * Creates the error.
   *
   * @param firstPort - The first port of the range.
   * @param lastPort - The last port of the range.
   */
  constructor(firstPort: number, lastPort: number) {
    super(`No free port from ${String(firstPort)} to ${String(lastPort)}`, {
      details: {
        first_port: firstPort,
      },
    });
    this.firstPort = firstPort;
  }
}

/**
 * A server was launched and exited before it became ready. `cleanup` says what
 * stopping it did, `logTail` is what it logged: the lifecycle reads the log
 * before cleaning up because cleaning up a container removes its log, which is
 * the only explanation of why it failed.
 */
export class LocalServerStartExitedError<R extends ServerRecord> extends LocalServerError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NETWORK";
  override readonly hint: string | undefined = "The server did not become healthy.";

  /** The record of the server that was launched. */
  readonly record: R;

  /** What stopping the server did. */
  readonly cleanup: StopOutcome;

  /** What the server logged, when it could be read. */
  readonly logTail: string | undefined;

  /**
   * Creates the error.
   *
   * @param record - The record of the server that was launched.
   * @param cleanup - What stopping it did.
   * @param details - What identifies the server, from the launcher.
   * @param logTail - What the server logged.
   */
  constructor(
    record: R,
    cleanup: StopOutcome,
    details: Readonly<Record<string, unknown>>,
    logTail?: string,
  ) {
    super("The server exited before it became healthy", {
      details,
    });
    this.record = record;
    this.cleanup = cleanup;
    this.logTail = logTail;
  }
}

/**
 * A server was launched and did not become ready in time. `cleanup` says what
 * stopping it did, `logTail` is what it logged.
 */
export class LocalServerStartTimeoutError<R extends ServerRecord> extends LocalServerError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NETWORK";
  override readonly hint: string | undefined = "The server did not become healthy.";

  /** The record of the server that was launched. */
  readonly record: R;

  /** What stopping the server did. */
  readonly cleanup: StopOutcome;

  /** What the server logged, when it could be read. */
  readonly logTail: string | undefined;

  /**
   * Creates the error.
   *
   * @param record - The record of the server that was launched.
   * @param cleanup - What stopping it did.
   * @param details - What identifies the server, from the launcher.
   * @param logTail - What the server logged.
   */
  constructor(
    record: R,
    cleanup: StopOutcome,
    details: Readonly<Record<string, unknown>>,
    logTail?: string,
  ) {
    super("The server did not become healthy in time", {
      details,
    });
    this.record = record;
    this.cleanup = cleanup;
    this.logTail = logTail;
  }
}
