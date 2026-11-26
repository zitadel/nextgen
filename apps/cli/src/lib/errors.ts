import { stripVTControlCharacters as stripAnsi } from "node:util";

import {
  BackendError,
  BackendTimeoutError,
  BackendUnreachableError,
  BackendUnreadableError,
} from "./backend";
import { isObject } from "./json";
import type { Suggested } from "./suggestion";

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
 * that catches it can say what kind of failure it was without knowing which
 * package raised it.
 *
 * Choose one by walking this list in order; the first yes wins.
 *
 * 1. `fault`: our own code is wrong (an internal guard).
 * 2. `unknown`: nobody anticipated it; only a package's own "<X>FailedError"
 *    generic wrapper uses it.
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
 * the `retryable` property of the error.
 */
export type ErrorCategory =
  | "invalid"
  | "missing"
  | "conflict"
  | "denied"
  | "unavailable"
  | "fault"
  | "unknown";

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
    super(message);
    this.name = "ZitadelError";
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
 * The base of every error a package raises on purpose.
 *
 * @remarks
 * A package's own base extends this, and each condition extends that. The
 * boundary reports any of them by the `code` the class states, without
 * knowing which package raised it.
 */
export abstract class ZitadelLibError extends Error {
  /** The kind of failure; a subclass states its own. */
  abstract readonly category: ErrorCategory;

  /** Whether the same request may succeed on a later attempt, with nothing changed. */
  abstract readonly retryable: boolean;

  /** The stable product code the failure is reported with; a subclass states its own. */
  abstract readonly code: ZitadelErrorCode;

  /**
   * Make a package failure.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param cause - The failure this one wraps, when it wraps one.
   */
  constructor(message: string, cause?: unknown) {
    super(
      message,
      cause === undefined
        ? undefined
        : {
            cause,
          },
    );
    this.name = new.target.name;
  }
}

/**
 * A prompt the person walked away from. A drawn prompt closes its own chain
 * when that happens, so whoever ends the run needs to tell this from any
 * other cancellation, which leaves the chain open: the class says so, where a
 * match on the message would break the day the message is reworded.
 */
