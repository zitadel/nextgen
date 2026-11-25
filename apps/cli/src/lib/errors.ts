import { stripVTControlCharacters as stripAnsi } from "node:util";

import type { Suggested } from "./suggestion";

export type { Suggested };

/**
 * The one sentence a cancellation ends on, wherever it is reported.
 *
 * One word, in the past tense and without a full stop, like every other
 * closing line. It says nothing about what was or was not changed, because
 * Ctrl-C can land after the work as easily as before it, and a sentence that
 * is sometimes a lie is worse than a short one that is always true. A command
 * that does know says so on a line under this one.
 */
export const CANCELLED = "Cancelled";

/**
 * The closed set of kinds a failure can be, shared by every package's errors.
 *
 * @remarks
 * A package's base error carries one of these as `category`, so the command
 * that catches it, and the boundary that finally reports it, can say what
 * kind of failure it was without knowing which package raised it.
 *
 * Choose one by walking this list in order; the first yes wins.
 *
 * 1. `fault`: our own code is wrong (an internal guard).
 * 2. `unknown`: nobody anticipated it, so there is no typed class. The
 *    boundary assigns it to any error that is not categorized; a typed class
 *    never uses it, except a package's own "<X>FailedError" generic wrapper.
 * 3. `unavailable`: the request got no decision: no network, a timeout, a 429,
 *    a 5xx, a server or machine that is not up, a port or lock that is held.
 * 4. `denied`: the problem is identity: not signed in, or not allowed (401, 403).
 * 5. `missing`: the thing it refers to is not there (404, 410).
 * 6. `conflict`: it exists but its state refuses: already exists, a stale
 *    write, a prerequisite not in place, a server not running.
 * 7. `invalid`: whatever remains: the input can never work as given,
 *    including an unsupported shape or version.
 *
 * Whether trying the identical request again may work is a separate trait,
 * {@link Categorized.retryable}.
 */
export const ERROR_CATEGORIES = [
  "invalid",
  "missing",
  "conflict",
  "denied",
  "unavailable",
  "fault",
  "unknown",
] as const;

/** One of the {@link ERROR_CATEGORIES}. */
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

/** What an error carries when it says what kind of failure it is. */
export interface Categorized {
  /** The kind of failure. */
  readonly category: ErrorCategory;
  /**
   * Whether the identical request, with nothing changed by anyone, may succeed
   * on a later attempt: a network failure, a timeout, a 429 or 5xx, a lock
   * another start holds, a server still starting. False for anything a person
   * has to change first.
   */
  readonly retryable: boolean;
  /** What to do about it, when the package that raised it knows. */
  readonly hint?: string | undefined;
  /** Structured facts about the failure, for a `--json` reader. */
  readonly details?: unknown;
  /**
   * What to run next, as `{ id, ... }` suggestion objects the failure handler
   * renders with the run's scope, so a package says which command without
   * knowing how this run spells it.
   */
  readonly nextCommands?: readonly Suggested[] | undefined;
}

/** What an error a package raises carries, for the boundary to report it. */
export interface LibError extends Categorized {
  /** The stable product code the failure is reported with. */
  readonly code: ZitadelErrorCode;
}

/**
 * Closed set of failure categories the CLI can surface. Every error the
 * user sees is funnelled into one of these so messaging, exit codes, and
 * machine-readable output stay consistent regardless of where the failure
 * originated.
 */
export type ZitadelErrorCode =
  | "E_ALREADY_INIT"
  | "E_FRAMEWORK_NOT_DETECTED"
  | "E_UNSUPPORTED_PROJECT_SHAPE"
  | "E_NETWORK"
  | "E_AUTH"
  | "E_CONFLICT"
  | "E_LOCAL_SERVER_NOT_RUNNING"
  | "E_NOT_FOUND"
  | "E_PORT_IN_USE"
  | "E_VALIDATION"
  /**
   * A destructive action stopped for want of `--force` with nobody to ask.
   * Only a person can agree to it, so an agent asks them before it adds the
   * `--force` its suggested retry carries.
   */
  | "E_CONFIRMATION_REQUIRED"
  | "E_CREDENTIAL_MISSING"
  | "E_NOT_IMPLEMENTED"
  | "E_CANCELLED";

/** The code each kind of failure is reported with, unless a class's condition has one of its own. */
const CATEGORY_CODES = {
  invalid: "E_VALIDATION",
  missing: "E_NOT_FOUND",
  conflict: "E_CONFLICT",
  denied: "E_AUTH",
  unavailable: "E_NETWORK",
  fault: "E_VALIDATION",
  unknown: "E_VALIDATION",
} as const satisfies Record<ErrorCategory, ZitadelErrorCode>;

/**
 * The code a failure of `category` is reported with, which every package's
 * base error answers its `code` with unless a class's condition has a code of
 * its own.
 *
 * @param category - What kind of failure it is.
 * @returns The stable product code of that kind.
 */
export function codeOf(category: ErrorCategory): ZitadelErrorCode {
  return CATEGORY_CODES[category];
}

