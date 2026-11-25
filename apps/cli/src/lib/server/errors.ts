import {
  codeOf,
  errorMessage,
  type Categorized,
  type ErrorCategory,
  type ZitadelErrorCode,
} from "@/lib/errors";
import { isErrno } from "@/lib/errno";
import type { ServerRecord, StopOutcome } from "@/lib/server/local/internal/lifecycle";

/**
 * Which piece of advice goes with a failure of the local server: the CLI words
 * it with its own commands and flags, and a failure names the one that fits it.
 */
export type LocalServerAdviceKey =
  | "not-running"
  | "not-responding"
  | "file-unreadable"
  | "file-blocked"
  | "record-malformed"
  | "admin-malformed"
  | "admin-not-found"
  | "package-missing"
  | "cannot-launch"
  | "start-in-progress"
  | "session-exchange-failed"
  | "platform-missing"
  | "processes-did-not-stop"
  | "docker-unavailable"
  | "no-free-port"
  | "port-in-use"
  | "server-did-not-start"
  | "processes-unlistable"
  | "server-did-not-stop";

/**
 * What a local server failure carries beyond its message.
 */
export type LocalServerErrorOptions = Readonly<{
  /** Structured facts about the failure, for a `--json` reader. */
  details?: Readonly<Record<string, unknown>> | undefined;
  /** What to do about it, when no command has to be named to say so. */
  hint?: string | undefined;
  /** The error that caused this one, if any. */
  cause?: unknown;
}>;

/**
 * Anything the local server package fails with on purpose.
 *
 * @remarks
 * It carries a message, a category and the facts behind the failure, and no
 * advice about commands: which command to run next is the caller's to say.
 * A caller catches this to handle any of them, or a subclass to handle one
 * condition.
 */
export class LocalServerError extends Error implements Categorized {
  /** The kind of failure, which the boundary reports it as. */
  readonly category: ErrorCategory;

  /** Whether the same request may succeed on a later attempt, with nothing changed. */
  readonly retryable: boolean = false;

  /**
   * The stable product code the failure is reported with, which is the one
   * its category has unless a class's condition has a code of its own.
   */
  get code(): ZitadelErrorCode {
    return codeOf(this.category);
  }

  /** The advice that goes with this failure, when the CLI has any. */
  get advice(): LocalServerAdviceKey | undefined {
    return undefined;
  }

  /**
   * Whether the failure may be the server losing the port it was started on to
   * someone else, so an automatic choice of port may try the next one.
   */
  get mayBePortRace(): boolean {
    return true;
  }

  /** What to do about it, when the package can say. */
  readonly hint: string | undefined;

  /** Structured facts about the failure, for a `--json` reader. */
  readonly details: Readonly<Record<string, unknown>> | undefined;

  /**
   * Creates the error.
   *
   * @param category - What kind of failure it is.
   * @param message - What went wrong, in one sentence.
   * @param options - The facts behind it, a hint and the error that caused it.
   */
  constructor(category: ErrorCategory, message: string, options: LocalServerErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.category = category;
    this.hint = options.hint;
    this.details = options.details;
  }
}

/** Why no local server answers. */
export type LocalServerDownReason = "not-running" | "not-responding";

/** The advice each reason of a LocalServerDownError has. */
const DOWN_ADVICE: Record<LocalServerDownReason, LocalServerAdviceKey | undefined> = {
  "not-running": "not-running",
  "not-responding": "not-responding",
};

/**
 * There is no running local server for a folder: none was started in it or a
 * parent, or the one that was is not running.
 */
export class LocalServerDownError extends LocalServerError {
  override readonly retryable: boolean = false;

  /** The advice that goes with this failure, by its reason. */
  override get advice(): LocalServerAdviceKey | undefined {
    return DOWN_ADVICE[this.reason];
  }

  /** The stable product code the failure is reported with. */
  override get code(): ZitadelErrorCode {
    return "E_LOCAL_SERVER_NOT_RUNNING";
  }
  /** Whether there is no record at all, or a record whose server does not answer. */
  readonly reason: LocalServerDownReason;

