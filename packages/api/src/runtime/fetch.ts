import { destructiveOperations } from "../generated/operations";
import { API_PREFIX, apiBaseUrl } from "./base-url";
import type { ZitadelClient } from "./client";

/** The code the server answers a path no operation of its version has with (ADR 076). */
const ROUTE_NOT_FOUND = "req.not_found";

/**
 * Framework-neutral failure type the orval-generated client throws on
 * any non-2xx response. Carries the HTTP status, the parsed error body
 * (the spec's `{code, message, details?}` envelope when the server
 * returned one), and the request URL — enough for callers to map to
 * their own error taxonomy without re-implementing the fetch layer.
 *
 * Callers that don't care about the distinction can catch `ApiError`
 * generically; callers that do (the CLI's `toZitadelError`) read
 * `status` and decide.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: unknown;
  /**
   * The server's ID for the request, from its `X-Request-Id` header: the
   * reference that finds the request in the server's logs, to show beside the
   * error. `undefined` when the response carried none, as from a proxy.
   */
  readonly requestId: string | undefined;

  constructor(status: number, url: string, body: unknown, message: string, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.url = url;
    this.body = body;
    this.requestId = requestId;
  }
}

/**
 * Thrown when a request got no usable response: the connection was refused or
 * reset, the host did not resolve, the server accepted the connection but did
 * not answer in time, or it answered with a body that could not be read. The
 * counterpart to {@link ApiError}, which is a response that came back with a
 * failing status.
 *
 * `fetch` only rejects when no response arrived, and reading the body only
 * when the body broke off or could not be decoded, so this is decided by which
 * of the two rejected, never by how a runtime words the failure. The runtime's
 * own error stays on `cause` for debugging.
 */
export class NetworkError extends Error {
  readonly url: string;
  /**
   * `timeout` when a deadline cut the request off, `unreadable` when a response
   * arrived but its body could not be read (a proxy that labels a decoded body
   * as compressed, say), `unreachable` otherwise.
   */
  readonly reason: NetworkErrorReason;

  constructor(url: string, reason: NetworkErrorReason, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NetworkError";
    this.url = url;
    this.reason = reason;
  }
}

/** Why a {@link NetworkError} got no usable response. */
export type NetworkErrorReason = "unreachable" | "unreadable" | "timeout";

/**
 * What one {@link request} is bound by: a signal that aborts it and a deadline.
 * {@link customFetch} takes both from the client the call was made with.
 */
export type RequestPolicy = Readonly<{
  /** Aborts the request; its reason is rethrown as is. */
  signal?: AbortSignal;
  /** The deadline, covering the response body as well as the headers. */
  timeoutMs?: number;
  /** The `fetch` to send through; the runtime's own when left out. */
  fetch?: typeof fetch;
}>;

/**
 * Thrown, before anything is sent, when a client that does not allow
 * destructive operations ({@link ZitadelClient.allowDestructive}) runs one:
 * every `DELETE`, and any operation the spec marks `x-zitadel-destructive`.
 */
export class DestructiveOperationError extends Error {
  /** The generated function that was called, such as `deleteUser`. */
  readonly operation: string;

  /**
   * @param operation - The generated function that was called.
   */
  constructor(operation: string) {
    super(`${operation} is destructive, and this client does not allow destructive operations`);
    this.name = "DestructiveOperationError";
    this.operation = operation;
  }
}

/** The generated functions that run a destructive operation. */
const DESTRUCTIVE: ReadonlySet<string> = new Set(destructiveOperations);