/**
 * Maps each {@link ZitadelErrorCode} to the process exit code the CLI
 * returns. The table is the single source of truth for exit semantics so
 * scripts and CI can branch on stable, documented numbers.
 */
export const EXIT_CODES: Record<ZitadelErrorCode, number> = {
  E_ALREADY_INIT: 0,
  E_FRAMEWORK_NOT_DETECTED: 3,
  E_UNSUPPORTED_PROJECT_SHAPE: 3,
  E_NETWORK: 4,
  E_AUTH: 1,
  E_CONFLICT: 5,
  E_LOCAL_SERVER_NOT_RUNNING: 4,
  E_NOT_FOUND: 4,
  E_PORT_IN_USE: 5,
  E_VALIDATION: 3,
  E_CONFIRMATION_REQUIRED: 3,
  E_CREDENTIAL_MISSING: 3,
  E_NOT_IMPLEMENTED: 2,
  // 128 + SIGINT, what a shell reports for a command stopped by Ctrl-C.
  E_CANCELLED: 130,
};

/**
 * The hint of an `E_CONFIRMATION_REQUIRED` refusal: the question the prompt
 * would have asked, for whoever runs the CLI to put to a person, and when
 * `--force` may follow.
 */
export function confirmationHint(question: string): string {
  return `Ask a person first: ${question} Pass --force only once they agree.`;
}

/**
 * Optional, user-facing extras attached to a {@link ZitadelError}. Kept
 * separate from the message so the renderer can present a hint, suggested
 * follow-up commands, and structured details independently (e.g. as JSON
 * fields) rather than concatenating everything into one string.
 */
export type ZitadelErrorOptions = {
  hint?: string;
  /**
   * What to run next. A {@link Suggested} rendered already, or a `Suggestion`
   * the command's failure handler renders with the run's scope, so one raised
   * below a command still aims at the run's project.
   */
  nextCommands?: readonly Suggested[];
  details?: unknown;
  /** The failure this one reports, so a caller that knows it can still find it. */
  cause?: unknown;
};

/**
 * The CLI's single error type. Carries a {@link ZitadelErrorCode} so the
 * top-level handler can derive an exit code and structured output without
 * pattern-matching on messages. Throwing this anywhere guarantees the user
 * gets a categorised, hint-bearing failure instead of a raw stack trace.
 */
export class ZitadelError extends Error {
  readonly code: ZitadelErrorCode;
  readonly hint?: string;
  readonly nextCommands?: readonly Suggested[];
  readonly details?: unknown;

  /**
   * The message this was raised with. `message` is not always it: oclif
   * rewrites the message of an error a flag's `parse` threw, prefixing the
   * flag and appending its own help line, so the words a refusal chose are
   * kept here for whoever reports it.
   */
  readonly raised: string;

  constructor(code: ZitadelErrorCode, message: string, opts: ZitadelErrorOptions = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = new.target.name;
    this.raised = message;
    this.code = code;
    this.hint = opts.hint;
    this.nextCommands = opts.nextCommands;
    this.details = opts.details;
  }

  get exitCode(): number {
    return EXIT_CODES[this.code] ?? 1;
  }
}

/**
 * oclif's footer under a command line it refused. It is oclif's own name for
 * what this CLI calls `Next:`, and finding it is the only way to tell one of
 * its parse errors from an ordinary failure: they arrive as plain `Error`s
 * carrying a rendered block rather than a type of their own.
 */
const OCLIF_HELP = /\n *See more help with --help\s*$/;

/** What oclif says of a flag typed twice, which carries no help footer of its own. */
const OCLIF_REPEATED = /^Flag --[\w-]+ can only be specified once$/u;

/** The heading oclif puts over the flags it rejected, which nothing else writes. */
const OCLIF_PREAMBLE = /^The following errors? occurred:\n/;

/** A failure's message as one sentence, which is how a person is shown it. */
export type FailureText = {
  /** What `Error: ` introduces, before the code in brackets. Said once, wherever the failure is drawn. */
  readonly sentence: string;
  /** The command line itself was refused, so `--help` is what to run next. */
  readonly misuse: boolean;
};

/**
 * A failure's message as the CLI says it to a person.
 *
 * It is the human rendering alone: `--json` carries `message` exactly as it
 * was thrown, so a script that matches on it is unaffected by anything here.
 *
 * The message is said as it was thrown: a failure reads the same in the
 * envelope's `message` and on a terminal, so nothing is capitalised or trimmed
 * on the way. Only oclif's own rendering of a refused command line — a heading,
 * an indented reason and a `--help` footer — is folded back into the one
 * sentence the CLI states every other failure as, with the footer handed to
 * the caller as {@link FailureText.misuse} so it can be offered under `Next:`
 * like any other command the CLI suggests.
 */