  /**
   * Creates the error.
   *
   * @param reason - Whether no server was started, or the recorded one is not running.
   * @param details - The address the record names and the folder that holds it.
   */
  constructor(reason: LocalServerDownReason, details: Readonly<Record<string, unknown>>) {
    super("conflict", "Local Zitadel server is not running", { details });
    this.reason = reason;
  }
}

/** What is malformed. */
export type LocalServerMalformedReason = "record" | "admin" | "url";

/** The advice each reason of a LocalServerMalformedError has. */
const MALFORMED_ADVICE: Record<LocalServerMalformedReason, LocalServerAdviceKey | undefined> = {
  record: "record-malformed",
  admin: "admin-malformed",
  url: undefined,
};

/**
 * Something the local server reads is not in the shape it is written in: the
 * runtime record, the admin file, or the address a server was named by.
 */
export class LocalServerMalformedError extends LocalServerError {
  override readonly retryable: boolean = false;

  /** The advice that goes with this failure, by its reason. */
  override get advice(): LocalServerAdviceKey | undefined {
    return MALFORMED_ADVICE[this.reason];
  }
  /** What is malformed. */
  readonly reason: LocalServerMalformedReason;

  /**
   * Creates the error.
   *
   * @param reason - What is malformed.
   * @param message - What is wrong with it.
   * @param options - The facts behind it, a hint and the error that caused it.
   */
  constructor(
    reason: LocalServerMalformedReason,
    message: string,
    options: LocalServerErrorOptions = {},
  ) {
    super("invalid", message, options);
    this.reason = reason;
  }
}

/** Another start is running in the folder, and still holds its lock. */
export class LocalServerBusyError extends LocalServerError {
  override readonly retryable: boolean = true;

  /** The advice that goes with this failure. */
  override get advice(): LocalServerAdviceKey | undefined {
    return "start-in-progress";
  }

  /** The stable product code the failure is reported with. */
  override get code(): ZitadelErrorCode {
    return "E_CONFLICT";
  }
  /**
   * Creates the error.
   *
   * @param details - The lock file and the pid that owns it.
   */
  constructor(details: Readonly<Record<string, unknown>>) {
    super("unavailable", "Another `zitadel start` is still running in this directory", { details });
  }
}

/** Why a server is not known to be stopped. */
export type LocalServerStopReason = "server" | "processes" | "unlistable";

/** The advice each reason of a LocalServerStopError has. */
const STOP_ADVICE: Record<LocalServerStopReason, LocalServerAdviceKey | undefined> = {
  server: "server-did-not-stop",
  processes: "processes-did-not-stop",
  unlistable: "processes-unlistable",
};

/**
 * A server that had to be stopped was still running afterwards, or the
 * machine could not say which processes were running.
 */
export class LocalServerStopError<R = unknown> extends LocalServerError {
  override readonly retryable: boolean = false;

  /** A server that would not stop did not lose its port. */
  override get mayBePortRace(): boolean {
    return false;
  }

  /** The advice that goes with this failure, by its reason. */
  override get advice(): LocalServerAdviceKey | undefined {
    return STOP_ADVICE[this.reason];
  }

  /** The stable product code: a machine that cannot list its processes is an unsupported shape. */
  override get code(): ZitadelErrorCode {
    return this.reason === "unlistable" ? "E_UNSUPPORTED_PROJECT_SHAPE" : super.code;
  }
  /** A recorded server, the processes found on the data, or processes that cannot be listed. */
  readonly reason: LocalServerStopReason;

  /** The record of the server that would not stop, when there is one. */
  readonly record: R | undefined;

  /** What stopping it did, when it was tried. */
  readonly outcome: unknown;

  /**
   * Creates the error.
   *
   * @param reason - Why the server is not known to be stopped.
   * @param message - What went wrong.
   * @param options - The facts behind it, the record and the outcome of stopping it.
   */
  constructor(
    reason: LocalServerStopReason,
    message: string,
    options: LocalServerErrorOptions & Readonly<{ record?: R; outcome?: unknown }> = {},
  ) {
    super(reason === "unlistable" ? "invalid" : "conflict", message, options);
    this.reason = reason;
    this.record = options.record;
    this.outcome = options.outcome;
  }
}

/**
 * Docker cannot be run, so a Docker start cannot begin. The package reports
 * that it happened and what Docker said.
 */
export class LocalServerDockerMissingError extends LocalServerError {
  override readonly retryable: boolean = false;