export class PromptCancelled extends ZitadelError {
  constructor() {
    super("E_CANCELLED", "Cancelled by user");
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

  if (error instanceof BackendError) {
    return fromBackendError(error);
  }

  if (error instanceof ZitadelLibError) {
    return new ZitadelError(error.code, error.message);
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
 * A {@link BackendError} as the CLI's error. One the server answered carries
 * its status, and is classified by it; one the backend raised itself carries
 * its class, and its message as it was given.
 */
function fromBackendError(error: BackendError): ZitadelError {
  if (error instanceof BackendUnreachableError) {
    return new ZitadelError("E_NETWORK", error.message, {
      hint: "Check your connection and the server URL (ZITADEL_URL or --server).",
      details: { url: error.url, reason: "unreachable" },
    });
  }
  if (error instanceof BackendTimeoutError) {
    return new ZitadelError("E_NETWORK", error.message, {
      hint: "The server accepted the connection but did not answer in time. Check that it is healthy, then retry.",
      details: { url: error.url, reason: "timeout" },
    });
  }
  if (error instanceof BackendUnreadableError) {
    return new ZitadelError("E_NETWORK", error.message, {
      hint: "The server answered, but its response could not be read. Check any proxy between you and the server, then retry.",
      details: { url: error.url, reason: "unreadable" },
    });
  }
  if (error.status === undefined || error.url === undefined) {
    return new ZitadelError(error.code, error.message);
  }
  // `401`/`403` → bad or missing project secret; `404` → something is
  // missing (see below); `5xx` → transport or server fault; everything
  // else 4xx → the body the CLI sent was rejected (validation, conflict, …).
  const { status, url } = error;
  const details = { status, url, body: error.body };
  if (error.status === 404) {
    // A 404 carrying the platform's error envelope (a `code` field) is a
    // domain-level miss from a real Zitadel API — an unknown schema or
    // project id — except `req.not_found`, which the server answers for a
    // path no operation of its version has (ADR 076). Without the envelope
    // the endpoint itself is missing: the CLI is pointed at a server that
    // isn't a Zitadel platform API.
    if (error.serverCode === "req.not_found") {
      return new ZitadelError(
        "E_NOT_FOUND",
        `${error.url} has no such endpoint on this Zitadel server`,
        {
          hint: "The server and this CLI are different versions; a server from before the API moved under /api/v1 answers every call so. Run the CLI release that matches the server, or upgrade the server.",
          details,
        },
      );
    }
    const wrongServer = error.serverCode === undefined;
    const message = wrongServer
      ? `${error.message} — ${error.url} has no such endpoint; is this a Zitadel platform API?`
      : error.message;

    return new ZitadelError("E_NOT_FOUND", message, { details });
  }
  // A 409 is the platform refusing because of the state it holds — a
  // release still served, a deploy that raced in, a revoked release — not
  // because the request was malformed, so it is a conflict.
  // A 403 naming an origin the project does not hold is a refused target,
  // not a bad credential: re-authenticating would never fix it.
  // A 410 is gone rather than never there — a closed claim window, a flow that
  // already completed — which is still something missing and not a request to
  // correct. A 429 is the server asking for less traffic, so it joins the
  // failures worth retrying rather than the ones to fix, which is what
  // `E_NETWORK` says and what its exit code means to a script.
  const originRefused = error.status === 403 && error.serverCode === "proj.origin_not_allowed";
  const code: ZitadelErrorCode = originRefused
    ? "E_VALIDATION"
    : error.status === 401 || error.status === 403
      ? "E_AUTH"
      : error.status === 409
        ? "E_CONFLICT"
        : error.status === 410
          ? "E_NOT_FOUND"
          : error.status === 429 || error.status >= 500
            ? "E_NETWORK"
            : "E_VALIDATION";
  // The platform names the fields it rejected, and the message does not
  // repeat them: `idp.field_immutable` says only "the field is fixed for the
  // life of the connection", which leaves the reader to guess which of a
  // connection document's fields it meant. Promoting them to the hint puts
  // the answer where the failure is read, not only in `--json`. The same
  // goes for what a refusal says is missing: `idp.endpoints_partial` names
  // the endpoints a connection left out only in `missing`.
  const fields = listedInDetails(error.body, "fields");
  const missing = listedInDetails(error.body, "missing");
  const resources = rejectedResources(error.body);
  const hint = [
    ...(resources.length > 0 ? [`${resources.join("; ")}.`] : []),
    ...(fields.length > 0
      ? [
          `The server rejected ${new Intl.PluralRules("en").select(fields.length) === "one" ? "this field" : "these fields"}: ${fields.join(", ")}.`,
        ]
      : []),
    ...(missing.length > 0
      ? [
          `The server reports ${new Intl.PluralRules("en").select(missing.length) === "one" ? "this endpoint" : "these endpoints"} missing: ${missing.join(", ")}.`,
        ]
      : []),
  ].join(" ");

  return new ZitadelError(code, error.message, {
    ...(hint !== "" ? { hint } : {}),
    details,
  });
}

/**
 * True when a response body looks like the platform's structured error
 * envelope (`{ code, message, … }`). Its presence proves the request reached
 * a real Zitadel platform API rather than an arbitrary HTTP server.
 */
/**
 * The names a platform error envelope lists under `key`, if any: the dotted
 * field paths it blames (`fields`), or what it reports missing (`missing`).
 *
 * The envelope nests them under `details`, and the server wraps its own
 * `details` map in the response's `details` field, so the names arrive at
 * `body.details.details.<key>`. Both depths are read: the extra wrapper is
 * the serialiser's doing rather than part of the contract, and a reader that
 * insisted on it would go silent the day it goes away.
 */
function listedInDetails(
  body: unknown,
  key: "fields" | "missing",
  seen = new Set<string>(),
  depth = 0,
): string[] {
  if (depth >= 4 || !isObject(body)) {
    return [...seen];
  }
  const listed = (body as Record<string, unknown>)[key];
  if (Array.isArray(listed)) {
    for (const name of listed) {
      if (typeof name === "string" && name !== "") {
        seen.add(name);
      }
    }
  }

  return listedInDetails((body as { details?: unknown }).details, key, seen, depth + 1);
}

/**
 * The resources a refusal names, one line each: `<kind> <handle>: <message>`.
 * A rejected release carries the reason per schema or flow under
 * `details.resources`, and the top-level message only says the release was
 * invalid, so without these lines the reason shows only in `--json`. A flow
 * keeps its reason in the resource's own `details.details`, behind a generic
 * message, so that text is appended when the message does not already hold it.
 * A connection names what it refused there too, as a list: the fields an
 * `idp.field_immutable` blames, or the endpoints an `idp.endpoints_partial`
 * reports missing. Those are appended the same way.
 */
function rejectedResources(body: unknown, depth = 0): readonly string[] {
  if (depth >= 4 || !isObject(body)) {
    return [];
  }
  const listed = (body as Record<string, unknown>).resources;
  if (Array.isArray(listed)) {
    return listed.flatMap((item) => {
      return resourceLine(item) ?? [];
    });
  }
  return rejectedResources((body as { details?: unknown }).details, depth + 1);
}

function resourceLine(item: unknown): string | undefined {
  if (!isObject(item)) {
    return undefined;
  }
  const { kind, handle, message, details } = item as Record<string, unknown>;
  const reason = typeof message === "string" ? message : "";
  const nested = isObject(details) ? (details as Record<string, unknown>).details : undefined;
  const detail =
    typeof nested === "string"
      ? nested
      : [...listedInDetails(details, "fields"), ...listedInDetails(details, "missing")].join(", ");
  const text =
    detail === "" || reason.includes(detail) ? reason : [reason, detail].filter(Boolean).join(": ");
  if (text === "") {
    return undefined;
  }
  const subject = [kind, handle]
    .filter((part) => {
      return typeof part === "string" && part !== "";
    })
    .join(" ");

  return subject === "" ? text : `${subject}: ${text}`;
}

/**
 * Whether `error` is the run being cancelled, which a caller that swallows
 * failures must still let through: the person asked the command to stop, so a
 * best-effort read that failed because of it has nothing to report, and
 * reporting one would have the command carry on and exit as though it had
 * finished. The counterpart of `isRefusal`, for the other failure nothing may
 * turn into an outcome.
 *
 * `Interruptible` aborts the run's signal with this error, so every request
 * bound to it rejects with it.
 */
export function isCancellation(error: unknown): boolean {
  return error instanceof ZitadelError && error.code === "E_CANCELLED";
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
