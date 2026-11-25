import { Cmd } from "@/lib/cmd";
import { PM } from "@/lib/pm";
import { shellCommand, suggestedCommandOf } from "@/lib/suggestion";
import { CliPackage } from "@/lib/upgrade";
import {
  codeOf,
  errorMessage,
  type Categorized,
  type ErrorCategory,
  type Suggested,
  type ZitadelErrorCode,
} from "@/lib/errors";
import { isErrno } from "@/lib/errno";
import type { ServerRecord, StopOutcome } from "@/lib/server/local/internal/lifecycle";

/**
 * What a local server failure carries beyond its message.
 */
export type LocalServerErrorOptions = Readonly<{
  /** Structured facts about the failure, for a `--json` reader. */
  details?: Readonly<Record<string, unknown>> | undefined;
  /** What to do about it, in words that name no command or flag. */
  hint?: string | undefined;
  /** What to run next, as suggestion objects the failure handler renders. */
  nextCommands?: readonly Suggested[] | undefined;
  /** The error that caused this one, if any. */
  cause?: unknown;
}>;

/**
 * Anything the local server package fails with on purpose.
 *
 * @remarks
 * It carries a message, a category, the facts behind the failure, a hint that
 * names no command or flag and the commands to run next as suggestion objects,
 * which the failure handler renders with the run's scope.
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

  /**
   * Whether the failure may be the server losing the port it was started on to
   * someone else, so an automatic choice of port may try the next one.
   */
  get mayBePortRace(): boolean {
    return true;
  }

  /** What to do about it, when the package can say. */
  readonly hint: string | undefined;

  /** What to run next, as suggestion objects the failure handler renders with the run's scope. */
  readonly nextCommands: readonly Suggested[] | undefined;

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
    this.nextCommands = options.nextCommands;
    this.details = options.details;
  }
}

/**
 * A text fact of a failure, as the hint words it.
 *
 * @param details - The facts behind the failure.
 * @param key - The fact.
 * @returns It quoted for a shell when it is text, else `undefined`.
 */
function quotedFact(details: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = details[key];

  return typeof value === "string" ? Cmd.quote(value) : undefined;
}

/**
 * The run's own folder is the one a command acts on unless the failure names
 * another, which the command then aims at with its `--cwd`.
 *
 * @param details - The facts behind the failure.
 * @returns The `cwd` flag for the folder that holds the record, or none.
 */
function folderFlag(details: Readonly<Record<string, unknown>>): { cwd?: string } {
  return typeof details.directory === "string" ? { cwd: details.directory } : {};
}

/** Why no local server answers. */
export type LocalServerDownReason = "not-running" | "not-responding";

/** What to do about each reason no local server answers. */
const DOWN_ADVICE: Record<
  LocalServerDownReason,
  (details: Readonly<Record<string, unknown>>) => LocalServerErrorOptions
> = {
  "not-running": (details) => {
    return {
      hint: "No local server has been started in this directory or a parent.",
      nextCommands: [{ id: "start", flags: folderFlag(details) }],
    };
  },
  "not-responding": (details) => {
    return {
      hint: `No healthy local server responded at ${String(details.server_url)}.`,
      nextCommands: [{ id: "start", flags: folderFlag(details) }],
    };
  },
};

/**
 * There is no running local server for a folder: none was started in it or a
 * parent, or the one that was is not running.
 */
export class LocalServerDownError extends LocalServerError {
  override readonly retryable: boolean = false;

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
    super("conflict", "Local Zitadel server is not running", {
      ...DOWN_ADVICE[reason](details),
      details,
    });
    this.reason = reason;
  }
}

/** What is malformed. */
export type LocalServerMalformedReason = "record" | "admin" | "url";

/** What to do about each thing that is malformed, by what it is. */
const MALFORMED_ADVICE: Record<
  LocalServerMalformedReason,
  (details: Readonly<Record<string, unknown>>) => LocalServerErrorOptions
> = {
  record: (details) => {
    return {
      hint: "Reset the local runtime, then start it again.",
      nextCommands: [
        { id: "reset", flags: { force: true, ...folderFlag(details) } },
        { id: "start", flags: folderFlag(details) },
      ],
    };
  },
  admin: (details) => {
    const path = quotedFact(details, "path");

    return {
      hint: `Delete ${path} and reset the local runtime, then start it again. Both are needed: reset keeps the file, and deleting it alone leaves the server holding the old password.`,
      nextCommands: [
        ...(path === undefined ? [] : [shellCommand("rm", path)]),
        { id: "reset", flags: { force: true, ...folderFlag(details) } },
        { id: "start", flags: folderFlag(details) },
      ],
    };
  },
  url: () => {
    return {};
  },
};

/**
 * Something the local server reads is not in the shape it is written in: the
 * runtime record, the admin file, or the address a server was named by.
 */
export class LocalServerMalformedError extends LocalServerError {
  override readonly retryable: boolean = false;

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
    super("invalid", message, {
      ...options,
      ...MALFORMED_ADVICE[reason](options.details ?? {}),
    });
    this.reason = reason;
  }
}

