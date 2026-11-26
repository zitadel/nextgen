import { apiErrorCode } from "@zitadel/api/runtime/fetch";

import { ZitadelLibError } from "@/lib/errors";
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
 * itself would not make (it carries only a message).
 */
export abstract class BackendError extends ZitadelLibError {
  readonly status: number | undefined;
  readonly url: string | undefined;
  readonly body: unknown;
  readonly requestId: string | undefined;

  constructor(message: string, options: BackendErrorOptions = {}) {
    super(message, options.cause);
    this.status = options.status;
    this.url = options.url;
    this.body = options.body;
    this.requestId = options.requestId;
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
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NOT_FOUND";
}

/** The state the server holds refused the request: a `409`, or content that can never be served. */
export class BackendConflictError extends BackendError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
}

/** The server rejected the request as wrong: a `400` or `422`, or an origin it refuses. */
export class BackendRejectedError extends BackendError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** The server answered that what was asked for is gone: a `410`. */
export class BackendGoneError extends BackendError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NOT_FOUND";
}

/** The claim window of a project closed: a `410` naming `proj.claim_window_expired`. */
export class BackendClaimWindowExpiredError extends BackendError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NOT_FOUND";
}

/** The claim link is not known to the server: a `404` naming `claim_challenge.not_found`. */
export class BackendClaimChallengeNotFoundError extends BackendError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NOT_FOUND";
}

/** The release was revoked and can never be served: a `409` naming `rel.revoked`. */
export class BackendReleaseRevokedError extends BackendError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
}

/** The release is still served by an origin: a `409` naming `rel.in_use`. */
export class BackendReleaseInUseError extends BackendError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
}

/** The proof of an authentication attempt was wrong: a `409` naming `att.proof_rejected`. */
export class BackendProofRejectedError extends BackendError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
}

/** The request did not say what it must: a rejection naming `req.invalid`. */
export class BackendRequestInvalidError extends BackendError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** The operation or path asked for names nothing the API has. */
export class BackendOperationUnknownError extends BackendError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** The path names several operations and the method does not pick one, or picks none. */
export class BackendOperationAmbiguousError extends BackendError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** A bug in the backend's own code: something that cannot happen unless the code is wrong. */
export class BackendInternalError extends BackendError {
  override readonly category: ErrorCategory = "fault";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * The credential was not accepted: a `401`. Nothing the caller asks for can
 * succeed until it presents one the server knows, so a caller that tolerates a
 * refusal of permission must not tolerate this.
 */
export class BackendUnauthorizedError extends BackendError {
  override readonly category: ErrorCategory = "denied";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_AUTH";
}

/**
 * The credential was accepted but may not do this: a `403`. A caller that can
 * carry on without what it asked for — a read it only wanted if allowed —
 * tolerates this one and nothing else.
 */
export class BackendForbiddenError extends BackendError {
  override readonly category: ErrorCategory = "denied";
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
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = true;
  override readonly code: ZitadelErrorCode = "E_NETWORK";

  readonly reason: UnavailableReason | undefined;

  constructor(message: string, options: UnavailableErrorOptions = {}) {
    super(message, options);
    this.reason = options.reason;
  }
}

/** The server asked the caller to come back later: a `429`. */
export class BackendTooManyRequestsError extends BackendError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = true;
  override readonly code: ZitadelErrorCode = "E_NETWORK";
}
