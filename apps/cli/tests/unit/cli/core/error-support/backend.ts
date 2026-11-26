import { ApiError, NetworkError } from "@zitadel/api/runtime/fetch";

import {
  BackendClaimChallengeNotFoundError,
  BackendClaimWindowExpiredError,
  BackendConflictError,
  BackendForbiddenError,
  BackendGoneError,
  BackendInternalError,
  BackendMethodMismatchError,
  BackendNameUnknownError,
  BackendNotFoundError,
  BackendOperationAmbiguousError,
  BackendOperationUnknownError,
  BackendPageMalformedError,
  BackendPathUnknownError,
  BackendProofRejectedError,
  BackendReleaseContentRevokedError,
  BackendReleaseInUseError,
  BackendReleaseRevokedError,
  BackendRequestInvalidError,
  BackendRequestMalformedError,
  BackendTimeoutError,
  BackendTooManyRequestsError,
  BackendUnauthorizedError,
  BackendUnavailableError,
  BackendUnreachableError,
  BackendUnreadableError,
  BackendVariablePreviewMissingError,
  BackendVariablePrimaryMissingError,
} from "@/lib/backend";

import type { Row } from "./row";

/** The URL every answered row requested. */
const URL = "https://acme.zitadel.cloud/api/v1/projects/p1";

/** The facts a refused response carries, as the branch's `refusalOf` passes them. */
type Answered = Readonly<{
  /** The HTTP status. */
  status: number;
  /** The URL that was requested. */
  url: string;
  /** The platform's error envelope. */
  body: Readonly<Record<string, unknown>>;
  /** The transport's failure. */
  cause: ApiError;
}>;

/**
 * The options a refused response becomes, as the branch's `refusalOf` builds them.
 *
 * @param status - The HTTP status.
 * @param code - The platform's error code.
 * @param message - The platform's message.
 * @returns The status, the URL, the envelope and the transport's failure.
 */
function answered(status: number, code: string, message: string): Answered {
  const body = {
    code,
    message,
  };
  return {
    status,
    url: URL,
    body,
    cause: new ApiError(status, URL, body, message),
  };
}

/**
 * The details main's `fromBackendError` reported for an answered refusal.
 *
 * @param options - The refusal's facts.
 * @returns The status, the URL and the body.
 */
function detailsOf(options: Answered): Readonly<Record<string, unknown>> {
  return {
    status: options.status,
    url: options.url,
    body: options.body,
  };
}

/** A 404 naming a project that is not there. */
const NOT_FOUND = answered(404, "proj.not_found", "Project p1 not found");

/** A 410 for a flow that already completed. */
const GONE = answered(410, "flow.completed", "The flow already completed");

/** A 410 for a claim window that closed. */
const CLAIM_WINDOW = answered(410, "proj.claim_window_expired", "The claim window closed");

/** A 404 for a claim link the server does not know. */
const CLAIM_CHALLENGE = answered(404, "claim_challenge.not_found", "The claim link is not known");

/** A 409 for a deploy that raced in. */
const CONFLICT = answered(409, "dep.conflict", "Another deploy is running");

/** A 409 for a revoked release. */
const REVOKED = answered(409, "rel.revoked", "Release r1 is revoked");

/** A 409 for a release an origin still serves. */
const IN_USE = answered(409, "rel.in_use", "Release r1 is still served");

/** A 409 for a wrong proof. */
const PROOF = answered(409, "att.proof_rejected", "The proof was rejected");

/** A 401 for a secret the server does not know. */
const UNAUTHORIZED = answered(401, "auth.invalid_token", "The token is not valid");

/** A 403 for a secret that may not do this. */
const FORBIDDEN = answered(403, "auth.forbidden", "The token may not do this");

/** A 429 asking the caller to come back later. */
const TOO_MANY = answered(429, "req.rate_limited", "Too many requests");

/** A 503 from a server that is down. */
const UNAVAILABLE = answered(503, "srv.unavailable", "The server is unavailable");

/** A 400 for a request the server could not read. */
const MALFORMED = answered(400, "req.invalid", "The request is not valid JSON");

/** A 422 for a request the server rejected. */
const INVALID = answered(422, "var.invalid", "The variable name is not valid");

/** A 403 naming an origin the project does not hold. */
const ORIGIN = answered(403, "proj.origin_not_allowed", "The origin is not allowed");

/** The URL a request that got no answer went to. */
const NETWORK_URL = "https://acme.zitadel.cloud/api/v1/projects";

/** What the transport says of a server nothing answered for. */
const UNREACHABLE_MESSAGE = `GET ${NETWORK_URL} failed: connect ECONNREFUSED`;

/** What the transport says of a server that did not answer in time. */
const TIMEOUT_MESSAGE = `GET ${NETWORK_URL} timed out after 30000ms`;