export function failureText(message: string): FailureText {
  if (OCLIF_REPEATED.test(message)) {
    return {
      sentence: message,
      misuse: true,
    };
  }
  if (!OCLIF_HELP.test(message)) {
    return {
      sentence: message,
      misuse: false,
    };
  }
  const [head = "", ...rest] = stripAnsi(message.replace(OCLIF_HELP, ""))
    .replace(OCLIF_PREAMBLE, "")
    .split("\n")
    .map((line) => {
      return line.trim();
    })
    .filter((line) => {
      return line !== "";
    });
  const listed = rest.map((line) => {
    return line.split(/\s{2,}/)[0] ?? line;
  });

  return {
    sentence: head.endsWith(":")
      ? `${head} ${listed.join(", ")}`.trim()
      : [head, ...rest].join("; "),
    misuse: true,
  };
}

/**
 * Normalises any thrown value into a {@link ZitadelError}. Inspection is
 * ordered most-specific-first (already-normalised, HTTP status, then
 * errno/filesystem, no response, Zod-like, generic `Error`, then a
 * catch-all) so the most actionable category and hint win. A cancelled
 * request arrives already normalised, as the `E_CANCELLED` error that
 * `./interrupt` aborts it with. This is the boundary that lets the rest
 * of the CLI `throw` plain errors yet still produce consistent, categorised
 * output. The original error shape is preserved under `details` for
 * debugging without leaking it into the user-facing message.
 */
export function toZitadelError(error: unknown): ZitadelError {
  if (error instanceof ZitadelError) {
    return error;
  }

  // The run being stopped, by a prompt walked away from or by anything else
  // that aborts, is the person's decision and not a failure.
  if (isAbortError(error)) {
    return new ZitadelError("E_CANCELLED", "Cancelled by user");
  }

  // An error a package raised on purpose carries the code, hint and details
  // it is reported with.
  if (isLibError(error)) {
    return new ZitadelError(error.code, error.message, {
      ...(error.hint === undefined ? {} : { hint: error.hint }),
      ...(error.nextCommands === undefined ? {} : { nextCommands: error.nextCommands }),
      ...(error.details === undefined ? {} : { details: error.details }),
    });
  }

  if (isErrnoException(error)) {
    const details = { original: pickErrorShape(error) };
    if (error.code === "EACCES" || error.code === "EPERM") {
      return new ZitadelError("E_AUTH", `Permission denied: ${error.message}`, {
        hint: "Check file permissions or run with the right user.",
        details,
      });
    }
    if (error.code === "EEXIST") {
      return new ZitadelError("E_CONFLICT", error.message, {
        hint: "A file already exists. Use --force to overwrite or remove it first.",
        details,
      });
    }
    if (error.code === "ENOENT") {
      return new ZitadelError("E_VALIDATION", error.message, {
        hint: "A required file or directory is missing.",
        details,
      });
    }
  }

  if (isZodLikeError(error)) {
    return new ZitadelError("E_VALIDATION", errorMessage(error), {
      details: { issues: (error as { issues: unknown }).issues },
    });
  }

  if (error instanceof Error) {
    return new ZitadelError("E_VALIDATION", error.message, {
      details: { original: pickErrorShape(error) },
    });
  }

  return new ZitadelError("E_VALIDATION", "Unknown error", { details: error });
}

/**
 * Whether `error` is an `AbortError`: the platform's way to say an operation
 * was stopped, which is what the run's signal rejects with and what a prompt
 * the person walked away from throws.
 *
 * @param error - Whatever was caught.
 * @returns True for an error named `AbortError`.
 */
export function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Whether `error` is the run being cancelled, which a caller that swallows
 * failures must still let through: the person asked the command to stop, so a
 * best-effort read that failed because of it has nothing to report, and
 * reporting one would have the command carry on and exit as though it had
 * finished. The counterpart of `isRefusal`, for the other failure nothing may
 * turn into an outcome.
 *
 * `Interruptible` aborts the run's signal with an `AbortError`, so every
 * request bound to it rejects with that; the `E_CANCELLED` error is the
 * boundary's own report of it, and counts too.
 *
 * @param error - Whatever was caught.
 * @returns True for an `AbortError` or an `E_CANCELLED` error.
 */
export function isCancellation(error: unknown): boolean {
  return isAbortError(error) || (error instanceof ZitadelError && error.code === "E_CANCELLED");
}

/**
 * Whether a caught value is an error a package raised on purpose: one that
 * says what kind of failure it is and the code it is reported with.
 *
 * @param error - Whatever was caught.
 * @returns True for an `Error` carrying a `category` and a `code`.
 */
export function isLibError(error: unknown): error is Error & LibError {
  return (
    error instanceof Error &&
    ERROR_CATEGORIES.some((category) => {
      return category === (error as Partial<Categorized>).category;
    }) &&
    typeof (error as Partial<LibError>).code === "string"
  );
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string";
}

function isZodLikeError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "issues" in error &&
    Array.isArray((error as { issues: unknown }).issues)
  );
}

/** The message of a caught value, whatever it is. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
}

function pickErrorShape(error: Error): Record<string, unknown> {
  return {
    name: error.name,
    message: error.message,
    code: (error as NodeJS.ErrnoException).code,
  };
}
