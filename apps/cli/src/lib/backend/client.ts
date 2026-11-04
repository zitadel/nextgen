import {
  createZitadelClient as createRawClient,
  type ZitadelClient as FullClient,
  type ZitadelClientOptions,
} from "@zitadel/api/client";
import { destructiveOperations } from "@zitadel/api/generated/operations";
import { ApiError, apiErrorMessage, NetworkError } from "@zitadel/api/runtime/fetch";

import { escapeControlCharacters } from "../terminal-text";
import {
  type BackendError,
  ConflictError,
  ForbiddenError,
  InvalidError,
  NotFoundError,
  UnavailableError,
} from "./errors";

/**
 * How long one platform request may take, response body included, before it
 * fails as unavailable. Without it a server that accepts the connection and
 * never answers holds the command for the runtime's own limit — minutes.
 */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Escape an object key. Unlike a value, a key must stay distinct from its
 * siblings: a key holding a raw ESC and one holding the literal text `\x1b`
 * would otherwise both come out as `\x1b`, and one of the two fields would be
 * lost. Doubling the backslash first makes the spelling unambiguous.
 */
function escapeKey(key: string): string {
  return escapeControlCharacters(key.replaceAll("\\", "\\\\"));
}

/** An array or object still to be copied, paired with the copy to fill. */
type Pending = { source: object; target: Record<string, unknown> | unknown[] };

/**
 * Escape every string in a decoded JSON value, keys included, at any depth.
 * Numbers, booleans and `null` pass through untouched; the result has the
 * same shape as the input, with the same number of fields.
 *
 * The walk keeps its own work list rather than recursing. A user attribute
 * holds arbitrary JSON, and a few thousand levels of nesting — which
 * `JSON.parse` and `JSON.stringify` both accept — would otherwise exhaust the
 * call stack, letting one writer make `list` and `get` fail for every reader.
 */
export function sanitizeResponse<T>(value: T): T {
  const pending: Pending[] = [];
  const copy = (item: unknown): unknown => {
    if (typeof item === "string") {
      return escapeControlCharacters(item);
    }
    if (typeof item !== "object" || item === null) {
      return item;
    }
    const target = Array.isArray(item) ? [] : {};
    pending.push({ source: item, target });
    return target;
  };

  const root = copy(value);
  // Iterating the array also visits the entries `copy` appends meanwhile.
  for (const { source, target } of pending) {
    if (Array.isArray(source)) {
      for (const item of source) {
        (target as unknown[]).push(copy(item));
      }
      continue;
    }
    for (const [key, item] of Object.entries(source)) {
      // Defined rather than assigned, so a `__proto__` key stays a field.
      Object.defineProperty(target, escapeKey(key), {
        value: copy(item),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return root as T;
}

/**
 * The backend error a transport failure becomes. A response the server refused
 * is classified by its status, with the server's text escaped; a request that
 * got no response is unavailable. Anything else is returned as it came.
 */
export function translateFailure(error: unknown): unknown {
  if (error instanceof NetworkError) {
    return new UnavailableError(escapeControlCharacters(error.message), {
      url: error.url,
      reason: error.reason,
      cause: error,
    });
  }
  if (!(error instanceof ApiError)) {
    return error;
  }
  const body = sanitizeResponse(error.body);
  const sanitized = new ApiError(
    error.status,
    error.url,
    body,
    escapeControlCharacters(error.message),
    error.requestId,
  );
  const options = {
    status: error.status,
    url: error.url,
    body,
    requestId: error.requestId,
    cause: error,
  };
  const message = apiErrorMessage(sanitized);
  if (error.status === 404) {
    return new NotFoundError(message, options);
  }
  if (error.status === 409) {
    return new ConflictError(message, options);
  }
  if (
    error.status === 401 ||
    (error.status === 403 && sanitized.code !== "proj.origin_not_allowed")
  ) {
    return new ForbiddenError(message, options);
  }
  if (error.status >= 500) {
    return new UnavailableError(message, options);
  }
  return new InvalidError(message, options);
}

/**
 * Raise a rejected call as the {@link BackendError} it means. The error
 * envelope's `message` and `details` are printed as the failure, so they are as
 * attacker-influenceable as any response body and are escaped on the way.
 */
function rejectWith(error: unknown): never {
  throw translateFailure(error);
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
  return translateFailure(new ApiError(status, url, body, message)) as BackendError;
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
 * Updates are not withheld: a merge-patch `null` (`updateVariables`, the user and
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

/** Options for {@link createZitadelClient}. */
export type SanitizeOptions = {
  /**
   * Return response bodies exactly as the server sent them. Only for a
   * caller that stores, compares or sends back what it reads: `setup` writes
   * the server's canonical body back to the project's files, and `deploy`
   * diffs against them, so an escaped `\r` or zero-width joiner would be
   * written to disk as literal text and published as a change; the resource
   * lists send each page's cursor back. Such a caller escapes at the point it
   * prints. Errors are escaped either way.
   */
  verbatim?: boolean;
};

/**
 * Build the typed Zitadel client the CLI talks to the server through.
 *
 * It is `@zitadel/api`'s client with every resolved response, and every
 * server-supplied error, passed through {@link sanitizeResponse} — the approach
 * the GitHub CLI takes with go-gh's `asciisanitizer`, widened to the format
 * and bidi controls that can disguise text. Doing it once here, rather than
 * in each renderer, covers every command, table, detail view and `--json`
 * envelope, including ones not yet written; only a caller that asks for
 * {@link SanitizeOptions.verbatim} bodies escapes for itself. The shared
 * package is left raw: the console renders into a DOM, which does not
 * interpret escape codes.
 *
 * Every failure is raised as a {@link BackendError}. Every request is bounded by
 * {@link REQUEST_TIMEOUT_MS}, unless the caller sets its own `timeoutMs`, and is
 * cancelled when the `signal` the caller passes aborts. A command passes its
 * own, so Ctrl-C stops what it has in flight.
 */
export function createZitadelClient(
  // The backend sets both hooks itself, so a caller's would be silently replaced.
  opts: Omit<ZitadelClientOptions, "onResponse" | "onError" | "signal"> & {
    signal: AbortSignal;
  },
  sanitize: SanitizeOptions = {},
): ZitadelClient {
  // The client applies both to every call, each page of a paged one included.
  const full = createRawClient({
    timeoutMs: REQUEST_TIMEOUT_MS,
    ...opts,
    ...(sanitize.verbatim ? {} : { onResponse: sanitizeResponse }),
    onError: rejectWith,
  });
  const narrowed = withholdDestructive(full);
  const connection = {
    baseUrl: opts.baseUrl,
    token: opts.token,
    signal: opts.signal,
    timeoutMs: opts.timeoutMs ?? REQUEST_TIMEOUT_MS,
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

export { pagedFunctions } from "@zitadel/api/client";
export type { ZitadelClientOptions };