  /** The advice that goes with this failure. */
  override get advice(): LocalServerAdviceKey | undefined {
    return "docker-unavailable";
  }
  /** What Docker said, or that it said nothing. */
  readonly detail: string;

  /**
   * Creates the error.
   *
   * @param reason - What asking Docker failed with: its error, or the text it printed.
   */
  constructor(reason: unknown) {
    const detail = errorMessage(reason).trim() || "no reason given";
    super("unavailable", "Docker is not reachable", { details: { detail }, cause: reason });
    this.detail = detail;
  }
}

/** Why the server program cannot be run. */
export type LocalServerBinaryReason = "missing" | "blocked";

/** The advice each reason of a LocalServerBinaryError has. */
const BINARY_ADVICE: Record<LocalServerBinaryReason, LocalServerAdviceKey | undefined> = {
  missing: "package-missing",
  blocked: "cannot-launch",
};

/** The server program, `@zitadel/server`, is not installed or cannot be run. */
export class LocalServerBinaryError extends LocalServerError {
  override readonly retryable: boolean = false;

  /** The advice that goes with this failure, by its reason. */
  override get advice(): LocalServerAdviceKey | undefined {
    return BINARY_ADVICE[this.reason];
  }
  /** Whether it is absent, or present and refused to start. */
  readonly reason: LocalServerBinaryReason;

  /**
   * Creates the error.
   *
   * @param reason - Whether the program is absent, or present and could not be started.
   * @param message - What went wrong.
   * @param options - The facts behind it and the error that caused it.
   */
  constructor(
    reason: LocalServerBinaryReason,
    message: string,
    options: LocalServerErrorOptions = {},
  ) {
    super("invalid", message, options);
    this.reason = reason;
  }
}

/** Why a file of the local server cannot be used. */
export type LocalServerFileReason = "unreadable" | "blocked";

/** The advice each reason of a LocalServerFileError has. */
const FILE_ADVICE: Record<LocalServerFileReason, LocalServerAdviceKey | undefined> = {
  unreadable: "file-unreadable",
  blocked: "file-blocked",
};

/** A file or directory the local server needs exists but cannot be used. */
export class LocalServerFileError extends LocalServerError {
  override readonly retryable: boolean = false;

  /** The advice that goes with this failure, by its reason. */
  override get advice(): LocalServerAdviceKey | undefined {
    return FILE_ADVICE[this.reason];
  }
  /** Whether it cannot be read, or something else is in its way. */
  readonly reason: LocalServerFileReason;

  /**
   * Creates the error.
   *
   * @param reason - Whether it cannot be read, or something else is in its way.
   * @param message - What went wrong.
   * @param options - The facts behind it (its `path`) and the error that caused it.
   */
  constructor(
    reason: LocalServerFileReason,
    message: string,
    options: LocalServerErrorOptions = {},
  ) {
    super(LocalServerFileError.categoryOf(reason, options.cause), message, options);
    this.reason = reason;
  }

  /**
   * The category a file failure is reported as: something in the way is a
   * conflict, a permission the OS refused is a denial, and any other
   * read failure is invalid.
   *
   * @param reason - Why the file cannot be used.
   * @param cause - The error the OS raised, if any.
   * @returns The category.
   */
  private static categoryOf(reason: LocalServerFileReason, cause: unknown): ErrorCategory {
    if (reason === "blocked") {
      return "conflict";
    } else if (isErrno(cause, "EACCES") || isErrno(cause, "EPERM")) {
      return "denied";
    } else {
      return "invalid";
    }
  }
}

/** Why the local admin cannot sign in. */
export type LocalServerAdminReason = "rejected" | "session" | "platform-missing";

/** The advice each reason of a LocalServerAdminError has. */
const ADMIN_ADVICE: Record<LocalServerAdminReason, LocalServerAdviceKey | undefined> = {
  rejected: "admin-not-found",
  session: "session-exchange-failed",
  "platform-missing": "platform-missing",
};

/** The local admin cannot sign in to its server. */
export class LocalServerAdminError extends LocalServerError {
  override readonly retryable: boolean = false;

