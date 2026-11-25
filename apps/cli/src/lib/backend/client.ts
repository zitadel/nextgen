import {
  createZitadelClient as createRawClient,
  type ZitadelClient as FullClient,
  type ZitadelClientOptions,
} from "@zitadel/api/client";
import { destructiveOperations } from "@zitadel/api/generated/operations";
import { ApiError, apiErrorCode, apiErrorMessage, NetworkError } from "@zitadel/api/runtime/fetch";

import {
  type BackendError,
  ConflictError,
  ForbiddenError,
  InvalidError,
  NotFoundError,
  UnauthorizedError,
  UnavailableError,
} from "./errors";

/**
 * How long one platform request may take, response body included, before it
 * fails as unavailable. Without it a server that accepts the connection and
 * never answers holds the command for the runtime's own limit — minutes.
 */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * The backend error the status of a refused response becomes.
 *
 * @param error - The failure the transport raised for a non-2xx response.
 * @returns The matching {@link BackendError}.
 */
function refusalOf(error: ApiError): BackendError {
  const options = {
    status: error.status,
    url: error.url,
    body: error.body,
    requestId: error.requestId,
    cause: error,
  };
  const message = apiErrorMessage(error);
  // A 410 is gone rather than never there — the claim window that closed, the
  // flow that already completed — but either way what was asked for is not
  // there, and neither is a request to correct and send again.
  if (error.status === 404 || error.status === 410) {
    return new NotFoundError(message, options);
  }
  if (error.status === 409) {
    return new ConflictError(message, options);
  }
  if (error.status === 401) {
    return new UnauthorizedError(message, options);
  }
  if (error.status === 403 && apiErrorCode(error) !== "proj.origin_not_allowed") {
    return new ForbiddenError(message, options);
  }
  // Too many requests: the server is telling the caller to come back, not that
  // the request was wrong, so it joins the failures a caller may retry rather
  // than the ones it must fix.
  if (error.status === 429 || error.status >= 500) {
    return new UnavailableError(message, options);
  }
  return new InvalidError(message, options);
}

/**
 * The backend error a transport failure becomes. A response the server refused
 * is classified by its status; a request that got no response is unavailable.
 * Anything else is returned as it came.
 *
 * @param error - The failure the transport raised.
 * @returns The matching {@link BackendError}, or `error` when it is neither.
 */
export function translateFailure(error: unknown): unknown {
  if (error instanceof NetworkError) {
    return new UnavailableError(error.message, {
      url: error.url,
      reason: error.reason,
      cause: error,
    });
  }
  if (error instanceof ApiError) {
    return refusalOf(error);
  }
  return error;
}

/**
 * The failure of a response the server refused, for a caller that sends its own
 * requests and so meets the status itself.
 *
 * @param status - The HTTP status.
 * @param url - The URL that was requested.
 * @param body - The parsed body the server answered with.
 * @param message - What to say when the body holds no message of its own.
 * @returns The matching {@link BackendError}.
 */
export function responseFailure(
  status: number,
  url: string,
  body: unknown,
  message: string,
): BackendError {
  return refusalOf(new ApiError(status, url, body, message));
}

/** The client functions a client without permission refuses. */
const WITHHELD: ReadonlySet<string> = new Set(destructiveOperations);

/** Each narrowed client's full client, which only {@link allowDestructive} reads. */
const fullClients = new WeakMap<object, ZitadelClient>();

/**
 * The client without its destructive operations, at run time: reaching one
 * throws, however it is reached (a cast, `Reflect.get`, a property descriptor,
 * an `any`). Only {@link allowDestructive} hands back the full client.
 * `createZitadelClient` narrows every client it makes.
 *
 * Updates are not withheld: a merge-patch `null` (`setVariables`, the user and
 * project patches) still removes what it names.
 */
