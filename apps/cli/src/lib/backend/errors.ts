import { apiErrorCode } from "@zitadel/api/runtime/fetch";

import type { Categorized, ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

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

/** What a failure carries beyond its message. */
export type BackendErrorOptions = Readonly<{
  /** The HTTP status, when the failure is an answer from the server. */
  status?: number | undefined;
  /** The URL that was requested, when the failure is an answer from the server. */
  url?: string | undefined;
  /** The parsed body the server answered with. */
  body?: unknown;
  /** The server's ID for the request, which finds it in the server's logs. */
  requestId?: string | undefined;
  /** What to do about it, when the backend knows. */
  hint?: string | undefined;
  /** Structured facts about the failure. */
  details?: unknown;
  /** The failure this one was made from. */
  cause?: unknown;
}>;

/**
 * Anything the backend fails with. A caller catches this, or one of its
 * subclasses, and never the transport's own error type.
 *
 * @remarks
 * Raised for two kinds of failure alike: an answer the server refused with
 * (it carries the status, the URL and the body), and a request the backend
 * itself would not make (it carries only a message and a hint).
 */
export class BackendError extends Error implements Categorized {
  /** The kind of failure; `unknown` for a failure no subclass names. */
  readonly category: ErrorCategory;
  /** Whether the same request may succeed on a later attempt, with nothing changed. */
  readonly retryable: boolean = false;

  /**
   * The stable product code the failure is reported with, which is the one
   * its category has unless a class's condition has a code of its own.
   */
  get code(): ZitadelErrorCode {
    return CATEGORY_CODES[this.category];
  }
  readonly status: number | undefined;
  readonly url: string | undefined;
  readonly body: unknown;
  readonly requestId: string | undefined;
  readonly hint: string | undefined;
  readonly details: unknown;

  constructor(
    message: string,
    options: BackendErrorOptions = {},
    category: ErrorCategory = "unknown",
  ) {
    super(message, {
      cause: options.cause,
    });
    this.name = new.target.name;
    this.category = category;
    this.status = options.status;
    this.url = options.url;
    this.body = options.body;
    this.requestId = options.requestId;
    const answered = options.status !== undefined && options.url !== undefined;
    this.hint =
      options.hint ??
      (answered && options.status !== 404 ? rejectionHint(options.body) : undefined);
    this.details =
      options.details ??
      (answered ? { status: options.status, url: options.url, body: options.body } : undefined);
  }

  /**
   * The server's stable machine-readable error code, such as `dep.conflict`.
   *
   * @remarks
   * Read by the contract's own reader rather than here: what the error envelope
   * looks like is the API package's to say, and a second answer to the same
   * question is a second thing to change the day the envelope changes.
   *
   * @returns The code, or undefined for a body that is not the platform's error
   * envelope, as from a proxy.
   */
  get serverCode(): string | undefined {
    return apiErrorCode(this.body);
  }
}

/** Something that is not there: a `404`, or a name that matches nothing. */
export class BackendNotFoundError extends BackendError {
  override readonly retryable: boolean = false;

  constructor(message: string, options: BackendErrorOptions = {}) {
    super(...BackendNotFoundError.worded(message, options), "missing");
  }

  /**
   * What a miss says for itself. A 404 carrying the platform's error envelope
   * is a domain-level miss from a real Zitadel API, except `req.not_found`,
   * which the server answers for a path no operation of its version has; one
   * without the envelope means the endpoint is missing, so the URL is not a
   * Zitadel platform API at all.
   *
   * @param message - The server's message.
   * @param options - What the failure carries.
   * @returns The message and options the error is made with.
   */
  private static worded(
    message: string,
    options: BackendErrorOptions,
  ): [string, BackendErrorOptions] {
    if (options.status !== 404 || options.url === undefined) {
      return [message, options];
    }
    const serverCode = apiErrorCode(options.body);
    if (serverCode === "req.not_found") {
      return [
        `${options.url} has no such endpoint on this Zitadel server`,
        {
          ...options,
          hint: "The server and this CLI are different versions; a server from before the API moved under /api/v1 answers every call so. Run the CLI release that matches the server, or upgrade the server.",
        },
      ];
    }
    if (serverCode === undefined) {
      return [
        `${message} — ${options.url} has no such endpoint; is this a Zitadel platform API?`,
        options,
      ];
    }
    return [message, options];
  }
}

/** The state the server holds refused the request: a `409`, or content that can never be served. */
export class BackendConflictError extends BackendError {
  override readonly retryable: boolean = false;

  constructor(message: string, options: BackendErrorOptions = {}) {
    super(message, options, "conflict");
  }
}

/** The server rejected the request as wrong: a `400` or `422`, or an origin it refuses. */
export class BackendRejectedError extends BackendError {
  override readonly retryable: boolean = false;

  constructor(message: string, options: BackendErrorOptions = {}) {
    super(message, options, "invalid");
  }
}

/** Why an operation cannot be chosen: it names nothing the API has, or it does not pick one. */
export type BackendOperationReason = "unknown" | "ambiguous";

/**
 * The operation or path asked for cannot be chosen: it names nothing the API
 * has, or it names several operations and the method does not pick one.
 */
export class BackendOperationError extends BackendError {
  override readonly retryable: boolean = false;
  /** Why the operation cannot be chosen. */
  readonly reason: BackendOperationReason;

  constructor(reason: BackendOperationReason, message: string, options: BackendErrorOptions = {}) {
    super(message, options, reason === "unknown" ? "missing" : "invalid");
    this.reason = reason;
  }
}

/** The server does not implement what was asked: a `501`. Retrying cannot help. */
export class BackendUnsupportedError extends BackendError {
  override readonly retryable: boolean = false;

  /** The stable product code the failure is reported with. */
  override get code(): ZitadelErrorCode {
    return "E_UNSUPPORTED_PROJECT_SHAPE";
  }

  constructor(message: string, options: BackendErrorOptions = {}) {
    super(message, options, "invalid");
  }
}

/** A bug in the backend's own code: something that cannot happen unless the code is wrong. */
export class BackendInternalError extends BackendError {
  override readonly retryable: boolean = false;

  constructor(message: string, options: BackendErrorOptions = {}) {
    super(message, options, "fault");
  }
}

/**
 * The credential was not accepted: a `401`. Nothing the caller asks for can
 * succeed until it presents one the server knows, so a caller that tolerates a
 * refusal of permission must not tolerate this.
 */
export class BackendUnauthorizedError extends BackendError {
  override readonly retryable: boolean = false;

  constructor(message: string, options: BackendErrorOptions = {}) {
    super(message, options, "denied");
  }
}

/**
 * The credential was accepted but may not do this: a `403`. A caller that can
 * carry on without what it asked for — a read it only wanted if allowed —
 * tolerates this one and nothing else.
 */
export class BackendForbiddenError extends BackendError {
  override readonly retryable: boolean = false;

  constructor(message: string, options: BackendErrorOptions = {}) {
    super(message, options, "denied");
  }
}

/** Why a request got no usable response. */
export type BackendUnavailableReason = "unreachable" | "unreadable" | "timeout";

/** What a {@link BackendUnavailableError} carries beyond a {@link BackendError}. */
export type BackendUnavailableErrorOptions = BackendErrorOptions &
  Readonly<{
    /** Why no response came, when none did. */
    reason?: BackendUnavailableReason | undefined;
  }>;

/** What to do about a request that got no usable response, by why. */
const NETWORK_HINTS: Record<BackendUnavailableReason, string> = {
  unreachable: "Check your connection and the server URL (ZITADEL_URL).",
  timeout:
    "The server accepted the connection but did not answer in time. Check that it is healthy, then retry.",
  unreadable:
    "The server answered, but its response could not be read. Check any proxy between you and the server, then retry.",
};

/** The server could not be used: it did not answer, or it failed with a `5xx`. */
export class BackendUnavailableError extends BackendError {
  override readonly retryable: boolean = true;
  readonly reason: BackendUnavailableReason | undefined;

  constructor(message: string, options: BackendUnavailableErrorOptions = {}) {
    super(
      message,
      options.reason === undefined
        ? options
        : {
            ...options,
            hint: NETWORK_HINTS[options.reason],
            details: { url: options.url, reason: options.reason },
          },
      "unavailable",
    );
    this.reason = options.reason;
  }
}

/**
 * What a refusal's body says is wrong, as one hint.
 *
 * @remarks
 * The platform names the fields it rejected, and the message does not repeat
 * them: `idp.field_immutable` says only "the field is fixed for the life of
 * the connection". Promoting them to the hint puts the answer where the
 * failure is read, not only in `--json`. The same goes for what a refusal says
 * is missing, and for each resource a rejected release names.
 *
 * @param body - The parsed body the server answered with.
 * @returns The hint, or `undefined` when the body names nothing.
 */
function rejectionHint(body: unknown): string | undefined {
  const fields = listedInDetails(body, "fields");
  const missing = listedInDetails(body, "missing");
  const resources = rejectedResources(body);
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

  return hint === "" ? undefined : hint;
}

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
 * Whether a parsed body is an object, as the envelope's nested details are.
 *
 * @param value - Whatever the body held.
 * @returns True for a non-null object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
