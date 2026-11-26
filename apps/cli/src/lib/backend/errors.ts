import { apiErrorCode } from "@zitadel/api/runtime/fetch";

import { ZitadelLibError } from "@/lib/lib-error";
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

/**
 * The server answered that what was asked for is gone: a `410`.
 *
 * @remarks
 * A {@link BackendNotFoundError}, so a caller that catches that kind catches this one too.
 */
export class BackendGoneError extends BackendNotFoundError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NOT_FOUND";
}

/**
 * The claim window of a project closed: a `410` naming `proj.claim_window_expired`.
 *
 * @remarks
 * A {@link BackendGoneError}, so a caller that catches that kind catches this one too.
 */
export class BackendClaimWindowExpiredError extends BackendGoneError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NOT_FOUND";
}

/**
 * The claim link is not known to the server: a `404` naming `claim_challenge.not_found`.
 *
 * @remarks
 * A {@link BackendNotFoundError}, so a caller that catches that kind catches this one too.
 */
export class BackendClaimChallengeNotFoundError extends BackendNotFoundError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NOT_FOUND";
}

/**
 * A variable that holds no primary value.
 *
 * @remarks
 * A {@link BackendNotFoundError}, so a caller that catches that kind catches this one too.
 */
export class BackendVariablePrimaryMissingError extends BackendNotFoundError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NOT_FOUND";
}

/**
 * A variable that holds no preview value.
 *
 * @remarks
 * A {@link BackendNotFoundError}, so a caller that catches that kind catches this one too.
 */
export class BackendVariablePreviewMissingError extends BackendNotFoundError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NOT_FOUND";
}

/**
 * The content built back to a release that was revoked: the server dedupes on
 * content, so the same tree always builds to that release, which can never be
 * served. A {@link BackendConflictError} like any other conflict.
 */
export class BackendReleaseContentRevokedError extends BackendConflictError {
  /** The revoked release the content built back to. */
  readonly releaseId: string;

  /** The hash of the content. */
  readonly contentHash: string;

  /**
   * Make the failure.
   *
   * @param message - What went wrong, naming the release.
   * @param releaseId - The revoked release.
   * @param contentHash - The hash of the content.
   */
  constructor(message: string, releaseId: string, contentHash: string) {
    super(message);
    this.releaseId = releaseId;
    this.contentHash = contentHash;
  }
}

/**
 * The release was revoked and can never be served: a `409` naming `rel.revoked`.
 *
 * @remarks
 * A {@link BackendConflictError}, so a caller that catches that kind catches this one too.
 */
export class BackendReleaseRevokedError extends BackendConflictError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
}

/**
 * The release is still served by an origin: a `409` naming `rel.in_use`.
 *
 * @remarks
 * A {@link BackendConflictError}, so a caller that catches that kind catches this one too.
 */
export class BackendReleaseInUseError extends BackendConflictError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
}

/**
 * The proof of an authentication attempt was wrong: a `409` naming `att.proof_rejected`.
 *
 * @remarks
 * A {@link BackendConflictError}, so a caller that catches that kind catches this one too.
 */
export class BackendProofRejectedError extends BackendConflictError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
}

/** The server rejected the request as wrong: a `400` or `422` (`req.invalid` or otherwise), or an origin it refuses. */
export class BackendRequestInvalidError extends BackendError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * The server could not read the request at all (`req.invalid`), as a server
 * that does not know the operation answers. A {@link BackendRequestInvalidError}
 * like any other rejected request.
 */
export class BackendRequestMalformedError extends BackendRequestInvalidError {}

/** A page of a paged answer that does not hold the list the operation pages through. */
export class BackendPageMalformedError extends BackendRequestInvalidError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /** The page as the server answered it, which the refusal reports. */
  readonly response: unknown;

  /**
   * Creates the error.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param response - The page as the server answered it.
   */
  constructor(message: string, response: unknown) {
    super(message);
    this.response = response;
  }
}

/** The operation or path asked for names nothing the API has. */
export class BackendOperationUnknownError extends BackendError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /** The operation ids closest to the one asked for, nearest first; none for a path. */
  readonly near: readonly string[];

  /**
   * Creates the error.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param near - The operation ids closest to the one asked for.
   */
  constructor(message: string, near: readonly string[] = []) {
    super(message);
    this.near = near;
  }
}

/** A path that matches no operation's template. */
export class BackendPathUnknownError extends BackendOperationUnknownError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/** The path names several operations and the method does not pick one, or picks none. */
export class BackendOperationAmbiguousError extends BackendError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /** The methods the path takes, which the refusal says to pick from. */
  readonly methods: readonly string[];

  /**
   * Creates the error.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param methods - The methods the path takes.
   */
  constructor(message: string, methods: readonly string[] = []) {
    super(message);
    this.methods = methods;
  }
}

/** An operation named by its id was given a method that is not its own. */
export class BackendMethodMismatchError extends BackendOperationAmbiguousError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /** The operation's own method, which the refusal says to pass instead. */
  readonly method: string;

  /**
   * Creates the error.
   *
   * @param message - What went wrong, with the facts it is about.
   * @param method - The operation's own method.
   */
  constructor(message: string, method: string) {
    super(message, [method]);
    this.method = method;
  }
}

/** What kind of record a {@link BackendNameUnknownError} looked for. */
export type BackendNamedKind = "flow" | "schema";

/** A flow or schema named by its name, which no record carries. */
export class BackendNameUnknownError extends BackendNotFoundError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NOT_FOUND";

  /** What kind of record the name was looked up as. */
  readonly kind: BackendNamedKind;

  /** The name no record carries. */
  readonly reference: string;

  /**
   * Creates the error.
   *
   * @param message - What went wrong, naming the record.
   * @param kind - What kind of record the name was looked up as.
   * @param reference - The name no record carries.
   */
  constructor(message: string, kind: BackendNamedKind, reference: string) {
    super(message);
    this.kind = kind;
    this.reference = reference;
  }
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

/** Nothing answered the connection to the server. */
export class BackendUnreachableError extends BackendError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = true;
  override readonly code: ZitadelErrorCode = "E_NETWORK";
}

/** The server accepted the connection but did not answer in time. */
export class BackendTimeoutError extends BackendError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = true;
  override readonly code: ZitadelErrorCode = "E_NETWORK";
}

/** The server answered, but its response could not be read. */
export class BackendUnreadableError extends BackendError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = true;
  override readonly code: ZitadelErrorCode = "E_NETWORK";
}

/** The server could not be used: it failed with a `5xx`. */
export class BackendUnavailableError extends BackendError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = true;
  override readonly code: ZitadelErrorCode = "E_NETWORK";
}

/** The server asked the caller to come back later: a `429`. */
export class BackendTooManyRequestsError extends BackendError {
  override readonly category: ErrorCategory = "unavailable";
  override readonly retryable: boolean = true;
  override readonly code: ZitadelErrorCode = "E_NETWORK";
}