/** Another start is running in the folder, and still holds its lock. */
export class LocalServerBusyError extends LocalServerError {
  override readonly retryable: boolean = true;

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
    super("unavailable", "Another `zitadel start` is still running in this directory", {
      hint: `Wait for it to finish, or delete ${quotedFact(details, "lock_file")} if no start is running.`,
      details,
    });
  }
}

/** Why a server is not known to be stopped. */
export type LocalServerStopReason = "server" | "processes" | "unlistable";

/** What to do about each reason a server is not known to be stopped. */
const STOP_ADVICE: Record<LocalServerStopReason, LocalServerErrorOptions> = {
  server: {
    hint: "Inspect the local runtime process and stop it manually, then rerun the command.",
  },
  processes: {
    hint: "Inspect the failed process IDs and stop them manually, then stop every server again.",
  },
  unlistable: {
    hint: "The local runtime record is damaged and this machine cannot list its processes, so reset cannot tell whether a server still runs on the data. Stop the local Zitadel server yourself, then reset again.",
  },
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
    super(reason === "unlistable" ? "invalid" : "conflict", message, {
      ...options,
      ...STOP_ADVICE[reason],
    });
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

  /** What Docker said, or that it said nothing. */
  readonly detail: string;

  /**
   * Creates the error.
   *
   * @param reason - What asking Docker failed with: its error, or the text it printed.
   */
  constructor(reason: unknown) {
    const detail = errorMessage(reason).trim() || "no reason given";
    super("unavailable", "Docker is not reachable", {
      hint: "Docker is required only for the managed local runtime. Start Docker, then retry; or target a remote server.",
      nextCommands: [{ id: "doctor" }],
      details: { detail },
      cause: reason,
    });
    this.detail = detail;
  }
}

/** Why the server program cannot be run. */
export type LocalServerBinaryReason = "missing" | "blocked";

/** What to do about each reason the server program cannot be run: reinstall the CLI. */
const BINARY_ADVICE: Record<LocalServerBinaryReason, LocalServerErrorOptions> = {
  missing: {
    hint: "Reinstall @zitadel/cli so npm can install @zitadel/server and its platform package.",
    nextCommands: [suggestedCommandOf(PM.named("npm").add([`${CliPackage.NAME}@latest`]))],
  },
  blocked: {
    hint: "Check that the server binary exists and can be run, or reinstall @zitadel/cli.",
    nextCommands: [suggestedCommandOf(PM.named("npm").add([`${CliPackage.NAME}@latest`]))],
  },
};

/** The server program, `@zitadel/server`, is not installed or cannot be run. */
export class LocalServerBinaryError extends LocalServerError {
  override readonly retryable: boolean = false;

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
    super("invalid", message, { ...options, ...BINARY_ADVICE[reason] });
    this.reason = reason;
  }
}

/** Why a file of the local server cannot be used. */
export type LocalServerFileReason = "unreadable" | "blocked";

/** What to do about each reason a file cannot be used. */
const FILE_ADVICE: Record<
  LocalServerFileReason,
  (details: Readonly<Record<string, unknown>>) => LocalServerErrorOptions
> = {
  unreadable: (details) => {
    return {
      hint: `Check that ${quotedFact(details, "path")} and its directory are readable by you.`,
    };
  },
  blocked: (details) => {
    return {
      hint: `Move or delete ${quotedFact(details, "path")}: something is in the way of the local data directory.`,
    };
  },
};

/** A file or directory the local server needs exists but cannot be used. */
export class LocalServerFileError extends LocalServerError {
  override readonly retryable: boolean = false;

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
    super(LocalServerFileError.categoryOf(reason, options.cause), message, {
      ...options,
      ...FILE_ADVICE[reason](options.details ?? {}),
    });
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

/** What to do about each reason the local admin cannot sign in. */
const ADMIN_ADVICE: Record<LocalServerAdminReason, LocalServerErrorOptions> = {
  rejected: {
    hint: "Check the server log first: a server that failed the lookup reports it the same way. If the log shows no error, the local data directory predates the local admin, and resetting the local data lets a start import it again.",
    nextCommands: [{ id: "logs" }],
  },
  session: {
    hint: "Check the server log for why the local server refused the admin's session.",
  },
  "platform-missing": {
    hint: "Stop it, then start it again so it boots with the platform project and the local admin.",
    nextCommands: [{ id: "stop" }, { id: "start" }],
  },
};

/** The local admin cannot sign in to its server. */
export class LocalServerAdminError extends LocalServerError {
  override readonly retryable: boolean = false;

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
    super(reason === "platform-missing" ? "invalid" : "denied", message, {
      ...options,
      ...ADMIN_ADVICE[reason],
    });
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
    super("unavailable", `Port ${String(port)} is already in use`, {
      hint: "Stop whatever holds the port, or start on another one.",
      details: { port },
    });
    this.port = port;
  }
}

/** Every port in the search range was taken. */
export class LocalServerPortFullError extends LocalServerError {
  override readonly retryable: boolean = false;

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
      hint: "Free a port, or start on one you choose.",
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
    super("unavailable", START_FAILURES[reason], {
      hint: "Read the server log for why the server did not become healthy, then start it again.",
      nextCommands: [{ id: "logs" }, { id: "start" }],
      details,
    });
    this.reason = reason;
    this.record = record;
    this.cleanup = cleanup;
    this.logTail = logTail;
  }
}
