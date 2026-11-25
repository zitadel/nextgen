import { apiErrorCode } from "@zitadel/api/runtime/fetch";

import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

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
export class BackendError extends Error {
  /** The kind of failure; `unknown` for a failure no subclass names. */
  readonly category: ErrorCategory = "unknown";
  /** Whether the same request may succeed on a later attempt, with nothing changed. */
  readonly retryable: boolean = false;
  /** The stable product code the failure is reported with. */
  readonly code: ZitadelErrorCode = "E_VALIDATION";
  readonly status: number | undefined;
  readonly url: string | undefined;
  readonly body: unknown;
  readonly requestId: string | undefined;
  readonly hint: string | undefined;
  readonly details: unknown;

  constructor(message: string, options: BackendErrorOptions = {}) {
    super(message, {
      cause: options.cause,
    });
    this.name = new.target.name;
    this.status = options.status;
    this.url = options.url;
    this.body = options.body;
    this.requestId = options.requestId;
    this.hint = options.hint;
    this.details = options.details;
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
  override readonly category = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NOT_FOUND";
}

/** The state the server holds refused the request: a `409`, or content that can never be served. */
export class BackendConflictError extends BackendError {
  override readonly category = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
}

/** The server rejected the request as wrong: a `400` or `422`, or an origin it refuses. */
export class BackendRejectedError extends BackendError {
  override readonly category = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** The operation or path asked for names nothing the API has. */
export class BackendOperationUnknownError extends BackendError {
  override readonly category = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** The path names several operations and the method does not pick one, or picks none. */
export class BackendOperationAmbiguousError extends BackendError {
  override readonly category = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** A bug in the backend's own code: something that cannot happen unless the code is wrong. */
export class BackendInternalError extends BackendError {
  override readonly category = "fault";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * The credential was not accepted: a `401`. Nothing the caller asks for can
 * succeed until it presents one the server knows, so a caller that tolerates a
 * refusal of permission must not tolerate this.
 */
export class BackendUnauthorizedError extends BackendError {
  override readonly category = "denied";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_AUTH";
}

/**
 * The credential was accepted but may not do this: a `403`. A caller that can
 * carry on without what it asked for — a read it only wanted if allowed —
 * tolerates this one and nothing else.
 */
export class BackendForbiddenError extends BackendError {
  override readonly category = "denied";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_AUTH";
}

/** Why a request got no usable response. */
export type UnavailableReason = "unreachable" | "unreadable" | "timeout";

/** What a {@link BackendUnavailableError} carries beyond a {@link BackendError}. */
export type UnavailableErrorOptions = BackendErrorOptions &
  Readonly<{
    /** Why no response came, when none did. */
    reason?: UnavailableReason | undefined;
  }>;

/** The server could not be used: it did not answer, or it failed with a `5xx`. */
export class BackendUnavailableError extends BackendError {
  override readonly category = "unavailable";
  override readonly retryable: boolean = true;
  override readonly code: ZitadelErrorCode = "E_NETWORK";

  readonly reason: UnavailableReason | undefined;

  constructor(message: string, options: UnavailableErrorOptions = {}) {
    super(message, options);
    this.reason = options.reason;
  }
}