  /** The advice that goes with this failure, by its reason. */
  override get advice(): LocalServerAdviceKey | undefined {
    return ADMIN_ADVICE[this.reason];
  }
  /** Whether the server rejected the admin, refused its session, or has no platform project. */
  readonly reason: LocalServerAdminReason;

  /**
   * Creates the error.
   *
   * @param reason - Why the admin cannot sign in.
   * @param message - What went wrong.
   * @param options - The facts behind it.
   */
  constructor(
    reason: LocalServerAdminReason,
    message: string,
    options: LocalServerErrorOptions = {},
  ) {
    super(reason === "platform-missing" ? "invalid" : "denied", message, options);
    this.reason = reason;
  }
}

/** A bug in the package: something that cannot happen did. */
export class LocalServerInternalError extends LocalServerError {
  override readonly retryable: boolean = false;
  /**
   * Creates the error.
   *
   * @param message - What went wrong.
   */
  constructor(message: string) {
    super("fault", message);
  }
}

/** A port that was explicitly asked for is held, so the start is refused rather than moved. */
export class LocalServerPortBusyError extends LocalServerError {
  override readonly retryable: boolean = false;

  /** The advice that goes with this failure. */
  override get advice(): LocalServerAdviceKey | undefined {
    return "port-in-use";
  }

  /** The stable product code the failure is reported with. */
  override get code(): ZitadelErrorCode {
    return "E_PORT_IN_USE";
  }
  /** The port that is held. */
  readonly port: number;

  /**
   * Creates the error.
   *
   * @param port - The port that was asked for.
   */
  constructor(port: number) {
    super("unavailable", `Port ${String(port)} is already in use`, { details: { port } });
    this.port = port;
  }
}

/** Every port in the search range was taken. */
export class LocalServerPortFullError extends LocalServerError {
  override readonly retryable: boolean = false;

  /** The advice that goes with this failure. */
  override get advice(): LocalServerAdviceKey | undefined {
    return "no-free-port";
  }

  /** The stable product code the failure is reported with. */
  override get code(): ZitadelErrorCode {
    return "E_PORT_IN_USE";
  }
  /** The first port that was tried. */
  readonly firstPort: number;

  /**
   * Creates the error.
   *
   * @param firstPort - The first port of the range.
   * @param lastPort - The last port of the range.
   */
  constructor(firstPort: number, lastPort: number) {
    super("unavailable", `No free port from ${String(firstPort)} to ${String(lastPort)}`, {
      details: { first_port: firstPort },
    });
    this.firstPort = firstPort;
  }
}

/** What a start says when its server did not become ready, by why. */
const START_FAILURES = {
  exited: "The server exited before it became healthy",
  timeout: "The server did not become healthy in time",
} as const;

/**
 * A server was launched but did not become ready. `cleanup` says what stopping
 * it did, `logTail` is what it logged: the lifecycle reads the log before
 * cleaning up because cleaning up a container removes its log, which is the
 * only explanation of why it failed.
 */
export class LocalServerStartError<R extends ServerRecord> extends LocalServerError {
  override readonly retryable: boolean = true;

  /** A server that never answered kept its port; one that exited may have lost it. */
  override get mayBePortRace(): boolean {
    return this.reason === "exited";
  }

  /** The advice that goes with this failure. */
  override get advice(): LocalServerAdviceKey | undefined {
    return "server-did-not-start";
  }
  /** Whether the server died, or never answered in time. */
  readonly reason: "exited" | "timeout";

  /** The record of the server that was launched. */
  readonly record: R;

  /** What stopping the server did. */
  readonly cleanup: StopOutcome;

  /** What the server logged, when it could be read. */
  readonly logTail: string | undefined;

  /**
   * Creates the error.
   *
   * @param reason - Whether the server died, or never answered in time.
   * @param record - The record of the server that was launched.
   * @param cleanup - What stopping it did.
   * @param details - What identifies the server, from the launcher.
   * @param logTail - What the server logged.
   */
  constructor(
    reason: "exited" | "timeout",
    record: R,
    cleanup: StopOutcome,
    details: Readonly<Record<string, unknown>>,
    logTail?: string,
  ) {
    super("unavailable", START_FAILURES[reason], { details });
    this.reason = reason;
    this.record = record;
    this.cleanup = cleanup;
    this.logTail = logTail;
  }
}