function withholdDestructive(client: ZitadelClient): ZitadelClient {
  const refuse = (what: string): never => {
    throw new Error(`${what} is destructive: reach it through allowDestructive`);
  };
  const narrowed = new Proxy(client, {
    get(target, property, receiver) {
      if (typeof property === "string" && WITHHELD.has(property)) {
        refuse(property);
      }
      return Reflect.get(target, property, receiver);
    },
    getOwnPropertyDescriptor(target, property) {
      if (typeof property === "string" && WITHHELD.has(property)) {
        refuse(property);
      }
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
  fullClients.set(narrowed, client);
  return narrowed;
}

/**
 * The client with its destructive operations: every `DELETE`, and what the spec
 * marks `x-zitadel-destructive`. A client made by `createZitadelClient` refuses
 * them, so nothing deletes, revokes or rolls back until a caller asks for them
 * here.
 *
 * @param client - A client `createZitadelClient` made.
 * @returns The same client, with its destructive operations.
 */
export function allowDestructive(client: ZitadelClient): ZitadelClient {
  const full = fullClients.get(client);
  if (full === undefined) {
    throw new Error("Only a client createZitadelClient made can allow its destructive operations");
  }
  return full;
}

/** The typed Zitadel client: every operation of the API. */
export type ZitadelClient = FullClient;

/**
 * Build the typed Zitadel client the CLI talks to the server through.
 *
 * Responses are answered exactly as the server sent them, so a caller that
 * stores, compares or sends back what it reads — `setup` writes the server's
 * canonical body to the project's files, `deploy` diffs against them, the
 * resource lists send each page's cursor back — holds the bytes the server
 * meant. Escaping the text that could drive a terminal belongs to whatever
 * prints it, and `BaseCommand.emit` does it for every command at once.
 *
 * Every failure is raised as a {@link BackendError}. Every request is bounded by
 * {@link REQUEST_TIMEOUT_MS}, unless the caller sets its own `timeoutMs`, and is
 * cancelled when the `signal` the caller passes aborts. A command passes its
 * own, so Ctrl-C stops what it has in flight.
 *
 * @param opts - Where to point the client, what to authenticate with, and the run's signal.
 * @returns The client, without its destructive operations until {@link allowDestructive}.
 */
export function createZitadelClient(
  // The backend sets the error hook itself, so a caller's would be silently replaced.
  opts: Omit<ZitadelClientOptions, "onResponse" | "onError" | "signal"> & {
    signal: AbortSignal;
  },
): ZitadelClient {
  // Settled once, so the client and the connection a service reads cannot
  // disagree: spreading `opts` over a default lets an explicit `undefined`
  // wipe it, which would leave the client unbounded while this still said 30s.
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  // The client applies the hook to every call, each page of a paged one included.
  const full = createRawClient({
    ...opts,
    timeoutMs,
    onError: (error: unknown): never => {
      throw translateFailure(error);
    },
  });
  const narrowed = withholdDestructive(full);
  const connection = {
    baseUrl: opts.baseUrl,
    token: opts.token,
    signal: opts.signal,
    timeoutMs,
    userAgent: opts.userAgent,
  };
  connections.set(narrowed, {
    ...connection,
    destructive: false,
  });
  connections.set(full, {
    ...connection,
    destructive: true,
  });
  return narrowed;
}

/** Where a client was pointed, and whether it may reach destructive operations. */
export type Connection = Readonly<{
  baseUrl: string;
  token: string | undefined;
  signal: AbortSignal;
  timeoutMs: number;
  userAgent: string | undefined;
  destructive: boolean;
}>;

/** Each client `createZitadelClient` made, with the connection it was made for. */
const connections = new WeakMap<object, Connection>();

/**
 * Where a client was pointed. For a service that sends a request the generated
 * client has no function for, and so must send it the way the client does.
 *
 * @param client - A client `createZitadelClient` made.
 * @returns The server, the credential, the signal and whether destructive operations are allowed.
 */
export function connectionOf(client: ZitadelClient): Connection {
  const connection = connections.get(client);
  if (connection === undefined) {
    throw new Error("Only a client createZitadelClient made has a connection");
  }
  return connection;
}

/**
 * Whether the run this client belongs to has been cancelled.
 *
 * @remarks
 * A read whose failure a service answers as an outcome rather than a throw —
 * what a removal left behind, which deployment won a race — must not answer one
 * when the person asked the command to stop: the failure is the cancellation,
 * and reporting it as an outcome would have the command carry on and exit as
 * though it had finished. Asking the signal rather than reading the error keeps
 * this out of the business of knowing what a cancellation looks like, which is
 * the command line's to say and not the backend's.
 *
 * A client the backend did not make — a double a test builds — belongs to no
 * run and is never cancelled.
 *
 * @param client - The client the read went through.
 * @returns True when the run was cancelled.
 */
export function isCancelled(client: ZitadelClient): boolean {
  return connections.get(client)?.signal.aborted === true;
}

export { pagedFunctions } from "@zitadel/api/client";
export type { ZitadelClientOptions };
