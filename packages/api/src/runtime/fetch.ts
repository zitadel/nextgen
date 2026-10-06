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
 *   spec's `204`/`205`/`304` no-body responses.
 */
export async function customFetch<T>(url: string, options: RequestInit): Promise<T> {
  const token = getApiAuthToken();
  const headers = new Headers(options.headers);
  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const res = await fetch(url, { ...options, headers });

  const noBody = [204, 205, 304].includes(res.status);
  const rawBody = noBody ? "" : await res.text();
  const parsed = rawBody ? (safeJsonParse(rawBody) as unknown) : undefined;

  if (!res.ok) {
    const message = `${options.method ?? "GET"} ${url} returned ${res.status}`;
    throw new ApiError(res.status, url, parsed, message);
  }

  return parsed as T;
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
