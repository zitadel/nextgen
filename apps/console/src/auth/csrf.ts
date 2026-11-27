import { apiErrorCode } from "@zitadel/api/runtime/fetch";

/** The header the session-bound CSRF token travels in (ADR 053 §5). */
export const CSRF_HEADER = "X-Zitadel-CSRF";

/** Methods that change nothing; mirrors the server's `httputil.IsSafeMethod`. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The code the server answers a refused CSRF check with. */
const CSRF_INVALID = "auth.csrf_invalid";

/**
 * The console session's CSRF protection (ADR 053 §5): the console signs in with
 * a session cookie, which the browser sends with every request to the API, so
 * every state-changing request must also carry the session's token in the
 * {@link CSRF_HEADER} header, which another site cannot read.
 *
 * It is a `fetch` wrapper the console's API client sends through, so the API
 * client knows nothing of it. It adds the header to unsafe requests to the
 * API's origin only, never to another host. When the server refuses one with
 * `403 auth.csrf_invalid` (another tab signed in again and the cookie changed,
 * or no token was loaded yet), it asks the session for a fresh token and sends
 * the request once more with it, only if the session still belongs to the
 * same person.
 *
 * @example
 * const csrf = new SessionCsrf(window.location.origin);
 * const client = new ZitadelClient({ baseUrl: "", allowDestructive: true, fetch: csrf.fetch });
 */
export class SessionCsrf {
  /** The origin that issued the token; the only one it is sent to. */
  private readonly origin: string;

  /** The session's token, once loaded. */
  private current: string | undefined;

  /** What re-checks the session after a refusal, once the session code set it. */
  private recheck: (() => Promise<string | undefined>) | undefined;

  /**
   * @param origin - The origin of the API the console calls.
   */
  constructor(origin: string) {
    this.origin = origin;
  }

  /**
   * The token requests carry now, or `undefined` before one is loaded.
   */
  get token(): string | undefined {
    return this.current;
  }

  /**
   * Keeps the session's token for every later write.
   *
   * @param token - The token from `GET /sessions/me/csrf`.
   */
  remember(token: string): void {
    this.current = token;
  }

  /**
   * Drops the token, for a sign-out or a session that changed.
   */
  forget(): void {
    this.current = undefined;
  }

  /**
   * Sets what runs when a write is refused for its token: it re-checks the
   * session and returns a fresh token only when the session still belongs to
   * this page's person, or `undefined` to leave the write refused.
   *
   * @param recheck - The session's re-check.
   */
  recheckWith(recheck: () => Promise<string | undefined>): void {
    this.recheck = recheck;
  }

  /**
   * Runs the re-check a refused write runs.
   *
   * @returns A fresh token, or `undefined` when the write must stay refused.
   */
  refresh(): Promise<string | undefined> {
    return this.recheck ? this.recheck() : Promise.resolve(undefined);
  }

  /**
   * `fetch`, with the token on unsafe requests to the API's origin and one
   * retry with a fresh token after a CSRF refusal. A body that can be read
   * only once (a stream, or a `Request`'s body the first send consumed) is
   * never sent again. Bound, so it can be handed
   * to a client as is.
   *
   * @param input - The URL.
   * @param init - The request.
   * @returns The response the server gave, to the retry when there was one.
   */
  readonly fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const request = input instanceof Request ? input : undefined;
    const headers = new Headers(init.headers ?? request?.headers);
    const method = (init.method ?? request?.method ?? "GET").toUpperCase();
    const url = new URL(request?.url ?? String(input), window.location.href);
    if (SAFE_METHODS.has(method) || headers.has(CSRF_HEADER) || url.origin !== this.origin) {
      return fetch(input, init);
    }
    const sent = this.current;
    if (sent) {
      headers.set(CSRF_HEADER, sent);
    }
    const res = await fetch(input, { ...init, headers });
    if (
      res.status !== 403 ||
      init.body instanceof ReadableStream ||
      (request !== undefined && request.body !== null && init.body === undefined)
    ) {
      return res;
    }
    const code = apiErrorCode(
      await res
        .clone()
        .json()
        .catch(() => undefined),
    );
    if (code !== CSRF_INVALID) {
      return res;
    }
    const fresh = await this.refresh().catch(() => undefined);
    if (!fresh || fresh === sent) {
      return res;
    }
    headers.set(CSRF_HEADER, fresh);
    return fetch(input, { ...init, headers });
  };
}
