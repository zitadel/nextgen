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
   * @returns The code, or undefined for a body that is not the platform's error
   * envelope, as from a proxy.
   */
  get serverCode(): string | undefined {
    const body = this.body;
    if (typeof body !== "object" || body === null || !("code" in body)) {
      return undefined;
    }
    return typeof body.code === "string" ? body.code : undefined;
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

/** The credential was refused: a `401` or a `403`. */
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