/** What the transport says of an answer it could not read. */
const UNREADABLE_MESSAGE = `GET ${NETWORK_URL} answered a body that could not be read`;

/** The destructive call reached through a client that may not make it. */
const DESTRUCTIVE_MESSAGE = "deleteProject is destructive: reach it through allowDestructive";

/** The variable every variable row reads. */
const VARIABLE = "DATABASE_URL";

/** The release the content built back to. */
const RELEASE_ID = "r1";

/** The hash of that content. */
const CONTENT_HASH = "sha256:abc";

/** The page a paged answer sent without its list. */
const PAGE = {
  total: 0,
};

/** The methods the ambiguous path takes. */
const OFFERED = ["GET", "POST"];

/** The errors of `@/lib/backend`, each with what main showed for it. */
export const BACKEND_ROWS: readonly Row[] = [
  {
    error: new BackendNotFoundError("Project p1 not found", NOT_FOUND),
    main: "lib/backend/client.ts:45",
    expected: {
      code: "E_NOT_FOUND",
      message: "Project p1 not found",
      details: detailsOf(NOT_FOUND),
      exitCode: 4,
    },
  },
  {
    error: new BackendGoneError("The flow already completed", GONE),
    main: "lib/backend/client.ts:45",
    expected: {
      code: "E_NOT_FOUND",
      message: "The flow already completed",
      details: detailsOf(GONE),
      exitCode: 4,
    },
  },
  {
    error: new BackendClaimWindowExpiredError("The claim window closed", CLAIM_WINDOW),
    main: "lib/backend/client.ts:45",
    expected: {
      code: "E_NOT_FOUND",
      message: "The claim window closed",
      details: detailsOf(CLAIM_WINDOW),
      exitCode: 4,
    },
  },
  {
    error: new BackendClaimChallengeNotFoundError("The claim link is not known", CLAIM_CHALLENGE),
    main: "lib/backend/client.ts:45",
    expected: {
      code: "E_NOT_FOUND",
      message: "The claim link is not known",
      details: detailsOf(CLAIM_CHALLENGE),
      exitCode: 4,
    },
  },
  {
    error: new BackendConflictError("Another deploy is running", CONFLICT),
    main: "lib/backend/client.ts:48",
    expected: {
      code: "E_CONFLICT",
      message: "Another deploy is running",
      details: detailsOf(CONFLICT),
      exitCode: 5,
    },
  },
  {
    error: new BackendReleaseRevokedError("Release r1 is revoked", REVOKED),
    main: "lib/backend/client.ts:48",
    expected: {
      code: "E_CONFLICT",
      message: "Release r1 is revoked",
      details: detailsOf(REVOKED),
      exitCode: 5,
    },
  },
  {
    error: new BackendReleaseInUseError("Release r1 is still served", IN_USE),
    main: "lib/backend/client.ts:48",
    expected: {
      code: "E_CONFLICT",
      message: "Release r1 is still served",
      details: detailsOf(IN_USE),
      exitCode: 5,
    },
  },
  {
    error: new BackendProofRejectedError("The proof was rejected", PROOF),
    main: "lib/backend/client.ts:48",
    expected: {
      code: "E_CONFLICT",
      message: "The proof was rejected",
      details: detailsOf(PROOF),
      exitCode: 5,
    },
  },
  {
    error: new BackendUnauthorizedError("The token is not valid", UNAUTHORIZED),
    main: "lib/backend/client.ts:51",
    expected: {
      code: "E_AUTH",
      message: "The token is not valid",
      details: detailsOf(UNAUTHORIZED),
      exitCode: 1,
    },
  },
  {
    error: new BackendForbiddenError("The token may not do this", FORBIDDEN),
    main: "lib/backend/client.ts:54",
    expected: {
      code: "E_AUTH",
      message: "The token may not do this",
      details: detailsOf(FORBIDDEN),
      exitCode: 1,
    },
  },
  {
    error: new BackendTooManyRequestsError("Too many requests", TOO_MANY),
    main: "lib/backend/client.ts:60",
    expected: {
      code: "E_NETWORK",
      message: "Too many requests",
      details: detailsOf(TOO_MANY),
      exitCode: 4,
    },
  },
  {
    error: new BackendUnavailableError("The server is unavailable", UNAVAILABLE),
    main: "lib/backend/client.ts:60",
    expected: {
      code: "E_NETWORK",
      message: "The server is unavailable",
      details: detailsOf(UNAVAILABLE),
      exitCode: 4,
    },
  },
  {
    error: new BackendRequestMalformedError("The request is not valid JSON", MALFORMED),
    main: "lib/backend/client.ts:62",
    expected: {
      code: "E_VALIDATION",
      message: "The request is not valid JSON",
      details: detailsOf(MALFORMED),
      exitCode: 3,
    },
  },
  {
    case: "a request the server rejected",
    error: new BackendRequestInvalidError("The variable name is not valid", INVALID),
    main: "lib/backend/client.ts:62",
    expected: {
      code: "E_VALIDATION",
      message: "The variable name is not valid",
      details: detailsOf(INVALID),
      exitCode: 3,
    },
  },
  {
    case: "an origin the project does not hold",
    error: new BackendRequestInvalidError("The origin is not allowed", ORIGIN),
    main: "lib/backend/client.ts:62",
    expected: {
      code: "E_VALIDATION",
      message: "The origin is not allowed",
      details: detailsOf(ORIGIN),
      exitCode: 3,
    },
  },
  {
    error: new BackendUnreachableError(UNREACHABLE_MESSAGE, {
      url: NETWORK_URL,
      cause: new NetworkError(NETWORK_URL, "unreachable", UNREACHABLE_MESSAGE),
    }),
    main: "lib/backend/client.ts:75",
    expected: {
      code: "E_NETWORK",
      message: UNREACHABLE_MESSAGE,
      hint: "Check your connection and the server URL (ZITADEL_URL or --server).",
      details: {
        url: NETWORK_URL,
        reason: "unreachable",
      },
      exitCode: 4,
    },
  },
  {
    error: new BackendTimeoutError(TIMEOUT_MESSAGE, {
      url: NETWORK_URL,
      cause: new NetworkError(NETWORK_URL, "timeout", TIMEOUT_MESSAGE),
    }),
    main: "lib/backend/client.ts:75",
    expected: {
      code: "E_NETWORK",
      message: TIMEOUT_MESSAGE,
      hint: "The server accepted the connection but did not answer in time. Check that it is healthy, then retry.",
      details: {
        url: NETWORK_URL,
        reason: "timeout",
      },
      exitCode: 4,
    },
  },
  {
    error: new BackendUnreadableError(UNREADABLE_MESSAGE, {
      url: NETWORK_URL,
      cause: new NetworkError(NETWORK_URL, "unreadable", UNREADABLE_MESSAGE),
    }),
    main: "lib/backend/client.ts:75",
    expected: {
      code: "E_NETWORK",
      message: UNREADABLE_MESSAGE,
      hint: "The server answered, but its response could not be read. Check any proxy between you and the server, then retry.",
      details: {
        url: NETWORK_URL,
        reason: "unreadable",
      },
      exitCode: 4,
    },
  },
  {
    case: "a destructive call through a client that may not make it",
    error: new BackendInternalError(DESTRUCTIVE_MESSAGE),
    main: "lib/backend/client.ts:123",
    deviation: {
      reason: "main threw a bare Error; the typed error names its own class",
      shown: {
        details: {
          original: { name: "BackendInternalError", message: DESTRUCTIVE_MESSAGE },
        },
      },
    },
    expected: {
      code: "E_VALIDATION",
      message: DESTRUCTIVE_MESSAGE,
      details: {
        original: { name: "Error", message: DESTRUCTIVE_MESSAGE },
      },
      exitCode: 3,
    },
  },
  {
    case: "a paged call that answered no page",
    error: new BackendInternalError("listUsers answered no page"),
    main: "lib/backend/services/operation.ts:514",
    deviation: {
      reason:
        "main's InvalidError misfiled this bug as a refusal; it reports its original like every internal error",
      shown: {
        details: {
          original: { name: "BackendInternalError", message: "listUsers answered no page" },
        },
      },
    },
    expected: {
      code: "E_VALIDATION",
      message: "listUsers answered no page",
      exitCode: 3,
    },
  },
  {
    case: "a flow named by a name no flow carries",
    error: new BackendNameUnknownError('No flow definition named "signup"', "flow", "signup"),
    main: "lib/backend/services/flow.ts:110",
    expected: {
      code: "E_NOT_FOUND",
      message: 'No flow definition named "signup"',
      hint: "Run `flow-definition list` to see the flows this project has.",
      exitCode: 4,
    },
  },
  {
    case: "a schema named by a name no schema carries",
    error: new BackendNameUnknownError('No schema named "customer"', "schema", "customer"),
    main: "lib/backend/services/schema.ts:127",
    expected: {
      code: "E_NOT_FOUND",
      message: 'No schema named "customer"',
      hint: "Run `schema list` to see the object types this project has.",
      exitCode: 4,
    },
  },
  {
    error: new BackendVariablePreviewMissingError(`Variable ${VARIABLE} has no preview value.`),
    main: "lib/backend/services/variable.ts:406",
    expected: {
      code: "E_NOT_FOUND",
      message: `Variable ${VARIABLE} has no preview value.`,
      hint: "A name has a preview value only once one is set with `--preview`.",
      exitCode: 4,
    },
  },
  {
    error: new BackendVariablePrimaryMissingError(`Variable ${VARIABLE} has no primary value.`),
    main: "lib/backend/services/variable.ts:406",
    expected: {
      code: "E_NOT_FOUND",
      message: `Variable ${VARIABLE} has no primary value.`,
      hint: "Set one with `variable set`.",
      exitCode: 4,
    },
  },
  {
    error: new BackendReleaseContentRevokedError(
      `This content was already released as ${RELEASE_ID}, which is revoked`,
      RELEASE_ID,
      CONTENT_HASH,
    ),
    main: "lib/backend/services/release.ts:142",
    expected: {
      code: "E_CONFLICT",
      message: `This content was already released as ${RELEASE_ID}, which is revoked`,
      hint: "A revoked release can never be served again. Change the configuration so it builds a new release.",
      details: {
        release_id: RELEASE_ID,
        content_hash: CONTENT_HASH,
      },
      exitCode: 5,
    },
  },
  {
    error: new BackendPageMalformedError("users is not an array", PAGE),
    main: "lib/backend/services/operation.ts:492",
    expected: {
      code: "E_VALIDATION",
      message: "users is not an array",
      details: {
        response: PAGE,
      },
      exitCode: 3,
    },
  },
  {
    case: "an operation id with near ones",
    error: new BackendOperationUnknownError("No operation is called listUser", [
      "listUsers",
      "listUserKeys",
    ]),
    main: "lib/backend/services/operation.ts:347",
    deviation: {
      reason:
        "the api command, this error's only caller, offered api:ls --json; the branch words it once here",
      shown: {
        next: [{ id: "api:ls", flags: { json: true } }],
      },
    },
    expected: {
      code: "E_VALIDATION",
      message: "No operation is called listUser",
      hint: "Did you mean listUsers, listUserKeys? List them all with `zitadel api ls`.",
      exitCode: 3,
    },
  },
  {
    case: "an operation id with none near",
    error: new BackendOperationUnknownError("No operation is called zzz", []),
    main: "lib/backend/services/operation.ts:347",
    deviation: {
      reason:
        "the api command, this error's only caller, offered api:ls --json; the branch words it once here",
      shown: {
        next: [{ id: "api:ls", flags: { json: true } }],
      },
    },
    expected: {
      code: "E_VALIDATION",
      message: "No operation is called zzz",
      hint: "List them with `zitadel api ls`, or give a path such as /users/query.",
      exitCode: 3,
    },
  },
  {
    error: new BackendPathUnknownError("No operation has the path /nothing"),
    main: "lib/backend/services/operation.ts:388",
    deviation: {
      reason:
        "the api command, this error's only caller, offered api:ls --json; the branch words it once here",
      shown: {
        next: [{ id: "api:ls", flags: { json: true } }],
      },
    },
    expected: {
      code: "E_VALIDATION",
      message: "No operation has the path /nothing",
      hint: "List the paths with `zitadel api ls`.",
      exitCode: 3,
    },
  },
  {
    case: "a path of several operations and no method",
    error: new BackendOperationAmbiguousError(
      `/sessions takes ${OFFERED.join(", ")}; say which with -X`,
      OFFERED,
    ),
    main: "lib/backend/services/operation.ts:402",
    deviation: {
      reason:
        "the api command, this error's only caller, offered api:ls --json; the branch words it once here",
      shown: {
        next: [{ id: "api:ls", flags: { json: true } }],
      },
    },
    expected: {
      code: "E_VALIDATION",
      message: "/sessions takes GET, POST; say which with -X",
      hint: "Pass -X with one of GET, POST.",
      exitCode: 3,
    },
  },
  {
    case: "a path of several operations and a method none has",
    error: new BackendOperationAmbiguousError(
      `/sessions takes ${OFFERED.join(", ")}, not PUT`,
      OFFERED,
    ),
    main: "lib/backend/services/operation.ts:402",
    deviation: {
      reason:
        "the api command, this error's only caller, offered api:ls --json; the branch words it once here",
      shown: {
        next: [{ id: "api:ls", flags: { json: true } }],
      },
    },
    expected: {
      code: "E_VALIDATION",
      message: "/sessions takes GET, POST, not PUT",
      hint: "Pass -X with one of GET, POST.",
      exitCode: 3,
    },
  },
  {
    error: new BackendMethodMismatchError("listSessions is GET /sessions, not POST", "GET"),
    main: "lib/backend/services/operation.ts:249",
    deviation: {
      reason:
        "the api command, this error's only caller, offered api:ls --json; the branch words it once here",
      shown: {
        next: [{ id: "api:ls", flags: { json: true } }],
      },
    },
    expected: {
      code: "E_VALIDATION",
      message: "listSessions is GET /sessions, not POST",
      hint: "Leave out -X, or pass -X GET.",
      exitCode: 3,
    },
  },
];
