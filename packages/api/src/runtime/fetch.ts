import { getApiAuthToken } from "./auth";

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

  constructor(status: number, url: string, body: unknown, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}


/**
 * Thrown when a request got no response at all: the connection was refused or
 * reset, the host did not resolve, or the server accepted the connection but
 * did not answer in time. The counterpart to {@link ApiError}, which is a
 * response that came back with a failing status.
 *
 * `fetch` only rejects when no response arrived, so this is decided by the
 * fact that it rejected, never by how a runtime words the failure. The
 * runtime's own error stays on `cause` for debugging.
 */
export class NetworkError extends Error {
  readonly url: string;
  /** `timeout` when a deadline cut the request off, `unreachable` otherwise. */
  readonly reason: "unreachable" | "timeout";

  constructor(url: string, reason: "unreachable" | "timeout", message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NetworkError";
    this.url = url;
    this.reason = reason;
  }
}

/**
 * What every request a client makes is bound by. Set per call by
 * `createZitadelClient`, the same way as the base URL and token, and read at
 * the top of {@link customFetch} before its first `await`.
 */
export type RequestPolicy = {
  /** Aborts every request made while it is set; its reason is rethrown as is. */
  signal?: AbortSignal;
  /** Per-request deadline, covering the response body as well as the headers. */
  timeoutMs?: number;
};

let requestPolicy: RequestPolicy = {};

export function setRequestPolicy(policy: RequestPolicy): void {
  requestPolicy = policy;
}

/**
 * The orval `mutator` for the fetch client. Every generated operation
 * routes its request through this function instead of the global
 * `fetch`. We pin three concerns here so generated call sites stay
 * focused on the shape of one HTTP call:
 *
 * - bearer auth — read from `runtime/auth.ts` and attached automatically;
 * - non-2xx → throw — orval's stock client parses the body regardless
 *   of status, so callers would have to inspect every response. Throw
 *   `ApiError` on `!res.ok` so failures interrupt control flow;
 * - body parsing — return the parsed JSON typed as `T` (the operation's
 *   return type, threaded through by orval), or `undefined` for the
 *   spec's `204`/`205`/`304` no-body responses;
 * - no response → throw {@link NetworkError}, or the abort reason when the
 *   caller cancelled (see {@link request}).
 */
export async function customFetch<T>(url: string, options: RequestInit): Promise<T> {
  const token = getApiAuthToken();
  const headers = new Headers(options.headers);
  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const { res, rawBody } = await request(url, { ...options, headers }, requestPolicy, async (res) =>
    [204, 205, 304].includes(res.status) ? "" : await res.text(),
  );
  const parsed = rawBody ? (safeJsonParse(rawBody) as unknown) : undefined;

  if (!res.ok) {
    const message = `${options.method ?? "GET"} ${url} returned ${res.status}`;
    throw new ApiError(res.status, url, parsed, message);
  }

  return parsed as T;
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
  try {
    const res = await fetch(url, { ...init, signal });
    return { res, rawBody: (read ? await read(res) : undefined) as R };
  } catch (error) {
    if (signal?.aborted) {
      const reason: unknown = signal.reason;
      if (reason instanceof DOMException && reason.name === "TimeoutError") {
        throw new NetworkError(url, "timeout", `${method} ${url} timed out`, { cause: reason });
      }
      throw reason;
    }
    const code = errnoOf(error);
    throw new NetworkError(
      url,
      "unreachable",
      `${method} ${url} got no response${code ? ` (${code})` : ""}`,
      { cause: error },
    );
  }
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