/**
 * The orval `mutator` for the fetch client: every generated operation sends
 * its request through the function this returns, with the client it was
 * called with and its own name. Everything about the request comes from that
 * client and nowhere else, so two clients never share a setting:
 *
 * - the destructive guard — a destructive operation is refused with a
 *   {@link DestructiveOperationError} unless the client allows it, before
 *   anything is sent;
 * - the URL — the client's base URL, then the API prefix (ADR 077), then the
 *   operation's path;
 * - bearer auth and the `User-Agent`, from the client;
 * - the client's signal and deadline, combined with any signal on the call;
 * - the client's `fetch`, which sends the request;
 * - non-2xx → throw {@link ApiError}, so failures interrupt control flow;
 * - body parsing — the parsed JSON typed as `T`, or `undefined` for the
 *   spec's `204`/`205`/`304` no-body responses;
 * - no response → throw {@link NetworkError}, or the abort reason when the
 *   caller cancelled (see {@link request}).
 *
 * @param client - The client the operation was called with.
 * @param operation - The generated function's name, such as `getProject`.
 * @returns The fetch the generated function calls with its path and request.
 */
export function customFetch(client: ZitadelClient, operation: string) {
  return async <T>(path: string, options: RequestInit): Promise<T> => {
    if (DESTRUCTIVE.has(operation) && !client.allowDestructive) {
      throw new DestructiveOperationError(operation);
    }
    const url = `${apiBaseUrl(client.baseUrl)}${path}`;
    const policy = { signal: client.signal, timeoutMs: client.timeoutMs, fetch: client.fetch };
    const headers = new Headers(options.headers);
    if (client.userAgent !== undefined) {
      headers.set("user-agent", client.userAgent);
    }
    if (client.token && !headers.has("authorization")) {
      headers.set("authorization", `Bearer ${client.token}`);
    }

    const { res, rawBody: parsed } = await request(url, { ...options, headers }, policy, readBody);

    if (!res.ok) {
      // Every operation this client calls is one the spec has, so a server that
      // knows no such path is another version, most likely one from before the
      // API moved under its prefix.
      const message =
        res.status === 404 && apiErrorCode(parsed) === ROUTE_NOT_FOUND
          ? `${options.method ?? "GET"} ${url} returned 404 (${ROUTE_NOT_FOUND}): the server has no such operation; a server older than this client does not serve the API under ${API_PREFIX}`
          : `${options.method ?? "GET"} ${url} returned ${res.status}`;
      throw new ApiError(
        res.status,
        url,
        parsed,
        message,
        res.headers.get("x-request-id") || undefined,
      );
    }

    // The body is trusted to have the shape the generated types promise; no
    // response is checked here or by the paged functions. Should that change,
    // check it here, against the generated Zod response schemas, so every call
    // is covered.
    return parsed as T;
  };
}

/** The parsed body, or `undefined` for the spec's no-body responses. */
async function readBody(res: Response): Promise<unknown> {
  if ([204, 205, 304].includes(res.status)) return undefined;
  const rawBody = await res.text();
  return rawBody ? (safeJsonParse(rawBody) as unknown) : undefined;
}

/**
 * `fetch` bound by a {@link RequestPolicy}, with its failures typed.
 *
 * The policy's signal, its deadline and any signal on `init` are combined, and
 * `read` runs under them too, so a server that sends headers and then stalls
 * mid-body is cut off as well. When the request does not complete:
 *
 * - a deadline fired → {@link NetworkError} with reason `timeout`;
 * - any other abort → the signal's own reason, rethrown untouched, because a
 *   cancellation is the caller's decision and the caller knows what it means;
 * - a response arrived but `read` failed → {@link NetworkError} with reason
 *   `unreadable`, naming the status that did come back;
 * - anything else → {@link NetworkError} with reason `unreachable`.
 *
 * Exported for the few callers that need the raw {@link Response} (a
 * `Set-Cookie` header the generated client does not expose).
 */
