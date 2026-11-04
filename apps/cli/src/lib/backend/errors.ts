import { apiErrorCode } from "@zitadel/api/runtime/fetch";

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
  override readonly name: string = "BackendError";
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
export class NotFoundError extends BackendError {
  override readonly name: string = "NotFoundError";
}

/** The state the server holds refused the request: a `409`, or content that can never be served. */
export class ConflictError extends BackendError {
  override readonly name: string = "ConflictError";
}

/** The request was wrong: a rejected body, or a value the backend would not send. */
export class InvalidError extends BackendError {
  override readonly name: string = "InvalidError";
}

/**
 * The credential was not accepted: a `401`. Nothing the caller asks for can
 * succeed until it presents one the server knows, so a caller that tolerates a
 * refusal of permission must not tolerate this.
 */
export class UnauthorizedError extends BackendError {
  override readonly name: string = "UnauthorizedError";
}

/**
 * The credential was accepted but may not do this: a `403`. A caller that can
 * carry on without what it asked for — a read it only wanted if allowed —
 * tolerates this one and nothing else.
 */
export class ForbiddenError extends BackendError {
  override readonly name: string = "ForbiddenError";
}

/** Why a request got no usable response. */
export type UnavailableReason = "unreachable" | "unreadable" | "timeout";

/** What an {@link UnavailableError} carries beyond a {@link BackendError}. */
export type UnavailableErrorOptions = BackendErrorOptions &
  Readonly<{
    /** Why no response came, when none did. */
    reason?: UnavailableReason | undefined;
  }>;

/** The server could not be used: it did not answer, or it failed with a `5xx`. */
export class UnavailableError extends BackendError {
  override readonly name: string = "UnavailableError";
  readonly reason: UnavailableReason | undefined;

  constructor(message: string, options: UnavailableErrorOptions = {}) {
    super(message, options);
    this.reason = options.reason;
  }
}