export async function request<R = undefined>(
  url: string,
  init: RequestInit,
  policy: RequestPolicy = {},
  read?: (res: Response) => Promise<R>,
): Promise<{ res: Response; rawBody: R }> {
  const signals = [init.signal, policy.signal].filter((signal) => signal != null);
  if (policy.timeoutMs !== undefined) {
    signals.push(AbortSignal.timeout(policy.timeoutMs));
  }
  const signal = signals.length > 0 ? AbortSignal.any(signals) : undefined;
  const method = init.method ?? "GET";
  let res: Response;
  try {
    res = await (policy.fetch ?? fetch)(url, { ...init, signal });
  } catch (error) {
    throw failure(error, signal, method, url, "unreachable", "got no response");
  }
  try {
    return { res, rawBody: (read ? await read(res) : undefined) as R };
  } catch (error) {
    const what = `answered ${res.status}, but its body could not be read`;
    throw failure(error, signal, method, url, "unreadable", what);
  }
}

/**
 * What {@link request} rejects with when `fetch` or `read` failed: the abort
 * as {@link request} describes it, or else a {@link NetworkError} of `reason`
 * saying `what` happened to the request.
 */
function failure(
  error: unknown,
  signal: AbortSignal | undefined,
  method: string,
  url: string,
  reason: "unreachable" | "unreadable",
  what: string,
): unknown {
  if (signal?.aborted) {
    const abort: unknown = signal.reason;
    if (abort instanceof DOMException && abort.name === "TimeoutError") {
      return new NetworkError(url, "timeout", `${method} ${url} timed out`, { cause: abort });
    }
    return abort;
  }
  const code = errnoOf(error);
  return new NetworkError(url, reason, `${method} ${url} ${what}${code ? ` (${code})` : ""}`, {
    cause: error,
  });
}

/**
 * The errno a runtime attached to a failed request, if any, for the message.
 * Undici nests it on `cause`, inside an `AggregateError` when it tried more
 * than one address. Only ever used to describe the failure, never to decide
 * that it was one.
 */
function errnoOf(error: unknown): string | undefined {
  let node: unknown = error;
  for (let depth = 0; depth < 4 && typeof node === "object" && node !== null; depth += 1) {
    const { code, errors } = node as { code?: unknown; errors?: unknown };
    if (typeof code === "string") {
      return code;
    }
    node = Array.isArray(errors) ? errors[0] : (node as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * `JSON.parse` wrapped so a non-JSON body (e.g. an HTML 502 from a
 * proxy) becomes `{ raw: "<text>" }` instead of throwing inside
 * `customFetch`. The thrown `ApiError` then carries something useful
 * for the user to see.
 */
function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/**
 * The `code` of the server's `{code, message, details}` error envelope: from an
 * {@link ApiError}, or from a parsed response body. `undefined` when there is
 * none, e.g. an HTML error page from a proxy.
 */
export function apiErrorCode(errorOrBody: unknown): string | undefined {
  const body = errorOrBody instanceof ApiError ? errorOrBody.body : errorOrBody;
  return isRecord(body) && typeof body.code === "string" ? body.code : undefined;
}

/**
 * Extracts the server's `{code, message, details}` envelope from an
 * {@link ApiError} into a display string. Falls back to the fetch layer's
 * `"METHOD url returned N"` when the body isn't shaped like an envelope, so
 * transport-level failures (HTML from a proxy, empty 5xx) still say
 * something.
 */
export function apiErrorMessage(error: ApiError): string {
  const body = error.body;
  if (!isRecord(body)) {
    return error.message;
  }
  const serverMessage = typeof body.message === "string" ? body.message : undefined;
  const detail = pickDetailString(body.details);
  if (!serverMessage) {
    return error.message;
  }
  return detail ? `${serverMessage}: ${detail}` : serverMessage;
}

/**
 * Reads the innermost human-readable string out of the spec's error
 * `details` field. Handles both `details: "..."` and the nested
 * `details: { details: "..." }` shape the platform emits for validation
 * failures.
 */
function pickDetailString(details: unknown): string | undefined {
  if (typeof details === "string") {
    return details;
  }
  if (isRecord(details)) {
    if (typeof details.details === "string") {
      return details.details;
    }
    if (typeof details.message === "string") {
      return details.message;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
